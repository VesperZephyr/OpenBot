/**
 * Host Runtime process entry point. Started by Desktop main with an IPC channel (`stdio[3] = "ipc"`), or standalone
 * for development. Owns the conversation store exclusively, then serves `@openbot/protocol` requests.
 */
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { BotRuntime } from "@openbot/agent-runtime";
import {
	type HostParams,
	type HostStatus,
	type HostToDesktop,
	isHostMethod,
	isRequestEnvelope,
	PROTOCOL_VERSION,
	ProtocolError,
	type ResponseEnvelope,
} from "@openbot/protocol";
import { HostService } from "@openbot/server-core";
import { KeychainCredentials } from "./keychain.ts";

const HOST_VERSION = "0.0.0";
const PROVIDER_KEY_VARIABLE = /^[A-Z0-9_]*(API_KEY|TOKEN)$/;

/** Provider credentials must come from the Keychain, never from a developer shell (Section 5.9). */
for (const name of Object.keys(process.env)) if (PROVIDER_KEY_VARIABLE.test(name)) delete process.env[name];

const dataDirectory = process.env.OPENBOT_DATA_DIR ?? join(homedir(), "Library", "Application Support", "OpenBot");
await mkdir(dataDirectory, { recursive: true, mode: 0o700 });

// Exclusive store ownership: Pi has no cross-process lock, so a second Host must not open the database.
const lockPath = join(dataDirectory, "host.lock");
const lock = await open(lockPath, "wx").catch(async (error: NodeJS.ErrnoException) => {
	if (error.code !== "EEXIST") throw error;
	const pid = Number((await readFile(lockPath, "utf8")).trim());
	if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) {
		throw new Error(`Another Host Runtime (pid ${pid}) owns ${dataDirectory}`);
	}
	await rm(lockPath, { force: true });
	return open(lockPath, "wx");
});
await lock.writeFile(`${process.pid}\n`);

const credentials = new KeychainCredentials({
	service: process.env.OPENBOT_KEYCHAIN_SERVICE ?? "ai.openbot.desktop.credentials",
	indexPath: join(dataDirectory, "credentials.json"),
});

const runtime = await BotRuntime.open({ databasePath: join(dataDirectory, "openbot.sqlite"), credentials });

const status: HostStatus = {
	protocolVersion: PROTOCOL_VERSION,
	hostVersion: HOST_VERSION,
	nodeVersion: process.versions.node,
	targetId: `local:${process.env.USER ?? "user"}`,
	startedAt: Date.now(),
};

const streamId = crypto.randomUUID();
let seq = 0;
const send = (message: HostToDesktop): void => {
	if (process.send !== undefined && process.connected) process.send(message);
};

const service = new HostService({
	runtime,
	secrets: credentials,
	status,
	dataDirectory,
	emit: (event) =>
		send({ ...event, protocolVersion: PROTOCOL_VERSION, kind: "event", streamId, seq: ++seq }),
});

await service.start();
// Recovery gate: nothing schedules before storage is open and observers are attached. Executor reconciliation joins
// this gate in M1.
runtime.resume();

process.on("message", async (message: unknown) => {
	if (!isRequestEnvelope(message)) return;
	let response: ResponseEnvelope;
	try {
		const { method } = message;
		if (!isHostMethod(method)) throw new ProtocolError("unknown_method", `Unknown method: ${method}`);
		// Params are validated per method by schema in M2; until then handlers check the fields they use.
		const result = await service.handle(method, message.params as HostParams<typeof method>);
		response = { protocolVersion: PROTOCOL_VERSION, kind: "response", messageId: message.messageId, ok: true, result };
	} catch (error) {
		const code = error instanceof ProtocolError ? error.code : "internal";
		const text = error instanceof Error ? error.message : String(error);
		response = {
			protocolVersion: PROTOCOL_VERSION,
			kind: "response",
			messageId: message.messageId,
			ok: false,
			error: { code, message: text },
		};
	}
	send(response);
});

// Pi's timers are unreferenced and SQLite holds no handle, so without an IPC channel nothing keeps the event loop
// alive. A standalone (development) Host stays up until it is signalled.
const keepAlive = process.send === undefined ? setInterval(() => {}, 2 ** 30) : undefined;

let stopping = false;
async function shutdown(code: number): Promise<void> {
	if (stopping) return;
	stopping = true;
	clearInterval(keepAlive);
	await service.stop();
	await runtime.close();
	await lock.close();
	await rm(lockPath, { force: true });
	process.exit(code);
}

process.on("SIGTERM", () => void shutdown(0));
process.on("SIGINT", () => void shutdown(0));
// Losing the parent means Desktop quit or crashed; the Host must not outlive it.
process.on("disconnect", () => void shutdown(0));

send({ protocolVersion: PROTOCOL_VERSION, kind: "ready", status });
if (process.send === undefined) console.log(`OpenBot Host Runtime ready (data: ${dataDirectory})`);

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
