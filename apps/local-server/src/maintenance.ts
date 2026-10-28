/** Offline composition: no provider, tools or executor is started. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { BotRuntime, BACKUP_RUNTIME_VERSION } from "@openbot/agent-runtime";
import { LocalBackups } from "@openbot/server-core";
import { PROTOCOL_VERSION, type BackupRequest } from "@openbot/protocol";

const data = process.env.OPENBOT_DATA_DIR ?? join(homedir(), "Library/Application Support/OpenBot");
await mkdir(data, { recursive: true, mode: 0o700 });
const lockPath = join(data, "host.lock");
const lock = await open(lockPath, "wx").catch(async (error: NodeJS.ErrnoException) => {
	if (error.code !== "EEXIST") throw error;
	const pid = Number((await readFile(lockPath, "utf8")).trim());
	if (!Number.isInteger(pid) || pid <= 0) throw Error("Host ownership is uncertain");
	try {
		process.kill(pid, 0);
		throw Error("Close the running Host before maintenance");
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e;
	}
	await rm(lockPath);
	return open(lockPath, "wx");
});
await lock.writeFile(`${process.pid}\n`);
try {
	let text = "";
	for await (const chunk of process.stdin) {
		text += String(chunk);
		if (Buffer.byteLength(text) > 8192) throw Error("Maintenance request too large");
	}
	const request = JSON.parse(text) as BackupRequest;
	if (
		!request ||
		!["export", "restore", "recover"].includes(request.action) ||
		("directory" in request && typeof request.directory !== "string")
	)
		throw Error("Invalid maintenance request");
	if (process.platform !== "darwin") throw Error("Local backups currently require macOS");
	const hardware = execFileSync("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], { encoding: "utf8", maxBuffer: 1024 * 1024 });
	const uuid = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(hardware)?.[1];
	if (!uuid) throw Error("Cannot verify this Mac's backup identity");
	const machine = createHash("sha256").update(`${uuid}:${userInfo().uid}`).digest("hex");
	const backups = new LocalBackups({
		dataDirectory: data,
		machine,
		producer: {
			application: process.env.OPENBOT_APP_VERSION ?? "development",
			protocol: PROTOCOL_VERSION,
			runtime: BACKUP_RUNTIME_VERSION,
		},
		validatePayload: (directory) => {
			const checker = import.meta.url.endsWith(".mjs")
				? join(import.meta.dirname, "backup-check.mjs")
				: resolve(import.meta.dirname, "../../local-executor/src/backup-check.ts");
			execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", checker], {
				input: directory,
				env: { PATH: process.env.PATH },
				timeout: 30000,
				maxBuffer: 8192,
			});
		},
		pauseRestored: async (databasePath) => {
			const runtime = await BotRuntime.open({ databasePath, history:false });
			try {
				if (!(await runtime.listBots()).some((bot) => bot.kind === "core")) throw Error("Backup is missing the Core Bot");
				const old = await runtime.lifecycle().read();
				await runtime.lifecycle().write({ revision: old.revision + 1, userPaused: true, needsResume: true, lastReason: "recovery" });
			} finally {
				await runtime.close();
			}
		},
	});
	backups.recover();
	const result =
		request.action === "export"
			? backups.export(request.directory)
			: request.action === "restore"
				? await backups.restore(request.directory)
				: { action: "recover", files: 0, bytes: 0 };
	process.stdout.write(JSON.stringify(result));
} catch (error) {
	process.stderr.write(error instanceof Error ? error.message : "Backup maintenance failed");
	process.exitCode = 1;
} finally {
	await lock.close();
	await rm(lockPath, { force: true });
}
