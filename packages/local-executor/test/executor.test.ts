import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolInvocation } from "@openbot/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalExecutor, ReceiptLedger } from "../src/index.ts";

describe("LocalExecutor", () => {
	let root: string;
	let workspace: string;
	let outside: string;
	let executor: LocalExecutor;
	let ledger: ReceiptLedger;
	let next = 0;

	const invocation = (tool: ToolInvocation["tool"], args: Record<string, unknown>, overrides: Partial<ToolInvocation> = {}): ToolInvocation => ({
		invocationId: `inv-${++next}`,
		botId: "bot",
		conversationId: "1",
		tool,
		args,
		argsDigest: JSON.stringify(args),
		target: { kind: "local", targetId: "mac" },
		grants: [workspace],
		readGrants: [],
		deadline: Date.now() + 60_000,
		...overrides,
	});
	const run = (inv: ToolInvocation) => executor.invoke(inv, () => {});

	beforeEach(async () => {
		root = await realpath(await mkdtemp(join(tmpdir(), "openbot-exec-")));
		workspace = join(root, "workspace");
		outside = join(root, "outside");
		await mkdir(workspace);
		await mkdir(outside);
		await writeFile(join(outside, "secret.txt"), "secret");
		ledger = ReceiptLedger.open(join(root, "receipts.sqlite"));
		executor = new LocalExecutor({ targetId: "mac", workspace, ledger, artifactsDirectory: join(root, "artifacts") });
	});

	afterEach(async () => {
		ledger.close();
		await rm(root, { recursive: true, force: true });
	});

	it("refuses paths outside the grants, including through a symbolic link", async () => {
		await symlink(outside, join(workspace, "link"));
		for (const path of [join(outside, "secret.txt"), "../outside/secret.txt", "link/secret.txt"]) {
			const outcome = await run(invocation("local_read", { path }));
			expect(outcome.status).toBe("failed");
			expect(outcome.output).toMatch(/^Access denied: /);
		}
		expect((await run(invocation("local_write", { path: "link/new.txt", content: "x" }))).status).toBe("failed");
	});

	it("reads but never writes inside a read-only grant", async () => {
		const readOnly = { readGrants: [outside] };
		const read = await run(invocation("local_read", { path: join(outside, "secret.txt") }, readOnly));
		expect(read).toMatchObject({ status: "succeeded" });
		expect((await run(invocation("local_list", { path: outside }, readOnly))).status).toBe("succeeded");
		const write = await run(invocation("local_write", { path: join(outside, "new.txt"), content: "x" }, readOnly));
		expect(write.output).toMatch(/^Access denied: /);
		const edit = await run(invocation("local_edit", { path: join(outside, "secret.txt"), old_text: "secret", new_text: "gone" }, readOnly));
		expect(edit.output).toMatch(/^Access denied: /);
		expect(await readFile(join(outside, "secret.txt"), "utf8")).toBe("secret");
	});

	it("refuses another target", async () => {
		const outcome = await run(invocation("local_list", { path: "." }, { target: { kind: "local", targetId: "other" } }));
		expect(outcome).toMatchObject({ status: "failed" });
	});

	it("writes, edits with a unique match, and reads back with line numbers", async () => {
		expect((await run(invocation("local_write", { path: "notes/a.txt", content: "one\ntwo\ntwo\n" }))).status).toBe("succeeded");
		const ambiguous = await run(invocation("local_edit", { path: "notes/a.txt", old_text: "two", new_text: "2" }));
		expect(ambiguous).toMatchObject({ status: "failed" });
		expect(ambiguous.output).toContain("appears 2 times");
		expect((await run(invocation("local_edit", { path: "notes/a.txt", old_text: "one", new_text: "1" }))).status).toBe("succeeded");
		expect(await readFile(join(workspace, "notes/a.txt"), "utf8")).toBe("1\ntwo\ntwo\n");
		const read = await run(invocation("local_read", { path: "notes/a.txt", offset: 2, limit: 1 }));
		expect(read.output).toContain("     2\ttwo");
		expect(read.output).toContain("continue with offset=3");
	});

	it("runs a repeated invocation once and refuses its ID with other arguments", async () => {
		const first = invocation("local_exec", { command: "echo run >> count.txt", description: "count" });
		await run(first);
		await run(first);
		expect(await readFile(join(workspace, "count.txt"), "utf8")).toBe("run\n");
		const reused = await run({ ...first, argsDigest: "different" });
		expect(reused.output).toContain("other arguments");
	});

	it("reports exit status separately and cancels the whole process group", async () => {
		const failed = await run(invocation("local_exec", { command: "echo oops >&2; exit 3", description: "fail" }));
		expect(failed).toMatchObject({ status: "failed", exit: { code: 3 } });
		expect(failed.output).toContain("oops");

		const long = invocation("local_exec", { command: "sleep 30 & sleep 30; echo never", description: "wait" });
		const outcome = executor.invoke(long, () => {});
		await new Promise((resolve) => setTimeout(resolve, 300));
		executor.cancel(long.invocationId);
		const settled = await outcome;
		expect(settled.status).toBe("cancelled");
		expect(settled.output).not.toContain("never");
	});

	it("does not pass credentials to commands", async () => {
		process.env.OPENBOT_TEST_API_KEY = "sk-should-not-leak";
		try {
			const outcome = await run(invocation("local_exec", { command: "env", description: "env" }));
			expect(outcome.output).not.toContain("sk-should-not-leak");
			expect(outcome.output).toContain("PATH=");
		} finally {
			delete process.env.OPENBOT_TEST_API_KEY;
		}
	});
});
