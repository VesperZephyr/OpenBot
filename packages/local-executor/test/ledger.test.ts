import { spawn } from "node:child_process";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ToolInvocation } from "@openbot/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ExecutorLedger, LocalExecutor, ReceiptLedger } from "../src/index.ts";

describe("ReceiptLedger", () => {
	let root: string;
	let path: string;
	const open: ReceiptLedger[] = [];
	let next = 0;

	const openLedger = (): ReceiptLedger => {
		const ledger = ReceiptLedger.open(path);
		open.push(ledger);
		return ledger;
	};
	const executorOver = (ledger: ExecutorLedger): LocalExecutor =>
		new LocalExecutor({ targetId: "mac", workspace: root, ledger, artifactsDirectory: join(root, "artifacts") });
	const exec = (command: string): ToolInvocation => ({
		invocationId: `conv:call-${++next}`,
		botId: "bot",
		conversationId: "conv",
		tool: "local_exec",
		args: { command, description: "test" },
		argsDigest: `digest-${command}`,
		target: { kind: "local", targetId: "mac" },
		grants: [root],
		readGrants: [],
		deadline: Date.now() + 60_000,
	});
	const lines = async (): Promise<string[]> =>
		(await readFile(join(root, "count.txt"), "utf8").catch(() => "")).split("\n").filter((line) => line !== "");

	beforeEach(async () => {
		root = await realpath(await mkdtemp(join(tmpdir(), "openbot-ledger-")));
		path = join(root, "receipts.sqlite");
	});

	afterEach(async () => {
		for (const ledger of open.splice(0)) ledger.close();
		await rm(root, { recursive: true, force: true });
	});

	it("repeated invocation returns recorded outcome", async () => {
		const invocation = exec("echo run >> count.txt; echo done");
		const first = await executorOver(openLedger()).invoke(invocation, () => {});
		expect(first.status).toBe("succeeded");
		// A new executor process on the same ledger, as after a restart.
		const again = await executorOver(openLedger()).invoke(invocation, () => {});
		expect(again).toEqual(first);
		expect(await lines()).toEqual(["run"]);
	});

	it("accepted row on open becomes unknown", async () => {
		const ledger = openLedger();
		const invocation = exec("echo run >> count.txt");
		ledger.accept(invocation);
		const reopened = openLedger();
		expect(reopened.get(invocation.invocationId)?.status).toBe("unknown");
		const outcome = await executorOver(reopened).invoke(invocation, () => {});
		expect(outcome.status).toBe("unknown");
		expect(await lines()).toEqual([]);
	});

	it("commits accepted before the side effect", async () => {
		const ledger = openLedger();
		const invocation = exec("echo run >> count.txt");
		// The executor dies right after the insert: the effect never starts, and a rerun must not start it either.
		const crashing: ExecutorLedger = {
			get: (id) => ledger.get(id),
			accept: (inv) => {
				ledger.accept(inv);
				throw new Error("simulated crash");
			},
			recordGroup: () => {},
			finish: () => {},
			ack: () => {},
			recordTask: () => {},
			finishTask: () => {},
			task: () => undefined,
		};
		expect((await executorOver(crashing).invoke(invocation, () => {})).status).toBe("failed");
		expect(ledger.get(invocation.invocationId)?.status).toBe("accepted");
		const rerun = await executorOver(openLedger()).invoke(invocation, () => {});
		expect(rerun.status).toBe("unknown");
		expect(await lines()).toEqual([]);
	});

	it("refuses a known ID with a different digest", async () => {
		const executor = executorOver(openLedger());
		const invocation = exec("echo run >> count.txt");
		await executor.invoke(invocation, () => {});
		const reused = await executorOver(openLedger()).invoke({ ...invocation, argsDigest: "other" }, () => {});
		expect(reused).toMatchObject({ status: "failed" });
		expect(reused.output).toContain("other arguments");
		expect(await lines()).toEqual(["run"]);
	});

	it("prunes acknowledged receipts after the retention period", async () => {
		const invocation = exec("true");
		const ledger = openLedger();
		await executorOver(ledger).invoke(invocation, () => {});
		ledger.ack(invocation.invocationId);
		expect(openLedger().get(invocation.invocationId)?.status).toBe("succeeded");
		const later = ReceiptLedger.open(path, () => Date.now() + 8 * 24 * 60 * 60 * 1000);
		open.push(later);
		expect(later.get(invocation.invocationId)).toBeUndefined();
	});

	it("kills a process group a dead executor left running", async () => {
		const ledger = openLedger();
		const invocation = exec("sleep 30");
		ledger.accept(invocation);
		// The executor started the group, recorded it, then vanished without cleanup.
		const child = spawn("/bin/sh", ["-c", "sleep 30"], { detached: true, stdio: "ignore" });
		const pid = child.pid;
		if (pid === undefined) throw new Error("spawn failed");
		const exited = Promise.withResolvers<void>();
		child.once("exit", () => exited.resolve());
		ledger.recordGroup(invocation.invocationId, pid);
		openLedger();
		await exited.promise;
		expect(() => process.kill(-pid, 0)).toThrow();
	});

	it("leaves a group alone when its leader PID was reused", async () => {
		const ledger = openLedger();
		const invocation = exec("sleep 30");
		ledger.accept(invocation);
		const child = spawn("/bin/sh", ["-c", "sleep 30"], { detached: true, stdio: "ignore" });
		const pid = child.pid;
		if (pid === undefined) throw new Error("spawn failed");
		try {
			ledger.recordGroup(invocation.invocationId, pid);
			// Pretend the recorded start time belongs to an earlier process with the same PID.
			const raw = new DatabaseSync(path);
			raw.prepare("update receipts set leader_started = 'Thu Jan  1 00:00:00 1970' where invocation_id = ?").run(invocation.invocationId);
			raw.close();
			openLedger();
			expect(() => process.kill(-pid, 0)).not.toThrow();
		} finally {
			process.kill(-pid, "SIGKILL");
		}
	});
});
