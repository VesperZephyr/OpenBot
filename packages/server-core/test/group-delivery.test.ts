import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BotRuntime } from "@openbot/agent-runtime";
import { scriptedModels, SCRIPTED_MODEL, type ScriptedModels } from "@openbot/agent-runtime/testing";
import type { ToolDefinition } from "@openbot/protocol";
import { afterEach, beforeEach, expect, it } from "vitest";
import { Groups } from "../src/groups.ts";
import { RunScheduler } from "../src/runs.ts";
import { BotManagement } from "../src/bot-management.ts";
import { ApprovalBook } from "../src/approvals.ts";
let root: string;
let runtime: BotRuntime;
let groups: Groups;
let runs: RunScheduler;
let model: ScriptedModels;
let entered: boolean;
const waitTool: ToolDefinition = {
	name: "wait",
	description: "Wait",
	parameters: { type: "object", properties: {} },
	capability: "commands",
	destination: "host",
};
async function open(...turns: Parameters<typeof scriptedModels>) {
	model = scriptedModels(...turns);
	entered = false;
	runtime = await BotRuntime.open({
		databasePath: join(root, "db"),
		models: model.models,
		tools: {
			definitions: [waitTool],
			invoke: async ({ signal }) => {
				entered = true;
				await new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
				return { status: "succeeded", output: "never" };
			},
		},
	});
	runs = new RunScheduler({ runtime, maxActiveRuns: 1, changed: () => {}, now: Date.now, admissible: (run) => groups.admissible(run) });
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
	root = await mkdtemp(join(tmpdir(), "openbot-delivery-"));
	await open("Answer");
	await runtime.ensureCoreBot(1);
	for (const id of ["a", "b"]) await runtime.createBot({ botId: id, name: id, createdAt: 1, model: SCRIPTED_MODEL });
	await runtime.groups().change(
		{
			requestId: "c",
			action: "create",
			groupId: "group_g",
			expectedRevision: 0,
			fields: { name: "Group", objective: "", memberIds: ["a", "b"], leadBotId: "a" },
		},
		1,
	);
});
afterEach(async () => {
	await close();
	await rm(root, { recursive: true, force: true });
});
it("recovers a completed Run without its delivery receipt and publishes its exact answer once", async () => {
	await runtime.groups().post("group_g", "p", "Task", ["a"], 2);
	const d = (await runtime.groups().deliveries())[0]!;
	await runtime.ensureChannel("a", "group_g");
	runtime.resume();
	const run = await runs.submit("a", `delivery:${d.deliveryId}`, d.input, { channelId: "group_g", separate: true });
	await expect.poll(async () => (await runtime.runsStore().get(run.runId))?.state).toBe("completed");
	expect(d.runId).toBeUndefined();
	await close();
	await open("Should not be requested");
	await runs.start();
	await groups.start();
	runtime.resume();
	await expect.poll(async () => (await runtime.groups().posts("group_g")).length).toBe(2);
	expect((await runtime.groups().posts("group_g"))[1]?.text).toBe("Answer");
	expect(model.requests()).toBe(0);
	await groups.sweep();
	expect(await runtime.groups().posts("group_g")).toHaveLength(2);
	expect(await runtime.runsStore().list()).toHaveLength(1);
});
it("recovery cancels a dissolved running delivery before resuming the model", async () => {
	await close();
	await open({ tool: "wait", args: {} });
	runtime.resume();
	await groups.send("group_g", "p", "Wait", ["a"]);
	await expect.poll(() => entered).toBe(true);
	await runtime.groups().change({ requestId: "end", action: "dissolve", groupId: "group_g", expectedRevision: 1 }, 3);
	const d = (await runtime.groups().deliveries())[0]!;
	expect((await runtime.runsStore().get(d.runId!))?.state).toBe("running");
	await close();
	await open("Must not resume");
	await runs.start();
	await groups.start();
	runtime.resume();
	await expect.poll(async () => (await runtime.runsStore().get(d.runId!))?.state).toBe("cancelled");
	expect(model.requests()).toBe(0);
	expect(await runtime.groups().posts("group_g")).toHaveLength(1);
});
