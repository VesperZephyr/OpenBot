import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, it, expect } from "vitest";
import { BotRuntime } from "../src/index.ts";
import { scriptedModels } from "../src/testing.ts";
let root: string, runtime: BotRuntime;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "openbot-authority-"));
	runtime = await BotRuntime.open({ databasePath: join(root, "db"), models: scriptedModels().models });
});
afterEach(async () => {
	await runtime.close();
	await rm(root, { recursive: true, force: true });
});
it("binds legacy local authority once and commits Ask first with durable reconciliation", async () => {
	const store = runtime.policy();
	await store.addGrant({ id: "g", path: "/outside", access: "read", createdAt: 0 });
	await store.bind("mac");
	await expect(store.bind("other")).rejects.toThrow("another target");
	const before = await store.settings();
	const rule = {
		id: "r",
		targetId: "mac",
		revision: before.revision + 1,
		createdAt: 0,
		predicate: { tool: "local_exec" as const, program: "git" },
	};
	await store.createAsk(rule, "request", before.revision);
	const change = await store.pendingChange();
	expect(change?.before.settings.askFirst).toEqual([]);
	await store.createAsk({ ...rule, id: "different-allocation" }, "request", before.revision);
	expect((await store.settings()).askFirst).toHaveLength(1);
	await expect(store.createAsk({ ...rule, predicate: { tool: "local_exec", program: "npm" } }, "request", before.revision)).rejects.toThrow(
		"different contents",
	);
	await store.settleChange(change!.reconciliation.id, true);
	await expect(store.deleteAsk("r", "delete", before.revision)).rejects.toThrow("changed");
	await store.deleteAsk("r", "delete", before.revision + 1);
	expect((await store.settings()).askFirst).toEqual([]);
});
it("Always allow commits its resulting revision with the exact approval", async () => {
	const store = runtime.policy();
	await store.bind("mac");
	await runtime
		.approvals()
		.put(
			{
				approvalId: "a",
				botId: "bot",
				callId: "call",
				tool: "local_exec",
				args: { command: "git status" },
				target: { kind: "local", targetId: "mac" },
				reason: "",
				createdAt: 0,
				state: "allowed",
				decision: { kind: "always_allow", scope: { kind: "command", rule: { program: "git", subcommand: "status" } } },
				binding: { origin: "attended", runId: "r", argsDigest: "digest", revision: 0 },
			},
			{ id: "allow", createdAt: 0, scope: { kind: "command", rule: { program: "git", subcommand: "status" } } },
		);
	expect((await runtime.approvals().get("a"))?.binding?.revision).toBe(1);
	expect((await store.snapshot()).settings.rules).toHaveLength(1);
	await expect(
		runtime
			.approvals()
			.put({
				approvalId: "b",
				botId: "bot",
				callId: "call2",
				tool: "local_exec",
				args: {},
				target: { kind: "local", targetId: "mac" },
				reason: "",
				createdAt: 0,
				state: "allowed",
				decision: "allow_once",
				binding: { origin: "attended", argsDigest: "digest", revision: 0 },
			}),
	).rejects.toThrow("authority changed");
});

it("rejects a second policy write until the pending change is reconciled", async () => {
	const store = runtime.policy();
	await store.bind("mac");
	const raced = await Promise.allSettled([store.update({ commandSetting: "allow" }), store.update({ readOnlyDefault: false })]);
	expect(raced[0]?.status).toBe("fulfilled");
	expect(raced[1]?.status).toBe("rejected");
	if (raced[1]?.status !== "rejected") return;
	expect(raced[1].reason).toMatchObject({ code: "request_conflict", message: "Permission changes need reconciliation first" });
	const pending = await store.settings();
	expect(pending).toMatchObject({
		commandSetting: "allow",
		readOnlyDefault: true,
		revision: 1,
		reconciliation: { id: "policy:1", state: "pending" },
	});
	const rule = { id: "r", targetId: "mac", revision: 2, createdAt: 0, predicate: { tool: "local_exec" as const, program: "git" } };
	await expect(store.createAsk(rule, "ask", pending.revision)).rejects.toMatchObject({
		code: "request_conflict",
		message: "Permission changes need reconciliation first",
	});
	await expect(store.addGrant({ id: "g", path: "/outside", access: "read", createdAt: 0 })).rejects.toMatchObject({
		code: "request_conflict",
		message: "Permission changes need reconciliation first",
	});
	expect(await store.grants()).toEqual([]);
	expect((await store.settings()).askFirst).toEqual([]);
	await expect(store.settleChange("policy:other", true)).rejects.toMatchObject({
		code: "request_conflict",
		message: "Permission change identity changed",
	});
	expect((await store.settings()).reconciliation?.state).toBe("pending");
	await store.settleChange("policy:1", false);
	expect((await store.settings()).reconciliation?.state).toBe("attention");
	await expect(store.update({ readOnlyDefault: false })).rejects.toMatchObject({
		code: "request_conflict",
		message: "Permission changes need reconciliation first",
	});
	expect((await store.settings()).readOnlyDefault).toBe(true);
	await store.settleChange("policy:1", true);
	const lifted = await store.update({ readOnlyDefault: false });
	expect(lifted).toMatchObject({ commandSetting: "allow", readOnlyDefault: false, revision: 2 });
});

it("rejects a dispatch record whose policy revision is already stale", async () => {
	const store = runtime.policy();
	await store.bind("mac");
	await store.update({ commandSetting: "allow" });
	const current = await store.settings();
	expect(current).toMatchObject({ revision: 1, reconciliation: { state: "pending" } });
	const operation = { botId: "b", conversationId: "1", tool: "local_exec", argsJson: "{}", revision: 0 };
	await expect(store.remember({ ...operation, id: "stale" })).rejects.toMatchObject({
		code: "request_conflict",
		message: "Permission changed before dispatch",
		details: { currentRevision: 1 },
	});
	expect(await store.operations()).toEqual([]);
	await store.remember({ ...operation, id: "current", revision: current.revision });
	expect(await store.operations()).toEqual([{ ...operation, id: "current", revision: 1 }]);
	expect((await store.settings()).revision).toBe(1);
});

it("rejects a stale Ask first revision, a reused request, and a mismatched target", async () => {
	const store = runtime.policy();
	await store.bind("mac");
	const git = { id: "git", targetId: "mac", revision: 1, createdAt: 0, predicate: { tool: "local_exec" as const, program: "git" } };
	await store.createAsk(git, "create-git", 0);
	await store.settleChange((await store.pendingChange())!.reconciliation.id, true);
	await expect(
		store.createAsk({ ...git, id: "npm", predicate: { tool: "local_exec", program: "npm" } }, "create-npm", 0),
	).rejects.toMatchObject({
		code: "request_conflict",
		message: "Policy changed. Reload before saving your draft.",
		details: { currentRevision: 1 },
	});
	await expect(store.deleteAsk("git", "create-git", 1)).rejects.toMatchObject({
		code: "request_conflict",
		message: "This policy request has different contents",
	});
	await expect(store.createAsk({ ...git, id: "foreign", targetId: "other" }, "wrong-target", 1)).rejects.toMatchObject({
		code: "invalid_request",
		message: "Policy target mismatch",
	});
	const kept = await store.settings();
	expect(kept.revision).toBe(1);
	expect(kept.askFirst.map((rule) => rule.id)).toEqual(["git"]);
	await store.createAsk({ ...git, id: "npm", predicate: { tool: "local_exec", program: "npm" } }, "wrong-target", 1);
	expect((await store.settings()).askFirst.map((rule) => rule.id)).toEqual(["git", "npm"]);
});
