import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BotRuntime } from "@openbot/agent-runtime";
import { scriptedModels } from "@openbot/agent-runtime/testing";
import { afterEach, beforeEach, expect, it } from "vitest";
import { BotManagement, type ManagementCall } from "../src/bot-management.ts";
import { Groups } from "../src/groups.ts";
import { RunScheduler } from "../src/runs.ts";
import { ApprovalBook } from "../src/approvals.ts";
let root: string;
let runtime: BotRuntime;
let groups: Groups;
let call: ManagementCall;
let runs: RunScheduler;
let stopped: string[];
beforeEach(async () => {
	stopped = [];
	root = await mkdtemp(join(tmpdir(), "openbot-group-auth-"));
	runtime = await BotRuntime.open({ databasePath: join(root, "db"), models: scriptedModels().models });
	const core = await runtime.ensureCoreBot(1);
	for (const id of ["a", "b"]) await runtime.createBot({ botId: id, name: id, createdAt: 1 });
	await runtime.runsStore().put({
		runId: "r",
		botId: core.botId,
		state: "running",
		origin: "user",
		requestIds: ["p"],
		messages: [{ requestId: "p", text: "Create group" }],
		inputs: [],
		createdAt: 1,
	});
	const authority = new BotManagement(runtime, "mac", Date.now);
	runs = new RunScheduler({ runtime, maxActiveRuns: 3, changed: () => {}, now: Date.now });
	groups = new Groups({
		runtime,
		authority,
		runs,
		approvals: new ApprovalBook(() => {}),
		changed: () => {},
		settled: () => {},
		stopping: (botId, groupId) => {
			stopped.push(`${botId}:${groupId}`);
		},
	});
	call = {
		botId: core.botId,
		conversationId: await runtime.conversationKey(core.botId),
		callId: "create",
		tool: "group_create",
		args: { name: "Studio", objective: "Research", memberIds: ["a", "b"], leadBotId: "a" },
		authority: { origin: "user", runId: "r" },
		signal: new AbortController().signal,
	};
});
afterEach(async () => {
	await groups.stop();
	runs.stop();
	await runtime.close();
	await rm(root, { recursive: true, force: true });
});
async function approve(c: ManagementCall) {
	expect((await groups.prepare(c)).kind).toBe("ask");
	await runtime.approvals().put({
		approvalId: `approval:${c.conversationId}:${c.callId}`,
		botId: c.botId,
		callId: c.callId,
		tool: c.tool,
		args: c.args,
		target: { kind: "local", targetId: "mac" },
		reason: "Review",
		createdAt: 1,
		state: "allowed",
		decision: "allow_once",
	});
}
it("rejects specialists, Core group contexts, forged user origins and mismatched exact approvals", async () => {
	await runtime.ensureChannel(call.botId, "group");
	for (const probe of [
		{ ...call, botId: "a", conversationId: await runtime.conversationKey("a") },
		{ ...call, conversationId: await runtime.conversationKey(call.botId, "group") },
		{ ...call, authority: { origin: "user" as const, runId: "missing" } },
		{ ...call, args: { ...call.args, targetId: "other" } },
	])
		expect((await groups.prepare(probe)).kind).toBe("deny");
	await groups.prepare(call);
	expect((await groups.manage(call)).status).toBe("failed");
	await approve(call);
	expect((await groups.manage({ ...call, args: { ...call.args, name: "Forged" } })).status).toBe("failed");
	const first = await groups.manage(call);
	expect(first.status).toBe("succeeded");
	expect(await groups.manage(call)).toEqual(first);
	expect(await runtime.groups().list()).toHaveLength(1);
	await runtime.runsStore().put({ ...(await runtime.runsStore().get("r"))!, channelId: "group" });
	expect((await groups.prepare({ ...call, callId: "new" })).kind).toBe("deny");
});
it("revalidates revisions after approval and retains denial after approval pruning", async () => {
	await approve(call);
	const g = JSON.parse((await groups.manage(call)).output);
	const edit = { ...call, callId: "edit", tool: "group_update", args: { ...call.args, groupId: g.groupId, expectedRevision: 1 } };
	await approve(edit);
	await runtime.groups().change(
		{
			requestId: "ui",
			action: "update",
			groupId: g.groupId,
			expectedRevision: 1,
			fields: { name: "Other", objective: "", memberIds: ["a", "b"], leadBotId: "b" },
		},
		2,
	);
	expect((await groups.manage(edit)).output).toContain("changed");
	const denied = { ...call, callId: "denied" };
	await groups.prepare(denied);
	await runtime.groups().settleIntent(`${call.conversationId}:denied`, "denied");
	await runtime.approvals().prune(Date.now());
	expect((await groups.prepare(denied)).kind).toBe("deny");
});

it("stops only existing group conversations when dissolving an unused or active group", async () => {
	await approve(call);
	const group = JSON.parse((await groups.manage(call)).output);
	await groups.change({ requestId: "dissolve-unused", action: "dissolve", groupId: group.groupId, expectedRevision: 1 });
	expect(stopped).toEqual([]);
	const next = { ...call, callId: "another" };
	await approve(next);
	const active = JSON.parse((await groups.manage(next)).output);
	await runtime.ensureChannel("a", active.groupId);
	await runtime.ensureChannel(call.botId, active.groupId);
	await groups.change({ requestId: "dissolve-active", action: "dissolve", groupId: active.groupId, expectedRevision: 1 });
	expect(stopped.sort()).toEqual([`a:${active.groupId}`, `${call.botId}:${active.groupId}`].sort());
});
