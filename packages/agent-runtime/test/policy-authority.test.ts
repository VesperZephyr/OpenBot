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
