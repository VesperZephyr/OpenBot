import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BotRuntime } from "@openbot/agent-runtime";
import { scriptedModels } from "@openbot/agent-runtime/testing";
import { afterEach, beforeEach, expect, it } from "vitest";
import { BotManagement, type ManagementCall } from "../src/bot-management.ts";

let directory: string;
let runtime: BotRuntime;
let manager: BotManagement;
let call: ManagementCall;
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "openbot-management-"));
	runtime = await BotRuntime.open({ databasePath: join(directory, "db"), models: scriptedModels().models });
	const core = await runtime.ensureCoreBot(1);
	await runtime.runsStore().put({
		runId: "user-run",
		botId: core.botId,
		state: "running",
		origin: "user",
		requestIds: ["request"],
		createdAt: 1,
		messages: [{ requestId: "request", text: "Create helper" }],
		inputs: [],
	});
	manager = new BotManagement(runtime, "mac", () => 10);
	call = {
		botId: core.botId,
		conversationId: await runtime.conversationKey(core.botId),
		callId: "call1",
		tool: "bot_create",
		args: { name: "Helper", instructions: "private-prompt-canary" },
		authority: { origin: "user", runId: "user-run" },
		signal: new AbortController().signal,
	};
});
afterEach(async () => {
	await runtime.close();
	await rm(directory, { recursive: true, force: true });
});
async function approve(c: ManagementCall) {
	expect((await manager.prepare(c)).kind).toBe("ask");
	const proposal = (await runtime.management().get(manager.key(c)))!;
	await runtime.approvals().put({
		approvalId: proposal.approvalId,
		botId: c.botId,
		callId: c.callId,
		tool: c.tool,
		args: c.args,
		target: { kind: "local", targetId: "mac" },
		reason: "Review",
		createdAt: 10,
		state: "allowed",
		decision: "allow_once",
	});
	return manager.confirmed(c);
}
it("binds approval to Core, conversation, user Run, arguments and local target", async () => {
	const specialist = await runtime.createBot({ botId: "s", name: "OpenBot", instructions: "I am Core", createdAt: 2 });
	const probes: ManagementCall[] = [
		{ ...call, botId: specialist.botId, conversationId: await runtime.conversationKey(specialist.botId) },
		{ ...call, conversationId: "forged" },
		{ ...call, authority: undefined } as unknown as ManagementCall,
		{ ...call, args: { ...call.args, targetId: "other" } },
		{ ...call, args: { ...call.args, kind: "core" } },
	];
	for (const probe of probes) expect((await manager.prepare(probe)).kind).toBe("deny");
	await runtime.runsStore().put({ ...(await runtime.runsStore().get("user-run"))!, origin: "peer" });
	expect((await manager.prepare(call)).kind).toBe("deny");
	await runtime.runsStore().put({ ...(await runtime.runsStore().get("user-run"))!, origin: "user" });
	await approve(call);
	expect((await manager.prepare({ ...call, args: { ...call.args, name: "Substitution" } })).kind).toBe("deny");
	await expect(new BotManagement(runtime, "other-mac", Date.now).confirmed(call)).rejects.toThrow("mismatch");
	await expect(manager.confirmed({ ...call, authority: { origin: "user", runId: "later" } })).rejects.toThrow();
});
it("requires explicit approval and rejects cancelled Runs and stale revisions", async () => {
	await manager.prepare(call);
	await expect(manager.confirmed(call)).rejects.toThrow("approval");
	const bot = await runtime.createBot({ botId: "s", name: "Helper", createdAt: 2 });
	const edit = { ...call, tool: "bot_update", args: { botId: bot.botId, expectedRevision: bot.revision, instructions: "new" } };
	// New call identity: a reused call cannot be changed from create to update.
	const editCall = { ...edit, callId: "edit" };
	const proposal = await approve(editCall);
	await runtime.updateBot(bot.botId, { name: "User edit" });
	await expect(manager.confirmed(editCall)).rejects.toThrow("changed");
	await expect(runtime.updateBot(bot.botId, proposal.change, proposal)).rejects.toThrow("changed");
	expect((await runtime.getBot(bot.botId))?.instructions).toBe("");
	const coreDelete = { ...call, callId: "delete-core", tool: "bot_delete", args: { botId: call.botId, expectedRevision: 1 } };
	expect((await manager.prepare(coreDelete)).kind).toBe("deny");
	await runtime.runsStore().put({ ...(await runtime.runsStore().get("user-run"))!, state: "cancelled" });
	await expect(manager.confirmed(call)).rejects.toThrow("no longer active");
});
it("atomically commits creation and receipt, deduplicates after restart, and projects content-free activity", async () => {
	const proposal = await approve(call);
	const input = { botId: proposal.botId, name: "Helper", instructions: "private-prompt-canary", createdAt: 10 };
	const created = await runtime.createBot(input, proposal);
	expect(created.kind).toBe("specialist");
	expect(await runtime.memory(created.botId)).toBe("");
	await runtime.close();
	runtime = await BotRuntime.open({ databasePath: join(directory, "db"), models: scriptedModels().models });
	manager = new BotManagement(runtime, "mac", Date.now);
	expect(await runtime.createBot(input, proposal)).toEqual(created);
	expect((await runtime.listBots()).filter((b) => b.kind === "specialist")).toHaveLength(1);
	const updateCall = {
		...call,
		callId: "update",
		tool: "bot_update",
		args: { botId: created.botId, expectedRevision: 1, instructions: "changed-prompt" },
	};
	const update = await approve(updateCall);
	const edited = await runtime.updateBot(created.botId, update.change, update);
	expect(edited.revision).toBe(2);
	expect(await runtime.updateBot(created.botId, update.change, update)).toEqual(edited);
	const history = await manager.history();
	expect(history.every((r) => r.outcome === "succeeded")).toBe(true);
	expect(JSON.stringify(history)).not.toMatch(/private-prompt|changed-prompt|instructions|fingerprint|Helper/);
});

it("treats nullable update fields as unchanged and requires an explicit default-model reset", async () => {
	const model = { provider: "faux", modelId: "faux-1" };
	const bot = await runtime.createBot({ botId: "s", name: "Helper", role: "Keep role", instructions: "Keep prompt", model, createdAt: 2 });
	const updateCall: ManagementCall = {
		...call,
		tool: "bot_update",
		args: {
			botId: bot.botId,
			expectedRevision: 1,
			name: "Renamed",
			role: null,
			instructions: null,
			model: null,
			thinkingLevel: null,
			useDefaultModel: false,
		},
	};
	const proposal = await approve(updateCall);
	const updated = await runtime.updateBot(bot.botId, proposal.change, proposal);
	expect(updated).toMatchObject({ name: "Renamed", role: "Keep role", instructions: "Keep prompt", model });
	const reset = await approve({
		...call,
		tool: "bot_update",
		callId: "reset-model",
		args: { botId: bot.botId, expectedRevision: 2, useDefaultModel: true, model: null },
	});
	expect((await runtime.updateBot(bot.botId, reset.change, reset)).model).toBeUndefined();
});
it("serializes competing revisions and permanently records denial and cancellation", async () => {
	const bot = await runtime.createBot({ botId: "s", name: "Helper", createdAt: 2 });
	const first = await approve({ ...call, tool: "bot_update", args: { botId: bot.botId, expectedRevision: 1, name: "First" } });
	const second = await approve({ ...call, tool: "bot_delete", callId: "second", args: { botId: bot.botId, expectedRevision: 1 } });
	const results = await Promise.allSettled([
		runtime.updateBot(bot.botId, first.change, first),
		runtime.updateBot(bot.botId, { status: "deleted" }, second),
	]);
	expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
	expect((await runtime.getBot(bot.botId))?.revision).toBe(2);
	const denied = { ...call, callId: "denied" };
	await manager.prepare(denied);
	const pending = (await runtime.management().get(manager.key(denied)))!;
	await runtime
		.approvals()
		.put({
			approvalId: pending.approvalId,
			botId: call.botId,
			callId: denied.callId,
			tool: call.tool,
			args: call.args,
			target: { kind: "local", targetId: "mac" },
			reason: "Review",
			createdAt: 1,
			decidedAt: 2,
			state: "consumed",
			decision: "deny",
		});
	await manager.settled(call.botId, denied.callId, "failed");
	await runtime.approvals().prune(100);
	expect((await manager.history()).find((r) => r.invocationId === pending.invocationId)?.outcome).toBe("denied");
	expect((await manager.prepare(denied)).kind).toBe("deny");
	const cancelled = { ...call, callId: "cancelled" };
	await manager.prepare(cancelled);
	await manager.settled(call.botId, cancelled.callId, "cancelled");
	expect((await manager.prepare(cancelled)).kind).toBe("deny");
});
