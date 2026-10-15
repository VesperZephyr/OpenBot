import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModels } from "@earendil-works/pi-ai/models";
import { type FauxResponseStep, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BotRuntime } from "../src/index.ts";

function fauxModels(answers: FauxResponseStep[]) {
	const faux = fauxProvider();
	faux.setResponses(answers);
	const models = createModels();
	models.setProvider(faux.provider);
	return models;
}

const model = { provider: "faux", modelId: "faux-1" };
const bot = { botId: "scout", name: "Scout", model, createdAt: 0 };

describe("BotRuntime on SQLite", () => {
	let directory: string;
	let databasePath: string;

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "openbot-runtime-"));
		databasePath = join(directory, "openbot.sqlite");
	});

	afterEach(async () => {
		await rm(directory, { recursive: true, force: true });
	});

	it("persists a Bot and its conversation across reopen", async () => {
		const first = await BotRuntime.open({ databasePath, models: fauxModels([fauxAssistantMessage("Paris.")]) });
		await first.createBot({ ...bot, instructions: "Answer in one word." });
		expect(await first.submitAndWait("scout", "req-1", "Capital of France?")).toEqual({
			status: "answered",
			answer: [{ type: "text", text: "Paris." }],
		});
		await first.close();

		const second = await BotRuntime.open({ databasePath, models: fauxModels([]) });
		expect(await second.listBots()).toMatchObject([{ botId: "scout", name: "Scout", status: "active" }]);
		expect((await second.snapshot("scout")).items).toMatchObject([
			{ kind: "user", parts: [{ type: "text", text: "Capital of France?" }] },
			{ kind: "assistant", parts: [{ type: "text", text: "Paris." }] },
		]);
		await second.close();
	});

	it("deduplicates a resubmitted request after reopen", async () => {
		const first = await BotRuntime.open({ databasePath, models: fauxModels([fauxAssistantMessage("Paris.")]) });
		await first.createBot(bot);
		await first.submitAndWait("scout", "req-1", "Capital of France?");
		await first.close();

		// No scripted answers: a duplicate generation would fail instead of returning the stored answer.
		const second = await BotRuntime.open({ databasePath, models: fauxModels([]) });
		expect(await second.submitAndWait("scout", "req-1", "Capital of France?")).toEqual({
			status: "answered",
			answer: [{ type: "text", text: "Paris." }],
		});
		expect((await second.snapshot("scout")).items).toHaveLength(2);
		await second.close();
	});

	it("keeps one conversation per Bot when creation is retried", async () => {
		const runtime = await BotRuntime.open({
			databasePath,
			models: fauxModels([fauxAssistantMessage("One."), fauxAssistantMessage("Two.")]),
		});
		await runtime.createBot(bot);
		await runtime.createBot({ ...bot, name: "Renamed" });
		await runtime.submitAndWait("scout", "req-1", "First?");
		await runtime.submitAndWait("scout", "req-2", "Second?");
		expect(await runtime.listBots()).toMatchObject([{ botId: "scout", name: "Scout" }]);
		expect((await runtime.snapshot("scout")).items).toHaveLength(4);
		await runtime.close();
	});

	it("applies updated instructions to the next model request", async () => {
		const seen: string[] = [];
		const answer: FauxResponseStep = (context) => {
			const system = context.messages.filter((message) => message.role === "system");
			seen.push(JSON.stringify(system));
			return fauxAssistantMessage("ok");
		};
		const runtime = await BotRuntime.open({ databasePath, models: fauxModels([answer, answer]) });
		await runtime.createBot({ ...bot, instructions: "Speak French." });
		await runtime.submitAndWait("scout", "req-1", "Hello");
		await runtime.updateBot("scout", { instructions: "Speak German." });
		await runtime.submitAndWait("scout", "req-2", "Hello again");
		expect(seen[0]).toContain("Speak French.");
		expect(seen[1]).toContain("Speak German.");
		await runtime.close();
	});

	it("reports an unanswered input when the Bot has no model", async () => {
		const runtime = await BotRuntime.open({ databasePath, models: fauxModels([]) });
		await runtime.createBot({ botId: "idle", name: "Idle", createdAt: 0 });
		expect(await runtime.submitAndWait("idle", "req-1", "Hello")).toEqual({ status: "unanswered", reason: "no_model" });
		await runtime.close();
	});
});
