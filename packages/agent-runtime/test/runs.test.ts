import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModels } from "@earendil-works/pi-ai/models";
import {
	type FauxResponseStep,
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BotRuntime, type StoredRun, type ToolInvoker } from "../src/index.ts";

function fauxModels(answers: FauxResponseStep[]) {
	const faux = fauxProvider();
	faux.setResponses(answers);
	const models = createModels();
	models.setProvider(faux.provider);
	return models;
}

const model = { provider: "faux", modelId: "faux-1" };
const bot = { botId: "scout", name: "Scout", model, createdAt: 0 };
const waitTool = {
	name: "wait_for_user",
	description: "Waits until the test releases it.",
	parameters: { type: "object", properties: {}, additionalProperties: false },
	capability: "commands",
	destination: "host",
} as const;

const run = (runId: string, state: StoredRun["state"], createdAt: number): StoredRun => ({
	runId,
	botId: "scout",
	state,
	requestIds: [`req-${runId}`],
	createdAt,
	messages: [{ requestId: `req-${runId}`, text: "Hello" }],
	inputs: [],
});

describe("Runs in the runtime", () => {
	let directory: string;
	let databasePath: string;

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "openbot-runs-"));
		databasePath = join(directory, "openbot.sqlite");
	});

	afterEach(async () => {
		await rm(directory, { recursive: true, force: true });
	});

	it("keeps Runs across reopen and prunes old terminal Runs per Bot", async () => {
		const first = await BotRuntime.open({ databasePath, models: fauxModels([]) });
		const store = first.runsStore();
		await store.put({ ...run("active", "running", 0), inputs: [{ requestId: "req-active", text: "Hello", submissionId: "7" }] });
		for (let index = 1; index <= 52; index++) await store.put(run(`done-${index}`, "completed", index));
		await first.close();

		const second = await BotRuntime.open({ databasePath, models: fauxModels([]) });
		const runs = await second.runsStore().list();
		expect(runs[0]).toMatchObject({ runId: "active", state: "running", inputs: [{ submissionId: "7" }] });
		// 50 terminal Runs are kept, the two oldest are gone; the running one is never pruned.
		expect(runs).toHaveLength(51);
		expect(runs.some((candidate) => candidate.runId === "done-1" || candidate.runId === "done-2")).toBe(false);
		await second.close();
	});

	it("lands a steer sent while a tool waits in the same run", async () => {
		const release = Promise.withResolvers<void>();
		const started = Promise.withResolvers<void>();
		const invoke: ToolInvoker = async () => {
			started.resolve();
			await release.promise;
			return { status: "succeeded", output: "released" };
		};
		const seen: string[] = [];
		const runtime = await BotRuntime.open({
			databasePath,
			models: fauxModels([
				fauxAssistantMessage(fauxToolCall("wait_for_user", {}), { stopReason: "toolUse" }),
				(context) => {
					seen.push(JSON.stringify(context.messages));
					return fauxAssistantMessage("Switched.");
				},
			]),
			tools: { invoke, definitions: [waitTool] },
		});
		await runtime.createBot(bot);
		runtime.resume();
		const first = await runtime.submit("scout", "req-1", "Read a.txt", "start");
		await started.promise;
		const steer = await runtime.submit("scout", "req-2", "Use a different file", "steer");
		expect(await runtime.submissionState("scout", steer.submissionId)).toBe("queued");
		expect((await runtime.snapshot("scout")).pending).toMatchObject([{ parts: [{ text: "Use a different file" }] }]);

		release.resolve();
		expect(await runtime.waitSubmission("scout", first.submissionId)).toEqual({ status: "done" });
		expect(await runtime.waitSubmission("scout", steer.submissionId)).toEqual({ status: "done" });
		// One model request after the tool round, and it already carries the steer.
		expect(seen).toHaveLength(1);
		expect(seen[0]).toContain("Use a different file");
		const items = (await runtime.snapshot("scout")).items;
		expect(items.filter((item) => item.kind === "assistant").map((item) => item.kind === "assistant" && item.parts)).toEqual([
			[{ type: "text", text: "Switched." }],
		]);
		await runtime.close();
	});

	it("reacquires a settled submission after reopen", async () => {
		const first = await BotRuntime.open({ databasePath, models: fauxModels([fauxAssistantMessage("Paris.")]) });
		await first.createBot(bot);
		first.resume();
		const { submissionId } = await first.submit("scout", "req-1", "Capital of France?", "start");
		await first.waitSubmission("scout", submissionId);
		await first.close();

		const second = await BotRuntime.open({ databasePath, models: fauxModels([]) });
		expect(await second.submissionState("scout", submissionId)).toBe("done");
		expect(await second.waitSubmission("scout", submissionId)).toEqual({ status: "done" });
		expect(await second.submissionState("scout", "9999")).toBe("absent");
		await second.close();
	});

	it("marks a tool the user stopped as cancelled and notes the stop", async () => {
		const started = Promise.withResolvers<void>();
		const invoke: ToolInvoker = ({ signal }) => {
			started.resolve();
			const { promise, reject } = Promise.withResolvers<never>();
			signal.addEventListener("abort", () => reject(signal.reason), { once: true });
			return promise;
		};
		const runtime = await BotRuntime.open({
			databasePath,
			models: fauxModels([fauxAssistantMessage(fauxToolCall("wait_for_user", {}), { stopReason: "toolUse" })]),
			tools: { invoke, definitions: [waitTool] },
		});
		await runtime.createBot(bot);
		runtime.resume();
		const { submissionId } = await runtime.submit("scout", "req-1", "Wait", "start");
		await started.promise;
		await runtime.cancel("scout");
		await runtime.markStopped("scout");
		expect(await runtime.waitSubmission("scout", submissionId)).toEqual({ status: "unanswered", reason: "aborted" });
		const items = (await runtime.snapshot("scout")).items;
		expect(items.find((item) => item.kind === "tool")).toMatchObject({ status: "cancelled" });
		expect(items.at(-1)).toMatchObject({ kind: "stopped" });
		await runtime.close();
	});
});
