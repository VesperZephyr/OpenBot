import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { describe, expect, it } from "vitest";
import { BotRuntime } from "../src/index.ts";
import { minimaxModelReplacement } from "../src/minimax-model.ts";

const FLASH = "MiniMax-M3.1-Flash";

describe("retired MiniMax model ids", () => {
	it("replaces only the retired ids and keeps the provider", () => {
		expect(minimaxModelReplacement({ provider: "minimax", modelId: "MiniMax-M2.7" })).toEqual({ provider: "minimax", modelId: FLASH });
		expect(minimaxModelReplacement({ provider: "minimax-cn", modelId: "MiniMax-M2.7-highspeed" })).toEqual({ provider: "minimax-cn", modelId: FLASH });
		expect(minimaxModelReplacement({ provider: "minimax", modelId: FLASH })).toBeUndefined();
		expect(minimaxModelReplacement({ provider: "minimax", modelId: "MiniMax-M3" })).toBeUndefined();
		expect(minimaxModelReplacement({ provider: "openai", modelId: "MiniMax-M2.7" })).toBeUndefined();
		expect(minimaxModelReplacement(undefined)).toBeUndefined();
	});

	it("rewrites a saved selection on startup and still sends", async () => {
		const directory = await mkdtemp(join(tmpdir(), "openbot-minimax-upgrade-"));
		const intl = fauxProvider({ provider: "minimax", models: [{ id: FLASH }] });
		const cn = fauxProvider({ provider: "minimax-cn", models: [{ id: FLASH }] });
		const other = fauxProvider();
		const models = () => {
			const collection = createModels();
			collection.setProvider(intl.provider);
			collection.setProvider(cn.provider);
			collection.setProvider(other.provider);
			return collection;
		};
		const databasePath = join(directory, "db");
		const first = await BotRuntime.open({ databasePath, models: models(), history: false });
		try {
			await first.setLanguage("zh-CN", true);
			await first.setSetupComplete(true);
			await first.setDefaultModel({ provider: "minimax", modelId: "MiniMax-M2.7" });
			await first.createBot({ botId: "follower", name: "Follower", instructions: "Follow the default.", createdAt: 1 });
			await first.createBot({
				botId: "kept",
				name: "Kept",
				instructions: "Stay on M3.",
				model: { provider: "minimax", modelId: "MiniMax-M3" },
				thinkingLevel: "low",
				createdAt: 2,
			});
			await first.createBot({
				botId: "cn",
				name: "CN",
				instructions: "Keep this prompt.",
				model: { provider: "minimax-cn", modelId: "MiniMax-M2.7-highspeed" },
				thinkingLevel: "high",
				createdAt: 3,
			});
			await first.createBot({
				botId: "other",
				name: "Other",
				instructions: "Leave this model.",
				model: { provider: "faux", modelId: "faux-1" },
				createdAt: 4,
			});
			await first.ensureChannel("cn", "room");
		} finally {
			await first.close();
		}

		intl.setResponses([fauxAssistantMessage("from-default")]);
		cn.setResponses([fauxAssistantMessage("from-cn"), fauxAssistantMessage("from-room")]);
		const next = await BotRuntime.open({ databasePath, models: models(), history: false });
		try {
			expect(await next.defaultModel()).toEqual({ provider: "minimax", modelId: FLASH });
			expect(await next.language()).toBe("zh-CN");
			expect(await next.languageChosen()).toBe(true);
			expect(await next.setupComplete()).toBe(true);
			const follower = await next.getBot("follower");
			const kept = await next.getBot("kept");
			const china = await next.getBot("cn");
			const unchanged = await next.getBot("other");
			expect(follower).toMatchObject({ name: "Follower", instructions: "Follow the default." });
			expect(follower?.model).toBeUndefined();
			expect(kept).toMatchObject({
				name: "Kept",
				instructions: "Stay on M3.",
				thinkingLevel: "low",
				model: { provider: "minimax", modelId: "MiniMax-M3" },
			});
			expect(china).toMatchObject({
				name: "CN",
				instructions: "Keep this prompt.",
				thinkingLevel: "high",
				model: { provider: "minimax-cn", modelId: FLASH },
			});
			expect(unchanged?.model).toEqual({ provider: "faux", modelId: "faux-1" });
			next.resume();
			await expect(next.submitAndWait("follower", "default-send", "Hi")).resolves.toMatchObject({
				status: "answered",
				answer: [{ type: "text", text: "from-default" }],
			});
			await expect(next.submitAndWait("cn", "direct-send", "Hi")).resolves.toMatchObject({
				status: "answered",
				answer: [{ type: "text", text: "from-cn" }],
			});
			await expect(next.submitAndWait("cn", "room-send", "Hi", "room")).resolves.toMatchObject({
				status: "answered",
				answer: [{ type: "text", text: "from-room" }],
			});
		} finally {
			await next.close();
			await rm(directory, { recursive: true, force: true });
		}
	});
});
