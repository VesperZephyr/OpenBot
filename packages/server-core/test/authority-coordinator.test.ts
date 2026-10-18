import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { BotRuntime } from "@openbot/agent-runtime";
import { scriptedModels } from "@openbot/agent-runtime/testing";
import { ApprovalBook } from "../src/approvals.ts";
import { AuthorityCoordinator } from "../src/authority.ts";
let root: string, runtime: BotRuntime, book: ApprovalBook;
const executor = { synchronize: vi.fn(async (_revision: number) => {}), revoke: vi.fn(async (_ids: readonly string[]) => {}) };
function coordinator() {
	return new AuthorityCoordinator({
		runtime,
		workspace: root,
		dataDirectory: root,
		targetId: "mac",
		approvals: book,
		executor,
		interrupt: async (_ids, stop) => stop(),
	});
}
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "openbot-coordinator-"));
	runtime = await BotRuntime.open({ databasePath: join(root, "db"), models: scriptedModels().models });
	await runtime.policy().bind("mac");
	book = new ApprovalBook(() => {});
	await book.start(runtime.approvals());
	executor.revoke.mockReset().mockResolvedValue();
	executor.synchronize.mockReset().mockResolvedValue();
});
afterEach(async () => {
	book.close();
	await runtime.close();
	await rm(root, { recursive: true, force: true });
});
it("fences a stale allowed call after policy preparation without dispatching", async () => {
	const authority = coordinator(),
		store = runtime.policy();
	await authority.change(() => store.update({ commandSetting: "allow" }));
	await authority.reconcile();
	const call = {
		botId: "b",
		conversationId: "1",
		callId: "call",
		tool: "local_exec",
		args: { command: "echo danger" },
		signal: new AbortController().signal,
	};
	const binding = await authority.binding(call, "d");
	await authority.change(() => store.update({ commandSetting: "never" }));
	await authority.reconcile();
	const invoke = vi.fn();
	await expect(authority.dispatch(call, false, binding, invoke)).rejects.toThrow("permission_revoked");
	expect(invoke).not.toHaveBeenCalled();
});
it("retains a failed stop intent across reopen and reconciles only selected work", async () => {
	const store = runtime.policy(),
		authority = coordinator();
	await store.addGrant({ id: "g", path: "/outside", access: "readwrite", createdAt: 0 });
	const revision = (await store.settings()).revision;
	await store.remember({
		id: "affected",
		botId: "b",
		conversationId: "1",
		tool: "local_exec",
		argsJson: JSON.stringify({ command: "sleep 30" }),
		revision,
	});
	await store.remember({
		id: "unrelated",
		botId: "c",
		conversationId: "2",
		tool: "local_read",
		argsJson: JSON.stringify({ path: join(root, "safe") }),
		revision,
	});
	await authority.change(() => store.revokeGrant("g"));
	executor.revoke.mockRejectedValueOnce(new Error("ack lost"));
	await expect(authority.reconcile()).rejects.toThrow("ack lost");
	expect(executor.revoke).toHaveBeenLastCalledWith(["affected"]);
	expect((await store.settings()).reconciliation?.state).toBe("attention");
	book.close();
	await runtime.close();
	runtime = await BotRuntime.open({ databasePath: join(root, "db"), models: scriptedModels().models });
	book = new ApprovalBook(() => {});
	await book.start(runtime.approvals());
	await coordinator().reconcile();
	expect((await runtime.policy().settings()).reconciliation?.state).toBe("complete");
	expect((await runtime.policy().operations()).map((o) => o.id)).toEqual(["unrelated"]);
	expect(await runtime.policy().grants()).toEqual([]);
});
it("does not hold the authority lock while a command is running", async () => {
	const authority = coordinator(),
		store = runtime.policy();
	await authority.change(() => store.update({ commandSetting: "allow" }));
	await authority.reconcile();
	const call = {
			botId: "b",
			conversationId: "1",
			callId: "call",
			tool: "local_exec",
			args: { command: "sleep 30" },
			signal: new AbortController().signal,
		},
		finished = Promise.withResolvers<import("@openbot/protocol").ToolOutcome>();
	const binding = await authority.binding(call, "d"),
		result = authority.dispatch(call, false, binding, () => finished.promise);
	await expect.poll(async () => (await store.operations()).length).toBe(1);
	await authority.change(() => store.update({ commandSetting: "never" }));
	await authority.reconcile();
	expect(executor.revoke).toHaveBeenLastCalledWith(["1:call"]);
	finished.resolve({ status: "cancelled", output: "stopped" });
	await result;
});

it("a denied invocation cannot be reauthorized by a later blanket allow", async () => {
	const authority = coordinator(),
		store = runtime.policy();
	await authority.change(() => store.update({ commandSetting: "allow" }));
	await authority.reconcile();
	const call = {
		botId: "b",
		conversationId: "1",
		callId: "denied",
		tool: "local_exec",
		args: { command: "echo forbidden" },
		signal: new AbortController().signal,
	};
	await runtime
		.approvals()
		.put({
			approvalId: "approval:1:denied",
			botId: "b",
			conversationId: "1",
			callId: "denied",
			tool: "local_exec",
			args: call.args,
			target: { kind: "local", targetId: "mac" },
			reason: "",
			createdAt: Date.now(),
			state: "denied",
			decision: "deny",
		});
	const invoke = vi.fn();
	await expect(authority.dispatch(call, false, await authority.binding(call, "d"), invoke)).rejects.toThrow("denied");
	expect(invoke).not.toHaveBeenCalled();
});
