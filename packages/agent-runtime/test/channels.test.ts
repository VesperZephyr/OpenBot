import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { BotRuntime } from "../src/index.ts";
import { SCRIPTED_MODEL } from "../src/testing.ts";
let directory: string;
let runtime: BotRuntime;
let requests: string[];
const open = async () => {
	const faux = fauxProvider();
	faux.setResponses(
		Array.from({ length: 20 }, () => (context) => {
			requests.push(JSON.stringify(context.messages));
			return fauxAssistantMessage("Done");
		}),
	);
	const models = createModels();
	models.setProvider(faux.provider);
	return BotRuntime.open({ databasePath: join(directory, "db.sqlite"), models });
};
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "openbot-channels-"));
	requests = [];
	runtime = await open();
});
afterEach(async () => {
	await runtime.close();
	await rm(directory, { recursive: true, force: true });
});
it("preserves direct identity, isolates channel context and resolves each Bot's Prompt and memory after restart", async () => {
	await runtime.createBot({
		botId: "a",
		name: "Alpha",
		model: SCRIPTED_MODEL,
		instructions: "ALPHA_PROMPT",
		memory: "ALPHA_MEMORY",
		createdAt: 0,
	});
	await runtime.createBot({
		botId: "b",
		name: "Beta",
		model: SCRIPTED_MODEL,
		instructions: "BETA_PROMPT",
		memory: "BETA_MEMORY",
		createdAt: 0,
	});
	const direct = await runtime.conversationKey("a");
	const group = await runtime.ensureChannel("a", "group-one");
	expect(await runtime.ensureChannel("a", "group-one")).toBe(group);
	await runtime.ensureChannel("b", "group-one");
	await runtime.submitAndWait("a", "direct", "DIRECT_SECRET");
	await runtime.submitAndWait("a", "group", "GROUP_TASK", "group-one");
	expect(requests[1]).toContain("ALPHA_PROMPT");
	expect(requests[1]).toContain("ALPHA_MEMORY");
	expect(requests[1]).not.toContain("DIRECT_SECRET");
	await runtime.submitAndWait("b", "group", "B_TASK", "group-one");
	expect(requests[2]).toContain("BETA_MEMORY");
	expect(requests[2]).not.toContain("ALPHA_MEMORY");
	await runtime.updateBot("a", { instructions: "UPDATED_PROMPT" });
	await runtime.reset("a", "group-one");
	await runtime.submitAndWait("a", "new", "NEW_GROUP_TASK", "group-one");
	expect(requests[3]).toContain("UPDATED_PROMPT");
	expect(requests[3]).toContain("ALPHA_MEMORY");
	expect(requests[3]).not.toContain('"GROUP_TASK"');
	expect(JSON.stringify((await runtime.snapshot("a")).items)).toContain("DIRECT_SECRET");
	await runtime.close();
	runtime = await open();
	expect(await runtime.conversationKey("a")).toBe(direct);
	expect(await runtime.ensureChannel("a", "group-one")).toBe(group);
	expect((await runtime.snapshot("a", "group-one")).channelId).toBe("group-one");
	await expect(runtime.snapshot("a", "unknown")).rejects.toThrow("Unknown Bot channel");
});

it("projects shared topics into private and routine contexts, excludes groups and suppresses forgotten shared facts", async () => {
	await runtime.createBot({ botId: "a", name: "Alpha", model: SCRIPTED_MODEL, memory: "## City\nLOCAL_CITY\n\n## Work\nALPHA_WORK", createdAt: 0 });
	await runtime.createBot({ botId: "b", name: "Beta", model: SCRIPTED_MODEL, memory: "BETA_WORK", createdAt: 0 });
	await runtime.setSharedMemory("## City\nSHARED_CITY", 0);
	await runtime.ensureChannel("a", "group_test");
	await runtime.ensureChannel("a", "routine_test");
	await runtime.submitAndWait("a", "private", "Hello");
	await runtime.submitAndWait("a", "routine", "Hello", "routine_test");
	await runtime.submitAndWait("a", "group", "Hello", "group_test");
	await runtime.submitAndWait("b", "private-b", "Hello");
	for (const index of [0, 1, 3]) expect(requests[index]).toContain("SHARED_CITY");
	for (const index of [0, 1]) { expect(requests[index]).not.toContain("LOCAL_CITY"); expect(requests[index]).toContain("ALPHA_WORK"); }
	expect(requests[2]).not.toContain("SHARED_CITY");
	expect(requests[2]).toContain("LOCAL_CITY");
	expect(requests[3]).not.toContain("ALPHA_WORK");
	expect(requests[1]).toContain("Memory learning is unavailable");
	expect(requests[2]).toContain("Memory learning is unavailable");
	await runtime.setSharedMemory("", 1);
	await runtime.reset("a");
	await runtime.submitAndWait("a", "forgotten", "Hello again");
	expect(requests[4]).not.toContain("SHARED_CITY");
	expect(requests[4]).not.toContain("LOCAL_CITY");
});
