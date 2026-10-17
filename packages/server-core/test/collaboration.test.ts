import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BotRuntime } from "@openbot/agent-runtime";
import { scriptedModels, SCRIPTED_MODEL, type ScriptedModels } from "@openbot/agent-runtime/testing";
import { TOOL_CATALOG } from "@openbot/protocol";
import { afterEach, beforeEach, expect, it } from "vitest";
import { Groups } from "../src/groups.ts";
import { RunScheduler } from "../src/runs.ts";
import { BotManagement, type ManagementCall } from "../src/bot-management.ts";
import { ApprovalBook } from "../src/approvals.ts";
let root: string;
let runtime: BotRuntime;
let groups: Groups;
let runs: RunScheduler;
let model: ScriptedModels;
let calls: ManagementCall[];
async function open() {
	model = scriptedModels();
	calls = [];
	runtime = await BotRuntime.open({
		databasePath: join(root, "db"),
		models: model.models,
		tools: {
			definitions: TOOL_CATALOG,
			invoke: async (call) => {
				calls.push(call);
				const gate = await groups.executionGate(call);
				if (gate?.kind === "deny") return { status: "failed", output: gate.reason };
				return groups.collaborate(call);
			},
		},
	});
	runs = new RunScheduler({ runtime, maxActiveRuns: 1, changed: () => {}, now: Date.now, admissible: (r) => groups.admissible(r) });
	groups = new Groups({
		runtime,
		authority: new BotManagement(runtime, "mac", Date.now),
		runs,
		approvals: new ApprovalBook(() => {}),
		changed: () => {},
		settled: () => {},
		stopping: () => {},
	});
}
async function close() {
	await groups.stop();
	runs.stop();
	await runtime.close();
}
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "openbot-collaboration-"));
	await open();
	await runtime.ensureCoreBot(1);
	await runtime.setDefaultModel(SCRIPTED_MODEL);
	for (const id of ["a", "b"]) await runtime.createBot({ botId: id, name: id, createdAt: 1 });
	await runtime
		.groups()
		.change(
			{
				requestId: "create",
				action: "create",
				groupId: "group_g",
				expectedRevision: 0,
				fields: { name: "Team", objective: "", memberIds: ["a", "b"], leadBotId: "a" },
			},
			1,
		);
});
afterEach(async () => {
	await close();
	await rm(root, { recursive: true, force: true });
});
const until = (fn: () => Promise<unknown>) => expect.poll(fn, { timeout: 5000 });
it("binds tool authority to the group Run and returns one result without elevating peer origin", async () => {
	model.answer(
		{ tool: "bot_delegate", args: { botId: "b", task: "Find evidence", expectedResult: "Evidence" } },
		"Assigned",
		"Evidence 42",
		"Synthesis 42",
	);
	await runs.start();
	await groups.start();
	runtime.resume();
	await groups.send("group_g", "task", "Research");
	await until(async () => (await runtime.groups().roots("group_g"))[0]?.state).toBe("completed");
	const deliveries = await runtime.groups().deliveries();
	expect(deliveries).toHaveLength(3);
	expect(deliveries.map((d) => d.origin)).toEqual(["user", "peer", "result"]);
	expect(calls[0]?.authority).toBeUndefined();
	expect(calls[0]?.collaboration?.runId).toBe(deliveries[0]?.runId);
	for (const d of deliveries.slice(1)) expect((await runtime.runsStore().get(d.runId!))?.origin).toBe("peer");
	expect((await groups.snapshot("group_g")).posts.at(-1)?.text).toBe("Synthesis 42");
	expect(model.requests()).toBe(4);
	const before = (await groups.snapshot("group_g")).posts;
	await close();
	await open();
	await runs.start();
	await groups.start();
	runtime.resume();
	expect((await groups.snapshot("group_g")).posts).toEqual(before);
	expect(model.requests()).toBe(0);
});
it("rejects forged actor, direct channel and missing Run provenance; transfer blocks subsequent side effects", async () => {
	await runtime.groups().post("group_g", "p", "Task", ["a"], 1);
	const d = (await runtime.groups().deliveries())[0]!;
	await runtime.ensureChannel("a", "group_g");
	await runtime
		.runsStore()
		.put({
			runId: "run",
			botId: "a",
			channelId: "group_g",
			origin: "user",
			state: "running",
			requestIds: [`delivery:${d.deliveryId}`],
			messages: [],
			inputs: [],
			createdAt: 1,
		});
	const call: ManagementCall = {
		botId: "a",
		conversationId: await runtime.conversationKey("a", "group_g"),
		callId: "handoff",
		tool: "bot_handoff",
		args: { botId: "b", task: "Review", expectedResult: "Findings" },
		collaboration: { runId: "run" },
		signal: new AbortController().signal,
	};
	const { collaboration: _binding, ...unbound } = call;
	for (const probe of [
		{ ...call, botId: "b" },
		{ ...call, conversationId: await runtime.conversationKey("a") },
		unbound,
		{ ...call, collaboration: { runId: "other" } },
	])
		expect((await groups.prepareCollaboration(probe)).kind).toBe("deny");
	expect((await groups.collaborate(call)).status).toBe("succeeded");
	expect((await groups.executionGate({ ...call, tool: "local_exec", callId: "late", args: { command: "echo late" } }))?.kind).toBe("deny");
	expect((await groups.prepare({ ...call, tool: "group_dissolve", authority: { origin: "user", runId: "run" } })).kind).toBe("deny");
	expect((await groups.collaborate(call)).status).toBe("succeeded");
});
it("recovers a persisted outbox after sender completion without re-running the sender", async () => {
	const dPost = await runtime.groups().post("group_g", "p", "Task", ["a"], 1);
	const parent = (await runtime.groups().deliveries())[0]!;
	await runtime.groups().dispatch("call", "hash", parent.deliveryId, "b", "Review", "Findings", true, 2);
	await runtime.groups().finish(parent.deliveryId, "completed", "Transferred", 3);
	await close();
	await open();
	model.answer("Recovered work");
	await runs.start();
	await groups.start();
	runtime.resume();
	await until(async () => (await runtime.groups().roots("group_g"))[0]?.state).toBe("completed");
	expect(model.requests()).toBe(1);
	expect((await groups.snapshot("group_g")).posts.filter((p) => p.text === "Recovered work")).toHaveLength(1);
	expect((await groups.snapshot("group_g")).posts[0]?.postId).toBe(dPost.postId);
});
