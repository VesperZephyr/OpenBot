import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, chmod, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import type { ToolInvocation } from "@openbot/protocol";
import { ExecutorProcess } from "../src/executor.ts";

const here = dirname(fileURLToPath(import.meta.url));
const executorEntry = resolve(here, "../../local-executor/src/main.ts");
const hostEntry = resolve(here, "../src/main.ts");

const alive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

const invocation = (invocationId: string): ToolInvocation =>
	({
		invocationId,
		botId: "bot",
		conversationId: "conv",
		tool: "local_exec",
		args: { command: "true" },
		argsDigest: "digest",
		target: { kind: "local", targetId: "mac" },
		grants: [],
		readGrants: [],
		deadline: Date.now() + 60_000,
	}) as ToolInvocation;

async function executorProcess(root: string, entry: string, options: { node?: string; startTimeoutMs?: number; stopTimeoutMs?: number; invokeTimeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): Promise<ExecutorProcess> {
	return new ExecutorProcess({
		entry,
		targetId: "mac",
		workspace: root,
		dataDirectory: root,
		env: { PATH: process.env.PATH, ...options.env },
		...(options.node === undefined ? {} : { node: options.node }),
		...(options.startTimeoutMs === undefined ? {} : { startTimeoutMs: options.startTimeoutMs }),
		...(options.stopTimeoutMs === undefined ? {} : { stopTimeoutMs: options.stopTimeoutMs }),
		...(options.invokeTimeoutMs === undefined ? {} : { invokeTimeoutMs: options.invokeTimeoutMs }),
	});
}

it("stop kills the executor and the process group it spawned", async () => {
	const root = await mkdtemp(join(tmpdir(), "openbot-executor-stop-"));
	const entry = join(root, "executor.mjs");
	const pidfile = join(root, "pids.json");
	await writeFile(
		entry,
		`import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const child = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);"], { detached: true, stdio: "ignore" });
writeFileSync(process.env.PIDFILE, JSON.stringify({ parent: process.pid, child: child.pid }));
child.unref();
process.on("SIGTERM", () => {});
process.send({ kind: "executor.hello", targetId: process.env.OPENBOT_TARGET_ID });
setInterval(() => {}, 1000);
`,
	);
	const executor = await executorProcess(root, entry, { stopTimeoutMs: 1_000, env: { PIDFILE: pidfile } });
	try {
		await executor.start();
		const ids = JSON.parse(await readFile(pidfile, "utf8")) as { parent: number; child: number };
		expect(alive(ids.parent)).toBe(true);
		expect(alive(ids.child)).toBe(true);
		await executor.stop();
		await vi.waitFor(() => {
			expect(alive(ids.parent)).toBe(false);
			expect(alive(ids.child)).toBe(false);
		}, { timeout: 3_000 });
	} finally {
		await executor.stop();
		await rm(root, { recursive: true, force: true });
	}
}, 20_000);

it("returns a startup error when the command is missing, not executable, or never becomes ready", async () => {
	const root = await mkdtemp(join(tmpdir(), "openbot-executor-start-"));
	const missing = await executorProcess(root, join(root, "unused.mjs"), { node: join(root, "missing-executor-bin") });
	await expect(missing.start()).rejects.toThrow(/Could not start the local executor:.*ENOENT/);
	await missing.stop();

	const blocked = join(root, "not-executable");
	await writeFile(blocked, "#!/bin/sh\nexit 0\n", { mode: 0o644 });
	await chmod(blocked, 0o644);
	const denied = await executorProcess(root, join(root, "unused.mjs"), { node: blocked });
	await expect(denied.start()).rejects.toThrow(/Could not start the local executor:.*EACCES/);
	await denied.stop();

	const entry = join(root, "hang.mjs");
	const pidfile = join(root, "pid");
	await writeFile(entry, `import { writeFileSync } from "node:fs"; writeFileSync(process.env.PIDFILE, String(process.pid)); setInterval(()=>{},1000);\n`);
	const hung = await executorProcess(root, entry, { startTimeoutMs: 5_000, stopTimeoutMs: 500, env: { PIDFILE: pidfile } });
	try {
		const pending = hung.start();
		await vi.waitFor(async () => expect(alive(Number(await readFile(pidfile, "utf8")))).toBe(true), { timeout: 4_000 });
		const pid = Number(await readFile(pidfile, "utf8"));
		await expect(pending).rejects.toThrow("The local executor did not become ready in time");
		await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 3_000 });
	} finally {
		await hung.stop();
		await rm(root, { recursive: true, force: true });
	}
}, 20_000);

it("returns a timeout error for an invoke the executor never answers and drops the pending request", async () => {
	const root = await mkdtemp(join(tmpdir(), "openbot-executor-invoke-"));
	const entry = join(root, "executor.mjs");
	const cancelled = join(root, "cancelled");
	await writeFile(
		entry,
		`import { writeFileSync } from "node:fs";
let seen = 0;
process.on("disconnect", () => process.exit(0));
process.on("message", (message) => {
  if (message.kind !== "tool.invoke" && message.kind !== "tool.cancel") return;
  if (message.kind === "tool.cancel") {
    writeFileSync(process.env.CANCELLED, message.invocationId);
    process.send({ kind: "tool.result", invocationId: message.invocationId, outcome: { status: "succeeded", output: "late" } });
    return;
  }
  seen += 1;
  if (seen > 1) process.send({ kind: "tool.result", invocationId: message.invocation.invocationId, outcome: { status: "succeeded", output: "second" } });
});
process.send({ kind: "executor.hello", targetId: process.env.OPENBOT_TARGET_ID });
`,
	);
	const executor = await executorProcess(root, entry, { invokeTimeoutMs: 400, env: { CANCELLED: cancelled } });
	try {
		const first = await executor.invoke(invocation("call-1"), () => {}, new AbortController().signal);
		expect(first).toMatchObject({
			status: "unknown",
			output: "The local executor timed out before reporting a result; the action may have partly run",
		});
		await vi.waitFor(async () => expect(await readFile(cancelled, "utf8")).toBe("call-1"));
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(first.output).toContain("timed out");
		await expect(executor.invoke(invocation("call-2"), () => {}, new AbortController().signal)).resolves.toEqual({
			status: "succeeded",
			output: "second",
		});
	} finally {
		await executor.stop();
		await rm(root, { recursive: true, force: true });
	}
}, 20_000);

it("releases child processes, listeners, and file handles when a shutdown step throws", async () => {
	const root = await mkdtemp(join(tmpdir(), "openbot-executor-shutdown-"));
	const workspace = join(root, "workspace");
	const data = join(root, "data");
	const marker = join(root, "executor-marker");
	const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", executorEntry], {
		stdio: ["ignore", "pipe", "pipe", "ipc"],
		env: {
			PATH: process.env.PATH,
			HOME: process.env.HOME,
			TMPDIR: process.env.TMPDIR,
			OPENBOT_TARGET_ID: "local:test",
			OPENBOT_WORKSPACE: workspace,
			OPENBOT_DATA_DIR: data,
			OPENBOT_SHUTDOWN_FAULT: "artifacts",
			OPENBOT_SHUTDOWN_MARKER: marker,
		},
	});
	let host: ChildProcess | undefined;
	const output: Buffer[] = [];
	child.stdout?.on("data", (chunk: Buffer) => output.push(chunk));
	child.stderr?.on("data", (chunk: Buffer) => output.push(chunk));
	try {
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error(`executor did not become ready\n${Buffer.concat(output).toString("utf8")}`)), 15_000);
			child.once("message", () => {
				clearTimeout(timer);
				resolve();
			});
			child.once("exit", (code, signal) => {
				clearTimeout(timer);
				reject(new Error(`executor exited before ready (${signal ?? code})\n${Buffer.concat(output).toString("utf8")}`));
			});
		});
		const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
		child.disconnect();
		const code = await Promise.race([
			exited,
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error("executor shutdown hung")), 2_000)),
		]);
		expect(code).toBe(0);
		expect(await readFile(marker, "utf8")).toBe("closed");
		const database = new DatabaseSync(join(data, "executor", "receipts.sqlite"));
		expect(database.prepare("select count(*) as count from receipts").get()).toEqual({ count: 0 });
		database.close();

		const home = join(root, "home");
		const hostData = join(root, "host-data");
		const hostWorkspace = join(root, "host-workspace");
		const hostMarker = join(root, "host-marker");
		const pidfile = join(root, "executor.pid");
		const fake = join(root, "fake-executor.mjs");
		await writeFile(
			fake,
			`import { writeFileSync } from "node:fs";
writeFileSync(process.env.PIDFILE, String(process.pid));
process.on("disconnect", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
process.on("message", (message) => {
  if (message.kind === "policy.sync") process.send({ kind: "policy.synced", messageId: message.messageId, confirmed: true });
  if (message.kind === "execution.quiesce" || message.kind === "execution.revoke") process.send({ kind: "execution.quiesced", messageId: message.messageId, confirmed: true });
  if (message.kind === "tasks.inspect") process.send({ kind: "tasks.inspected", messageId: message.messageId, receipts: [] });
});
process.send({ kind: "executor.hello", targetId: process.env.OPENBOT_TARGET_ID });
setInterval(() => {}, 1000);
`,
		);
		host = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", hostEntry], {
			stdio: ["ignore", "pipe", "pipe", "ipc"],
			env: {
				PATH: process.env.PATH,
				HOME: process.env.HOME,
				TMPDIR: process.env.TMPDIR,
				USER: process.env.USER,
				OPENBOT_DATA_DIR: hostData,
				OPENBOT_WORKSPACE: hostWorkspace,
				OPENBOT_HOME: home,
				OPENBOT_EXECUTOR_ENTRY: fake,
				OPENBOT_SHUTDOWN_FAULT: "pause",
				OPENBOT_SHUTDOWN_MARKER: hostMarker,
				PIDFILE: pidfile,
			},
		});
		const hostOutput: Buffer[] = [];
		host.stdout?.on("data", (chunk: Buffer) => hostOutput.push(chunk));
		host.stderr?.on("data", (chunk: Buffer) => hostOutput.push(chunk));
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error(`host did not become ready\n${Buffer.concat(hostOutput).toString("utf8")}`)), 30_000);
			const onExit = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
				clearTimeout(timer);
				reject(new Error(`host exited before ready (${signal ?? exitCode})\n${Buffer.concat(hostOutput).toString("utf8")}`));
			};
			const onMessage = (message: unknown): void => {
				if (!message || typeof message !== "object" || !("kind" in message) || message.kind !== "ready") return;
				clearTimeout(timer);
				host?.off("message", onMessage);
				host?.off("exit", onExit);
				resolve();
			};
			host?.on("message", onMessage);
			host?.on("exit", onExit);
		});
		const executorPid = Number(await readFile(pidfile, "utf8"));
		expect(alive(executorPid)).toBe(true);
		const hostExited = new Promise<number | null>((resolve) => host?.once("exit", (exitCode) => resolve(exitCode)));
		host.disconnect();
		expect(await Promise.race([
			hostExited,
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`host shutdown hung\n${Buffer.concat(hostOutput).toString("utf8")}`)), 15_000)),
		])).toBe(0);
		expect(await readFile(hostMarker, "utf8")).toBe("closed");
		await expect(access(join(hostData, "host.lock"))).rejects.toThrow();
		await vi.waitFor(() => expect(alive(executorPid)).toBe(false));
	} finally {
		if (child.exitCode === null && child.signalCode === null && child.pid !== undefined) {
			try {
				process.kill(child.pid, "SIGKILL");
			} catch {
				// Already gone.
			}
		}
		if (host?.exitCode === null && host?.signalCode === null && host.pid !== undefined) {
			try {
				process.kill(host.pid, "SIGKILL");
			} catch {
				// Already gone.
			}
		}
		await rm(root, { recursive: true, force: true });
	}
}, 45_000);
