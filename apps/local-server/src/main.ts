/**
 * Host Runtime process entry point. Started by Desktop main with an IPC channel (`stdio[3] = "ipc"`), or standalone
 * for development. Owns the conversation store exclusively, then serves `@openbot/protocol` requests.
 */
import { mkdir, open, readFile, realpath, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BotRuntime } from "@openbot/agent-runtime";
import {
	type ExecutionTarget,
	type HostParams,
	type HostStatus,
	type HostToDesktop,
	isHostMethod,
	isRequestEnvelope,
	PROTOCOL_VERSION,
	ProtocolError,
	type ResponseEnvelope,
} from "@openbot/protocol";
import { ApprovalBook, DEFAULT_MAX_ACTIVE_RUNS, HostService } from "@openbot/server-core";
import { ExecutorProcess } from "./executor.ts";
import { KeychainCredentials } from "./keychain.ts";
import { modelConfigFile, openBotHome } from "./model-config-file.ts";
import { createToolRouter, TOOL_DEFINITIONS } from "./tools.ts";

const HOST_VERSION = "0.0.0";
const PROVIDER_KEY_VARIABLE = /^[A-Z0-9_]*(API_KEY|TOKEN)$/;

// `$NAME` references in the model configuration resolve against the environment as launched; the user named them.
const launchEnvironment = { ...process.env };
/** Provider credentials never come implicitly from a developer shell, and children never inherit them (Section 5.9). */
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

const target: ExecutionTarget = { kind: "local", targetId: `local:${process.env.USER ?? "user"}` };

// The shared workspace every Bot may read and write without asking (Section 8.3).
const workspaceSetting = process.env.OPENBOT_WORKSPACE ?? join(homedir(), "OpenBot");
await mkdir(workspaceSetting, { recursive: true });
const workspace = await realpath(workspaceSetting);

const executor = new ExecutorProcess({
	// Development layout: the executor app is a sibling of this app in the workspace.
	entry: process.env.OPENBOT_EXECUTOR_ENTRY ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../local-executor/src/main.ts"),
	targetId: target.targetId,
	workspace,
	dataDirectory,
	env: process.env,
});

// The approval book publishes through the service, which exists only after the runtime it needs is open.
const approvalListeners: { changed?: (botId: string) => void } = {};
const approvals = new ApprovalBook((botId) => approvalListeners.changed?.(botId));
// The router is built before the runtime; memory edits reach it once tool calls flow, after it opened.
const router = createToolRouter({
	target,
	workspace,
	approvals,
	executor,
	secrets: credentials,
	tavilyBaseUrl: process.env.OPENBOT_TAVILY_BASE_URL,
	editMemory: (botId, edit) => runtime.editMemory(botId, edit),
	artifactsDirectory: join(dataDirectory, "artifacts"),
});

const runtime = await BotRuntime.open({
	databasePath: join(dataDirectory, "openbot.sqlite"),
	credentials,
	tools: { definitions: TOOL_DEFINITIONS, invoke: (call) => router.invoke(call) },
});

const status: HostStatus = {
	protocolVersion: PROTOCOL_VERSION,
	hostVersion: HOST_VERSION,
	nodeVersion: process.versions.node,
	targetId: target.targetId,
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
	modelConfig: modelConfigFile(join(openBotHome(), "models.json"), launchEnvironment),
	approvals,
	workspace,
	maxActiveRuns: maxActiveRuns(process.env.OPENBOT_MAX_ACTIVE_RUNS),
	emit: (event) =>
		send({ ...event, protocolVersion: PROTOCOL_VERSION, kind: "event", streamId, seq: ++seq }),
	// Pi committed the call's result: the executor may prune its receipt, and the call's approval is used up.
	toolSettled: (botId, callId) => {
		void (async () => {
			executor.ack(`${await runtime.conversationKey(botId)}:${callId}`);
			await approvals.settled(botId, callId);
		})().catch((error: unknown) => console.error("Could not settle a tool call", error));
	},
	// Stop also ends the background commands the conversation started; they are no longer any Pi call's.
	conversationStopped: (botId) => {
		void runtime
			.conversationKey(botId)
			.then((conversationId) => executor.stopTasks(conversationId))
			.catch((error: unknown) => console.error("Could not stop background commands", error));
	},
});
approvalListeners.changed = (botId) => service.approvalsChanged(botId);

// Recovery gate (Section 5.1): before anything schedules, storage is open, pending approvals are loaded, observers
// are attached, and the executor has opened its ledger, turning invocations left unfinished into `unknown`. Pi then
// reruns interrupted calls with their stable call IDs; each finds its approval and its receipt.
await executor.start();
await service.start();
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
	await executor.stop();
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

/** The active-Run cap from `OPENBOT_MAX_ACTIVE_RUNS`; unset means the default. */
function maxActiveRuns(value: string | undefined): number {
	if (value === undefined || value === "") return DEFAULT_MAX_ACTIVE_RUNS;
	const cap = Number(value);
	if (!Number.isInteger(cap) || cap < 1) throw new Error(`OPENBOT_MAX_ACTIVE_RUNS must be a positive integer, got ${value}`);
	return cap;
}
