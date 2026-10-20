import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { BotRuntime } from "../src/index.ts";
import { SCRIPTED_MODEL } from "../src/testing.ts";
import { TOOL_CATALOG, type RoutineOccurrence } from "@openbot/protocol";
let runtime: BotRuntime | undefined, root: string;
afterEach(async () => {
	await runtime?.close();
	if (root) await rm(root, { recursive: true, force: true });
});
it("isolates occurrence input, excludes management tools and publishes once without inference or private steering", async () => {
	root = await mkdtemp(join(tmpdir(), "openbot-routine-context-"));
	const requests: string[] = [];
	const faux = fauxProvider();
	faux.setResponses(
		Array.from({ length: 8 }, () => (context) => {
			requests.push(JSON.stringify(context));
			return fauxAssistantMessage("Answer");
		}),
	);
	const models = createModels();
	models.setProvider(faux.provider);
	const open = () =>
		BotRuntime.open({
			databasePath: join(root, "db.sqlite"),
			models,
			tools: { definitions: TOOL_CATALOG, invoke: async () => ({ status: "succeeded", output: "test" }) },
		});
	runtime = await open();
	const core = (await runtime.ensureCoreBot(1)).botId;
	await runtime.updateBot(core, { model: SCRIPTED_MODEL });
	await runtime.submitAndWait(core, "private", "PRIVATE_CANARY");
	const channel = "routine_example";
	const id = await runtime.ensureChannel(core, channel);
	expect(await runtime.ensureChannel(core, channel)).toBe(id);
	await runtime.submitAndWait(core, "occurrence", "WORKFLOW_CANARY", channel);
	expect(requests[1]).not.toContain("PRIVATE_CANARY");
	for (const tool of ["bot_create", "group_create", "bot_delegate", "app_bots_list", "codemode"])
		expect(requests[1]).not.toContain(`"name":"${tool}"`);
	expect(requests[1]).toContain('"name":"local_read"');
	const occurrence: RoutineOccurrence = {
		occurrenceId: "routine:r:123",
		routineId: "r",
		botId: core,
		revision: 1,
		channelId: channel,
		name: "Daily report",
		scheduledAt: 123,
		createdAt: 123,
		test: false,
		state: "completed",
		report: "RESULT_CANARY",
		endedAt: 456,
		instructions: "WORKFLOW_CANARY",
		skills: [],
	};
	const count = requests.length;
	await runtime.publishRoutineReport(core, occurrence);
	await runtime.publishRoutineReport(core, occurrence);
	expect(requests).toHaveLength(count);
	const snapshot = await runtime.snapshot(core);
	expect(snapshot.items.filter((i) => i.kind === "assistant" && i.routine)).toHaveLength(1);
	expect(JSON.stringify(snapshot.items)).not.toContain("WORKFLOW_CANARY");
	await runtime.submitAndWait(core, "next", "Next private input");
	expect(requests.at(-1)).not.toContain("RESULT_CANARY");
	expect(requests.at(-1)).not.toContain("WORKFLOW_CANARY");
	await runtime.close();
	runtime = await open();
	await runtime.publishRoutineReport(core, occurrence);
	expect((await runtime.snapshot(core)).items.filter((i) => i.kind === "assistant" && i.routine)).toHaveLength(1);
	await runtime.submitAndWait(core, "again", "Fresh occurrence", channel);
	expect(requests.at(-1)).not.toContain('"name":"bot_create"');
});
