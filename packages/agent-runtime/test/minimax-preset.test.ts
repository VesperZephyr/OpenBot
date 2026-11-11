import { createModels } from "@earendil-works/pi-ai/models";
import { minimaxCnProvider } from "@earendil-works/pi-ai/providers/minimax-cn";
import { minimaxProvider } from "@earendil-works/pi-ai/providers/minimax";
import type { Context, Model, Provider, TranscriptContext } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { buildConfiguredProviders, type ConfigEnvironment } from "../src/model-config.ts";

const FLAGSHIP = "MiniMax-M3.1-Flash";
const TEXT_MODELS = [FLAGSHIP, "MiniMax-M3"] as const;
const INTERNATIONAL = "https://api.minimax.io/anthropic";
const CHINA = "https://api.minimax.cn/anthropic";
const KEY = "sk-test-minimax";

const environment: ConfigEnvironment = { env: () => undefined, run: async () => "" };
const context: Context = { messages: [{ role: "user", content: "Hi", timestamp: 1 }] };

function chatModel(provider: Provider, id: string): Model<"anthropic-messages"> {
	const model = provider.getModels().find((entry) => entry.id === id);
	if (model === undefined || model.api !== "anthropic-messages") throw new Error(`missing ${provider.id}/${id}`);
	return model as Model<"anthropic-messages">;
}

function events(modelId: string): string {
	const frames = [
		{ type: "message_start", message: { id: "msg_test", model: modelId, usage: { input_tokens: 1, output_tokens: 0 } } },
		{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
		{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
		{ type: "content_block_stop", index: 0 },
		{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
		{ type: "message_stop" },
	];
	return frames.map((frame) => `event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`).join("");
}

async function capture(provider: Provider, model: Model<"anthropic-messages">, reasoning?: "max") {
	const models = createModels();
	models.setProvider(provider);
	let url = "";
	let body: Record<string, unknown> | undefined;
	const headers = new Headers();
	const stream = models.streamSimple(model, context, {
		apiKey: KEY,
		maxRetries: 0,
		...(reasoning === undefined ? {} : { reasoning }),
		fetch: async (input, init) => {
			url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
			const rawHeaders = init?.headers ?? (input instanceof Request ? input.headers : undefined);
			if (rawHeaders !== undefined) new Headers(rawHeaders).forEach((value, name) => headers.set(name, value));
			const raw = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
			body = typeof raw === "string" ? JSON.parse(raw) as Record<string, unknown> : undefined;
			return new Response(events(model.id), { headers: { "content-type": "text/event-stream" } });
		},
	});
	const reply = await stream.result();
	return { url, body, headers, reply };
}

describe("MiniMax preset", () => {
	it("lists the current text models on the international and China Anthropic endpoints", () => {
		for (const [provider, baseUrl] of [
			[minimaxProvider(), INTERNATIONAL],
			[minimaxCnProvider(), CHINA],
		] as const) {
			expect(provider.baseUrl).toBe(baseUrl);
			expect(provider.getModels().map((model) => model.id).sort()).toEqual([...TEXT_MODELS].sort());
			for (const id of TEXT_MODELS) {
				const model = chatModel(provider, id);
				expect(model.baseUrl).toBe(baseUrl);
				expect(model.api).toBe("anthropic-messages");
				expect(model.contextWindow).toBe(1_000_000);
				expect(JSON.stringify(model)).not.toContain(KEY);
				expect(JSON.stringify(model)).not.toMatch(/apiKey|sk-/);
			}
			const flagship = chatModel(provider, FLAGSHIP);
			expect(flagship.compat?.forceAdaptiveThinking).toBe(true);
			expect(flagship.thinkingLevelMap?.off).toBeNull();
			expect(flagship.maxTokens).toBe(524288);
			expect(flagship.cost).toMatchObject({ input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0 });
		}
	});

	it("sends an Anthropic Messages request and keeps the key out of the URL and body", async () => {
		const provider = minimaxProvider();
		const model = chatModel(provider, FLAGSHIP);
		const sent = await capture(provider, model, "max");
		expect(sent.url).toBe(`${INTERNATIONAL}/v1/messages?beta=true`);
		expect(sent.url).not.toContain(KEY);
		expect(sent.headers.get("x-api-key")).toBe(KEY);
		expect(sent.body).toMatchObject({
			model: FLAGSHIP,
			stream: true,
			max_tokens: model.maxTokens,
			thinking: { type: "adaptive" },
			output_config: { effort: "max" },
		});
		expect(JSON.stringify(sent.body?.messages)).toContain("Hi");
		expect(JSON.stringify(sent.body)).not.toContain(KEY);
		expect(sent.reply.stopReason).toBe("stop");
		expect(sent.reply.content).toEqual([{ type: "text", text: "Hello" }]);
	});

	it("does not send disabled thinking when the caller leaves reasoning off", async () => {
		const sent = await capture(minimaxProvider(), chatModel(minimaxProvider(), FLAGSHIP));
		expect(sent.body?.thinking).toBeUndefined();
		expect(JSON.stringify(sent.body)).not.toContain("disabled");
	});

	it("uses a models.json base URL override for the same provider", async () => {
		const built = buildConfiguredProviders(
			JSON.stringify({ providers: { minimax: { baseUrl: CHINA } } }),
			{ environment, builtins: new Map([["minimax", minimaxProvider()]]) },
		);
		const provider = built.providers[0];
		expect(provider).toBeDefined();
		const model = chatModel(provider!, FLAGSHIP);
		expect(model.baseUrl).toBe(CHINA);
		const sent = await capture(provider!, model);
		expect(sent.url).toBe(`${CHINA}/v1/messages?beta=true`);
	});

	it("refuses a request when no API key is available", async () => {
		const provider = minimaxProvider();
		const model = chatModel(provider, FLAGSHIP);
		let called = false;
		const refused = await provider.streamSimple(model, { messages: context.messages } as TranscriptContext, {
			fetch: async () => {
				called = true;
				return new Response(null, { status: 500 });
			},
		}).result();
		expect(refused.stopReason).toBe("error");
		expect(refused.errorMessage).toContain("No API key for provider: minimax");
		expect(called).toBe(false);

		const models = createModels();
		models.setProvider(provider);
		const listed = models.getModel("minimax", FLAGSHIP);
		expect(listed?.id).toBe(FLAGSHIP);
		const missing = await models.streamSimple(listed!, context).result();
		expect(missing.stopReason).toBe("error");
		expect(missing.errorMessage).toBe("Provider is not configured: minimax");
		expect(missing.content).toEqual([]);
	});
});
