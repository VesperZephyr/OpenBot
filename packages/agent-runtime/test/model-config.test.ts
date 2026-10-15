import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createProvider, InMemoryCredentialStore, type Model, type Provider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { createModels } from "@earendil-works/pi-ai/models";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildConfiguredProviders, type ConfigEnvironment, resolveConfigValue } from "../src/model-config.ts";

const environment = (variables: Record<string, string> = {}, run = async (_: string) => "sk-command"): ConfigEnvironment => ({
	env: (name) => variables[name],
	run,
});

/** A built-in-like provider whose only key source is the VENDOR_KEY variable. */
function vendor(baseUrl = "https://vendor.example/v1"): Provider {
	const model: Model<"openai-completions"> = {
		id: "big-1",
		name: "Big One",
		api: "openai-completions",
		provider: "vendor",
		baseUrl,
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 400_000,
		maxTokens: 64_000,
		thinkingLevelMap: { minimal: null },
		// Vendor-endpoint behaviour that a gateway relaying the model may reject.
		compat: { supportsStore: true },
	};
	return createProvider({
		id: "vendor",
		name: "Vendor",
		baseUrl,
		auth: {
			apiKey: {
				name: "Vendor key",
				resolve: async ({ ctx, credential }) => {
					const key = credential?.key ?? (await ctx.env("VENDOR_KEY"));
					return key === undefined ? undefined : { auth: { apiKey: key }, source: "vendor" };
				},
			},
		},
		models: [model],
		api: openAICompletionsApi(),
	});
}

const build = (config: object, env = environment(), builtins = new Map([["vendor", vendor()]])) =>
	buildConfiguredProviders(JSON.stringify(config), { environment: env, builtins });

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
	it("reports a broken provider by path without dropping the others", () => {
		const { providers, status } = build({
			providers: {
				noApi: { baseUrl: "https://x/v1", models: [{ id: "m" }] },
				empty: { baseUrl: "https://x/v1", api: "openai-completions" },
				good: { baseUrl: "https://x/v1", api: "openai-completions", models: [{ id: "m" }] },
			},
		});
		expect(providers.map((p) => p.id)).toEqual(["good"]);
		expect(status.errors).toEqual([
			'providers.noApi: model m: set "api" on the model or the provider',
			'providers.empty: list at least one model in "models"',
		]);
	});

	it("rejects unknown properties and the whole file when it does not parse", () => {
		expect(build({ providers: { x: { baseUrl: "u", api: "openai-chat", modelz: [] } } }).status.errors).toEqual([
			"providers.x.modelz: unknown property",
			'providers.x.api: must be one of "openai-completions", "openai-responses", "anthropic-messages"',
		]);
		const broken = buildConfiguredProviders("{ providers: ", { environment: environment(), builtins: new Map() });
		expect(broken.status.errors[0]).toMatch(/^Not valid JSON: /);
	});

	it("serves several APIs from one provider and inherits catalog metadata, but never vendor compat", () => {
		const { providers } = build({
			providers: {
				gw: {
					baseUrl: "https://gw.example/v1",
					api: "openai-responses",
					models: [{ id: "big-1" }, { id: "claude-x", api: "anthropic-messages", baseUrl: "https://gw.example" }],
				},
			},
		});
		const [big, claude] = providers[0]?.getModels() ?? [];
		expect(big).toMatchObject({ provider: "gw", api: "openai-responses", baseUrl: "https://gw.example/v1", reasoning: true });
		expect(big?.compat).toBeUndefined();
		// Thinking levels describe one API's request format; a different API does not inherit them.
		expect(big?.thinkingLevelMap).toBeUndefined();
		expect(claude).toMatchObject({ api: "anthropic-messages", baseUrl: "https://gw.example", reasoning: false });
	});

	it("overlays a built-in provider: endpoint, extra models, and per-model overrides", () => {
		const { providers, status } = build({
			providers: {
				vendor: {
					baseUrl: "https://proxy.example/v1",
					models: [{ id: "house-model", contextWindow: 32_000 }],
					modelOverrides: { "big-1": { name: "Big (proxy)", compat: { supportsStore: false } } },
				},
			},
		});
		expect(status.errors).toEqual([]);
		expect(status.providers).toEqual([
			{ providerId: "vendor", name: "Vendor", overlay: true, keyConfigured: false, keyAvailable: true },
		]);
		const models = providers[0]?.getModels() ?? [];
		expect(models.map((m) => m.id)).toEqual(["big-1", "house-model"]);
		expect(models[0]).toMatchObject({
			name: "Big (proxy)",
			baseUrl: "https://proxy.example/v1",
			thinkingLevelMap: { minimal: null },
			compat: { supportsStore: false },
		});
		expect(models[1]).toMatchObject({ api: "openai-completions", baseUrl: "https://proxy.example/v1", contextWindow: 32_000 });
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

	async function ask(providers: readonly Provider[], providerId: string, modelId: string, credentials = new InMemoryCredentialStore()) {
		const models = createModels({ credentials });
		for (const provider of providers) models.setProvider(provider);
		const model = models.getModel(providerId, modelId);
		if (model === undefined) throw new Error("model missing");
		return models.completeSimple(model, { messages: [{ role: "user", content: "ping", timestamp: 0 }] });
	}

	const gateway = () => ({
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
		const { providers } = build(gateway(), environment({ GATEWAY_KEY: "sk-env", BUDGET: "BUD-1" }));
		const answer = await ask(providers, "gateway", "house-model");
		expect(answer.content).toEqual([{ type: "text", text: "pong" }]);
		expect(seen[0]?.url).toBe("/v1/chat/completions");
		expect(seen[0]?.headers.authorization).toBe("Bearer sk-env");
		expect(seen[0]?.headers["x-budget-no"]).toBe("BUD-1");
		expect(seen[0]?.body).toMatchObject({ model: "house-model" });
	});

	it("prefers a key stored in the credential store over the configured one", async () => {
		const { providers } = build(gateway(), environment({ GATEWAY_KEY: "sk-env", BUDGET: "BUD-1" }));
		const credentials = new InMemoryCredentialStore();
		await credentials.modify("gateway", async () => ({ type: "api_key", key: "sk-stored" }));
		await ask(providers, "gateway", "house-model", credentials);
		expect(seen[0]?.headers.authorization).toBe("Bearer sk-stored");
	});

	it("routes an overlaid built-in to the proxy with the built-in's own key source", async () => {
		const { providers } = build({ providers: { vendor: { baseUrl } } }, environment({ VENDOR_KEY: "sk-vendor" }));
		const credentials = new InMemoryCredentialStore();
		const models = createModels({ credentials, authContext: { env: async (name) => (name === "VENDOR_KEY" ? "sk-vendor" : undefined), fileExists: async () => false } });
		for (const provider of providers) models.setProvider(provider);
		const model = models.getModel("vendor", "big-1");
		if (model === undefined) throw new Error("model missing");
		await models.completeSimple(model, { messages: [{ role: "user", content: "ping", timestamp: 0 }] });
		expect(seen[0]?.url).toBe("/v1/chat/completions");
		expect(seen[0]?.headers.authorization).toBe("Bearer sk-vendor");
	});

	it("is unavailable until the referenced variable exists", async () => {
		const { providers } = build(gateway(), environment({ BUDGET: "BUD-1" }));
		const models = createModels();
		for (const provider of providers) models.setProvider(provider);
		expect(await models.getAvailable("gateway")).toEqual([]);
	});
});
