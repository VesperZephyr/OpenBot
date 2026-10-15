import { mkdir, mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ToolInvocation, ToolOutcome } from "@openbot/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalExecutor, OUTPUT_LIMITS, ReceiptLedger } from "../src/index.ts";

describe("coding tools", () => {
	let root: string;
	let workspace: string;
	let artifacts: string;
	let ledgerPath: string;
	const ledgers: ReceiptLedger[] = [];
	const executors: LocalExecutor[] = [];
	let next = 0;

	const executor = (yieldMs = 60_000): LocalExecutor => {
		const ledger = ReceiptLedger.open(ledgerPath);
		ledgers.push(ledger);
		const created = new LocalExecutor({ targetId: "mac", workspace, ledger, artifactsDirectory: artifacts, yieldMs });
		executors.push(created);
		return created;
	};
	const invocation = (tool: ToolInvocation["tool"], args: Record<string, unknown>): ToolInvocation => ({
		invocationId: `conv:call_${++next}`,
		botId: "bot",
		conversationId: "conv",
		tool,
		args,
		argsDigest: JSON.stringify(args),
		target: { kind: "local", targetId: "mac" },
		grants: [workspace],
		readGrants: [],
		deadline: Date.now() + 60_000,
	});
	const run = (on: LocalExecutor, tool: ToolInvocation["tool"], args: Record<string, unknown>): Promise<ToolOutcome> =>
		on.invoke(invocation(tool, args), () => {});
	/** The process group the ledger recorded for a background task. */
	const taskGroup = (taskId: string): number => {
		const db = new DatabaseSync(ledgerPath);
		try {
			// node:sqlite returns untyped rows; the schema makes `pgid` an integer.
			const row = db.prepare("select pgid from background_tasks where task_id = ?").get(taskId) as { pgid: number };
			return row.pgid;
		} finally {
			db.close();
		}
	};
	const groupAlive = (pgid: number): boolean => {
		try {
			process.kill(-pgid, 0);
			return true;
		} catch {
			return false;
		}
	};

	beforeEach(async () => {
		root = await realpath(await mkdtemp(join(tmpdir(), "openbot-coding-")));
		workspace = join(root, "workspace");
		artifacts = join(root, "artifacts");
		ledgerPath = join(root, "receipts.sqlite");
		await mkdir(workspace);
		await mkdir(artifacts);
	});

	afterEach(async () => {
		await Promise.all(executors.splice(0).map((created) => created.cancelAll()));
		for (const ledger of ledgers.splice(0)) ledger.close();
		await rm(root, { recursive: true, force: true });
	});

	it("cuts long output to head and tail, spills it, and continues with local_read offset", async () => {
		const exec = executor();
		const outcome = await run(exec, "local_exec", { command: "seq 1 3000", description: "count" });
		expect(outcome).toMatchObject({ status: "succeeded", truncated: true });
		expect(Buffer.byteLength(outcome.output)).toBeLessThan(OUTPUT_LIMITS.bytes + 1024);
		expect(outcome.output.split("\n").length).toBeLessThanOrEqual(OUTPUT_LIMITS.lines + 2);
		expect(outcome.output.startsWith("1\n2\n")).toBe(true);
		expect(outcome.output.endsWith("2999\n3000\n")).toBe(true);

		const marker = /local_read path="([^"]+)" offset=(\d+)/.exec(outcome.output);
		expect(marker).not.toBeNull();
		const [, path, offset] = marker!;
		expect(path!.startsWith(artifacts)).toBe(true);
		expect((await stat(path!)).mode & 0o777).toBe(0o600);
		expect((await readFile(path!, "utf8")).split("\n").length).toBe(3001);
		// The first omitted line follows the last line the head showed.
		const lastShown = Number(outcome.output.split("\n[...")[0]!.trim().split("\n").at(-1));
		expect(Number(offset)).toBe(lastShown + 1);

		// The artifacts directory is readable without a grant, and only by local_read.
		const continued = await run(exec, "local_read", { path, offset: Number(offset), limit: 2 });
		expect(continued.status).toBe("succeeded");
		expect(continued.output).toContain(`${String(offset).padStart(6)}\t${offset}\n${String(Number(offset) + 1).padStart(6)}\t${Number(offset) + 1}`);
		expect((await run(exec, "local_list", { path: artifacts })).output).toMatch(/^Access denied/);
	});

	it("refuses an edit when the file changed since it was read", async () => {
		const exec = executor();
		await run(exec, "local_write", { path: "a.txt", content: "one\n" });
		const read = await run(exec, "local_read", { path: "a.txt" });
		const sha = /\[sha256: ([0-9a-f]{64})\]/.exec(read.output)?.[1];
		expect(sha).toBeDefined();
		await run(exec, "local_write", { path: "a.txt", content: "one\nchanged elsewhere\n" });

		const stale = await run(exec, "local_edit", { path: "a.txt", old_text: "one", new_text: "1", expected_sha256: sha });
		expect(stale.status).toBe("failed");
		expect(stale.output).toContain("changed since you read it");
		expect(await readFile(join(workspace, "a.txt"), "utf8")).toBe("one\nchanged elsewhere\n");

		const fresh = /\[sha256: ([0-9a-f]{64})\]/.exec((await run(exec, "local_read", { path: "a.txt" })).output)?.[1];
		const edited = await run(exec, "local_edit", { path: "a.txt", old_text: "one", new_text: "1", expected_sha256: fresh });
		expect(edited.status).toBe("succeeded");
		expect(await readFile(join(workspace, "a.txt"), "utf8")).toBe("1\nchanged elsewhere\n");
	});

	it("lists the line numbers of an ambiguous edit", async () => {
		const exec = executor();
		await run(exec, "local_write", { path: "b.txt", content: "keep\nvalue = 1\nother\nvalue = 1\n\nvalue = 1\n" });
		const ambiguous = await run(exec, "local_edit", { path: "b.txt", old_text: "value = 1", new_text: "value = 2" });
		expect(ambiguous.status).toBe("failed");
		expect(ambiguous.output).toContain("appears 3 times");
		expect(ambiguous.output).toContain("lines 2, 4, 6");
	});

	it("moves a long foreground command to the background and reads its output incrementally", async () => {
		const exec = executor(300);
		const started = await run(exec, "local_exec", { command: "echo first; sleep 1; echo second", description: "slow" });
		expect(started.status).toBe("succeeded");
		expect(started.taskId).toMatch(/^task_/);
		expect(started.output).toContain("first");
		expect(started.output).toContain("moved to the background");

		const running = await run(exec, "task_output", { taskId: started.taskId });
		expect(running.output).toContain("running");
		expect(running.output).not.toContain("first");

		const done = await run(exec, "task_output", { taskId: started.taskId, wait_seconds: 10 });
		expect(done.output).toContain("second");
		expect(done.output).not.toContain("first");
		expect(done.output).toContain("exited with code 0");
		expect(done.exit).toEqual({ code: 0, signal: null });

		const again = await run(exec, "task_output", { taskId: started.taskId });
		expect(again.output).toContain("succeeded; no further output");
	});

	it("starts with background: true and refuses another conversation's task", async () => {
		const exec = executor();
		const started = await run(exec, "local_exec", { command: "sleep 30", description: "wait", background: true });
		expect(started.output).toContain("Started in the background");
		const foreign = await exec.invoke({ ...invocation("task_output", { taskId: started.taskId }), conversationId: "other" }, () => {});
		expect(foreign.status).toBe("failed");
		expect(foreign.output).toContain("Unknown task");
	});

	it("task_stop kills the whole process group", async () => {
		const exec = executor();
		const started = await run(exec, "local_exec", { command: "sleep 30 & sleep 30", description: "two sleeps", background: true });
		const pgid = taskGroup(started.taskId!);
		expect(groupAlive(pgid)).toBe(true);
		const stopped = await run(exec, "task_stop", { taskId: started.taskId });
		expect(stopped.output).toContain("stopped");
		expect(groupAlive(pgid)).toBe(false);
	});

	it("stopping a conversation stops its background tasks", async () => {
		const exec = executor();
		const started = await run(exec, "local_exec", { command: "sleep 30", description: "wait", background: true });
		const pgid = taskGroup(started.taskId!);
		exec.stopTasks("conv");
		const stopped = await run(exec, "task_output", { taskId: started.taskId, wait_seconds: 10 });
		expect(stopped.output).toContain("stopped");
		expect(groupAlive(pgid)).toBe(false);
	});

	it("an executor restart kills a background task and reports it unknown", async () => {
		const first = executor();
		const started = await run(first, "local_exec", { command: "sleep 30", description: "wait", background: true });
		const pgid = taskGroup(started.taskId!);
		expect(groupAlive(pgid)).toBe(true);

		// A new executor on the same ledger, as after the old one died without cleanup.
		const second = executor();
		await expect.poll(() => groupAlive(pgid), { timeout: 5_000 }).toBe(false);
		const reported = await run(second, "task_output", { taskId: started.taskId });
		expect(reported.output).toContain("unknown");
		expect(reported.output).toContain("may have partly run");
	});
});
