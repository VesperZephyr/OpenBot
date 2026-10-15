import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context as ModelContext } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import {
	type FauxResponseStep,
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
	fauxThinking,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { MEMORY_LIMIT_BYTES, TOOL_CATALOG, type ToolDefinition } from "@openbot/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BotRuntime, type ToolInvoker } from "../src/index.ts";
import { applyMemoryEdit } from "../src/memory.ts";

const memoryTool = TOOL_CATALOG.find((tool) => tool.name === "memory_update") as ToolDefinition;
const bot = { botId: "scout", name: "Scout", role: "Research", createdAt: 0 };

/** Faux models that record every request the runtime sends. */
function recordingModels(steps: FauxResponseStep[], options: { contextWindow?: number } = {}) {
	const requests: ModelContext[] = [];
	const faux = fauxProvider({
		models: [{ id: "faux-1", ...(options.contextWindow === undefined ? {} : { contextWindow: options.contextWindow, maxTokens: 1000 }) }],
	});
	faux.setResponses(
		steps.map((step) => (context: ModelContext, ...rest: unknown[]) => {
			requests.push(structuredClone(context));
			return typeof step === "function" ? (step as (...args: unknown[]) => never)(context, ...rest) : step;
		}),
	);
	const models = createModels();
	models.setProvider(faux.provider);
	return { models, requests };
}

/** The system prompt as the model would see it: every system message's sections, later ones overriding earlier. */
function systemText(request: ModelContext | undefined): string {
	const sections: Record<string, string> = {};
	for (const message of request?.messages ?? []) {
		if (message.role !== "system") continue;
		for (const [key, value] of Object.entries(message.sections ?? {})) {
			if (value === null) delete sections[key];
			else sections[key] = value;
		}
	}
	return Object.values(sections).join("\n");
}

function userTexts(request: ModelContext | undefined): string[] {
	return (request?.messages ?? []).flatMap((message) =>
		message.role === "user" ? [typeof message.content === "string" ? message.content : JSON.stringify(message.content)] : [],
	);
}

describe("Bot quality", () => {
	let directory: string;
	let databasePath: string;
	let runtime: BotRuntime | undefined;

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "openbot-quality-"));
		databasePath = join(directory, "openbot.sqlite");
	});

	afterEach(async () => {
		await runtime?.close();
		runtime = undefined;
		await rm(directory, { recursive: true, force: true });
	});

	/** A runtime whose only tool is memory_update, routed straight to the runtime as the Host does. */
	async function open(steps: FauxResponseStep[], options: { contextWindow?: number } = {}) {
		const { models, requests } = recordingModels(steps, options);
		const invoke: ToolInvoker = async (call) => {
			const args = call.args as { action: "replace" | "append"; section: string; content: string };
			await runtime!.editMemory(call.botId, args);
			return { status: "succeeded", output: "Memory updated." };
		};
		runtime = await BotRuntime.open({ databasePath, models, tools: { invoke, definitions: [memoryTool] } });
		return requests;
	}

	it("memory_update persists across reopen and reaches the next system prompt", async () => {
		const requests = await open([
			fauxAssistantMessage(fauxToolCall("memory_update", { action: "append", section: "Preferences", content: "- Answer in Chinese." }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("好的。"),
		]);
		await runtime!.createBot({ ...bot, model: { provider: "faux", modelId: "faux-1" } });
		await runtime!.submitAndWait("scout", "req-1", "Always answer in Chinese.");
		expect(systemText(requests[0])).toContain("(Your memory is empty.)");
		expect(systemText(requests[1])).toContain("- Answer in Chinese.");
		await runtime!.close();

		const reopened = await open([fauxAssistantMessage("你好。")]);
		expect(await runtime!.memory("scout")).toBe("## Preferences\n- Answer in Chinese.");
		await runtime!.submitAndWait("scout", "req-2", "Hello");
		const system = systemText(reopened[0]);
		expect(system).toContain("## Preferences\n- Answer in Chinese.");
		expect(system).toContain("You are Scout, the user's Research Bot");
		expect(system).toMatch(/Today is \d{4}-\d{2}-\d{2}\./);
	});

	it("rejects memory above 8 KB and keeps the old content", async () => {
		await open([]);
		await runtime!.createBot(bot);
		await runtime!.setMemory("scout", "## Notes\n- keep me");
		await expect(runtime!.setMemory("scout", "x".repeat(MEMORY_LIMIT_BYTES + 1))).rejects.toThrow(/limited to 8 KB/);
		await expect(
			runtime!.editMemory("scout", { action: "append", section: "Notes", content: "y".repeat(MEMORY_LIMIT_BYTES) }),
		).rejects.toThrow(/limited to 8 KB/);
		expect(await runtime!.memory("scout")).toBe("## Notes\n- keep me");
		// Exactly at the limit is allowed; the limit counts UTF-8 bytes, not characters.
		await runtime!.setMemory("scout", "x".repeat(MEMORY_LIMIT_BYTES));
		await expect(runtime!.setMemory("scout", "é".repeat(MEMORY_LIMIT_BYTES / 2 + 1))).rejects.toThrow(/limited/);
	});

	it("edits memory sections", () => {
		const start = "Intro line\n\n## Preferences\n- short answers";
		const appended = applyMemoryEdit(start, { action: "append", section: "Preferences", content: "- Chinese" });
		expect(appended).toBe("Intro line\n\n## Preferences\n- short answers\n- Chinese");
		// A replayed append changes nothing.
		expect(applyMemoryEdit(appended, { action: "append", section: "preferences", content: "- Chinese" })).toBe(appended);
		const added = applyMemoryEdit(appended, { action: "replace", section: "## Role notes", content: "Owns research." });
		expect(added).toBe("Intro line\n\n## Preferences\n- short answers\n- Chinese\n\n## Role notes\nOwns research.");
		expect(applyMemoryEdit(added, { action: "replace", section: "Preferences", content: "" })).toBe(
			"Intro line\n\n## Role notes\nOwns research.",
		);
	});

	it("reset starts a new context that keeps memory", async () => {
		const requests = await open([fauxAssistantMessage("First answer."), fauxAssistantMessage("Fresh answer.")]);
		await runtime!.createBot({ ...bot, model: { provider: "faux", modelId: "faux-1" } });
		await runtime!.setMemory("scout", "## Preferences\n- Be brief.");
		await runtime!.submitAndWait("scout", "req-1", "Old topic question");
		await runtime!.reset("scout");
		await runtime!.submitAndWait("scout", "req-2", "New topic question");

		expect(userTexts(requests[1])).toEqual(["New topic question"]);
		expect(systemText(requests[1])).toContain("- Be brief.");
		expect((await runtime!.snapshot("scout")).items).toMatchObject([
			{ kind: "user", parts: [{ text: "Old topic question" }] },
			{ kind: "assistant", parts: [{ text: "First answer." }] },
			{ kind: "divider", reason: "reset" },
			{ kind: "user", parts: [{ text: "New topic question" }] },
			{ kind: "assistant", parts: [{ text: "Fresh answer." }] },
		]);
	});

	it("projects a compaction divider and keeps earlier messages", async () => {
		// Pi's default compaction settings on a 40000-token window: requests block to compact above 40000 - 16384 tokens,
		// and once more than keepRecentTokens (20000) sit behind the newest turns there is something to summarize. Each
		// answer is about 5000 tokens, so a compaction happens within eight turns.
		const long = "word ".repeat(4000);
		const respond: FauxResponseStep = (context) => {
			const first = context.messages[0];
			if (first?.role === "system" && typeof first.content === "string" && first.content.includes("summar")) {
				return fauxAssistantMessage("## Goal\nSummary of the earlier chat.");
			}
			return fauxAssistantMessage(`Answer. ${long}`);
		};
		await open(Array.from({ length: 12 }, () => respond), { contextWindow: 40_000 });
		await runtime!.createBot({ ...bot, model: { provider: "faux", modelId: "faux-1" } });
		for (let turn = 1; turn <= 8; turn++) await runtime!.submitAndWait("scout", `req-${turn}`, `Question ${turn}`);

		const items = (await runtime!.snapshot("scout")).items;
		const divider = items.findIndex((item) => item.kind === "divider");
		expect(items[divider]).toMatchObject({ kind: "divider", reason: "compaction" });
		const users = items.flatMap((item) => (item.kind === "user" ? [item.parts[0]?.text] : []));
		expect(users).toEqual(Array.from({ length: 8 }, (_, index) => `Question ${index + 1}`));
		expect(items.some((item) => item.kind === "other")).toBe(false);
	});

	it("projects thinking", async () => {
		await open([fauxAssistantMessage([fauxThinking("The user wants a city."), fauxText("Paris.")])]);
		await runtime!.createBot({ ...bot, model: { provider: "faux", modelId: "faux-1" } });
		await runtime!.updateBot("scout", { thinkingLevel: "high" });
		await runtime!.submitAndWait("scout", "req-1", "Capital of France?");
		expect((await runtime!.getBot("scout"))?.thinkingLevel).toBe("high");
		expect((await runtime!.snapshot("scout")).items[1]).toMatchObject({
			kind: "assistant",
			thinking: "The user wants a city.",
			parts: [{ text: "Paris." }],
		});
	});
});
