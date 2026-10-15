import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createModels } from "@earendil-works/pi-ai/models";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildConfiguredProviders, type ConfigEnvironment, resolveConfigValue } from "../src/model-config.ts";

const environment = (variables: Record<string, string> = {}, run = async (_: string) => "sk-command"): ConfigEnvironment => ({
	env: (name) => variables[name],
	run,
});

const options = (env: ConfigEnvironment) => ({ environment: env, catalog: [], reservedIds: new Set(["openai"]) });

describe("resolveConfigValue", () => {
	it("expands variables, honours escapes, and runs commands", async () => {
		const env = environment({ KEY: "abc", OTHER: "xyz" }, async (command) => `ran:${command}`);
		expect(await resolveConfigValue("$KEY", env, "apiKey")).toBe("abc");
		expect(await resolveConfigValue("pre-${KEY}-$OTHER", env, "apiKey")).toBe("pre-abc-xyz");
		expect(await resolveConfigValue("cost $$5 $!x", env, "apiKey")).toBe("cost $5 !x");
		expect(await resolveConfigValue("sk-literal", env, "apiKey")).toBe("sk-literal");
		expect(await resolveConfigValue("!security find-generic-password -w", env, "apiKey")).toBe(
			"ran:security find-generic-password -w",
		);
	});

	it("names the missing variable without echoing any value", async () => {
		await expect(resolveConfigValue("Bearer $NOPE", environment(), 'header "Authorization"')).rejects.toThrow(
			'header "Authorization": environment variable NOPE is not set',
		);
	});
});

describe("buildConfiguredProviders", () => {
	it("rejects built-in IDs and duplicate models without dropping valid providers", () => {
		const { providers, status } = buildConfiguredProviders(
			JSON.stringify({
				providers: {
					openai: { baseUrl: "https://x/v1", api: "openai-completions", models: [{ id: "a" }] },
					dup: { baseUrl: "https://x/v1", api: "openai-completions", models: [{ id: "a" }, { id: "a" }] },
					good: { baseUrl: "https://x/v1", api: "openai-completions", models: [{ id: "a" }] },
				},
			}),
			options(environment()),
		);
		expect(providers.map((provider) => provider.id)).toEqual(["good"]);
		expect(status.errors).toEqual([
			'providers.openai: "openai" is a built-in provider; choose another ID',
			'providers.dup.models: model "a" is listed twice',
		]);
	});

	it("drops the whole file when it is not valid JSON", () => {
		const { providers, status } = buildConfiguredProviders("{ providers: ", options(environment()));
		expect(providers).toEqual([]);
		expect(status.errors[0]).toMatch(/^Not valid JSON: /);
	});

	it("fills omitted fields from a catalog model with the same ID, API-specific fields only for the same API", () => {
		const known = {
			id: "big-1",
			name: "Big One",
			api: "openai-responses" as const,
			provider: "vendor",
			baseUrl: "https://vendor/v1",
			reasoning: true,
			input: ["text" as const, "image" as const],
			cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 400_000,
			maxTokens: 64_000,
			thinkingLevelMap: { minimal: null },
			// Vendor-endpoint features that a gateway relaying the model may reject.
			compat: { supportsMidConvoSystemMessages: true },
		};
		const build = (api: string, extra: object = {}) =>
			buildConfiguredProviders(
				JSON.stringify({ providers: { gw: { baseUrl: "https://gw/v1", api, models: [{ id: "big-1", ...extra }] } } }),
				{ ...options(environment()), catalog: [known] },
			).providers[0]?.getModels()[0];

		expect(build("openai-responses")).toMatchObject({
			name: "Big One",
			provider: "gw",
			baseUrl: "https://gw/v1",
			reasoning: true,
			input: ["text", "image"],
			contextWindow: 400_000,
			thinkingLevelMap: { minimal: null },
		});
		expect(build("openai-responses")?.compat).toBeUndefined();
		expect(build("openai-responses", { compat: { supportsMidConvoSystemMessages: true } })?.compat).toEqual({
			supportsMidConvoSystemMessages: true,
		});
		expect(build("openai-completions")?.thinkingLevelMap).toBeUndefined();
		expect(build("openai-completions", { contextWindow: 100, reasoning: false })).toMatchObject({
			contextWindow: 100,
			reasoning: false,
			maxTokens: 64_000,
		});
	});
});

describe("configured provider requests", () => {
	let server: Server;
	let baseUrl: string;
	let seen: { url: string | undefined; headers: IncomingHttpHeaders; body: unknown }[];

	beforeEach(async () => {
		seen = [];
		server = createServer((request, response) => {
			let body = "";
			request.on("data", (chunk) => (body += chunk));
			request.on("end", () => {
				seen.push({ url: request.url, headers: request.headers, body: JSON.parse(body) });
				response.writeHead(200, { "content-type": "text/event-stream" });
				const chunk = (delta: object, finish: string | null) =>
					`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
				response.end(`${chunk({ role: "assistant", content: "pong" }, null)}${chunk({}, "stop")}data: [DONE]\n\n`);
			});
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
	});

	afterEach(async () => {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	const config = () =>
		JSON.stringify({
			providers: {
				gateway: {
					baseUrl,
					api: "openai-completions",
					apiKey: "$GATEWAY_KEY",
					headers: { "X-Budget-No": "${BUDGET}" },
					models: [{ id: "house-model" }],
				},
			},
		});

	it("sends the configured key and resolved headers to the configured endpoint", async () => {
		const { providers } = buildConfiguredProviders(config(), options(environment({ GATEWAY_KEY: "sk-env", BUDGET: "BUD-1" })));
		const models = createModels();
		for (const provider of providers) models.setProvider(provider);
		const model = models.getModel("gateway", "house-model");
		if (model === undefined) throw new Error("model missing");

		const answer = await models.completeSimple(model, { messages: [{ role: "user", content: "ping", timestamp: 0 }] });
		expect(answer.content).toEqual([{ type: "text", text: "pong" }]);
		expect(seen[0]?.url).toBe("/v1/chat/completions");
		expect(seen[0]?.headers.authorization).toBe("Bearer sk-env");
		expect(seen[0]?.headers["x-budget-no"]).toBe("BUD-1");
		expect(seen[0]?.body).toMatchObject({ model: "house-model" });
	});

	it("prefers a key stored in the credential store over the configured one", async () => {
		const { providers } = buildConfiguredProviders(config(), options(environment({ GATEWAY_KEY: "sk-env", BUDGET: "BUD-1" })));
		const credentials = new InMemoryCredentialStore();
		await credentials.modify("gateway", async () => ({ type: "api_key", key: "sk-stored" }));
		const models = createModels({ credentials });
		for (const provider of providers) models.setProvider(provider);
		const model = models.getModel("gateway", "house-model");
		if (model === undefined) throw new Error("model missing");

		await models.completeSimple(model, { messages: [{ role: "user", content: "ping", timestamp: 0 }] });
		expect(seen[0]?.headers.authorization).toBe("Bearer sk-stored");
	});

	it("is unavailable until the referenced variable exists", async () => {
		const { providers } = buildConfiguredProviders(config(), options(environment({ BUDGET: "BUD-1" })));
		const models = createModels();
		for (const provider of providers) models.setProvider(provider);
		expect(await models.getAvailable("gateway")).toEqual([]);
	});
});
