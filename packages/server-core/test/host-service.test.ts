import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BotRuntime } from "@openbot/agent-runtime";
import { SCRIPTED_MODEL, scriptedModels } from "@openbot/agent-runtime/testing";
import { type ConversationSnapshot, type HostEventType, PROTOCOL_VERSION } from "@openbot/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApprovalBook, HostService, MemorySecretStore, type ModelConfigFile } from "../src/index.ts";

const status = { protocolVersion: PROTOCOL_VERSION, hostVersion: "test", nodeVersion: "test", targetId: "mac", startedAt: 0 };

/** An in-memory configuration file; tests change `text` to simulate editing it. */
type MemoryConfigFile = ModelConfigFile & { text: string | undefined };

function memoryConfigFile(): MemoryConfigFile {
	return {
		path: "/home/test/.openbot/models.json",
		text: undefined,
		async read() {
			return this.text;
		},
		environment: {
			env: (name) => (name === "GATEWAY_KEY" ? "sk-from-env" : undefined),
			run: async () => "sk-from-command",
		},
	};
}

describe("HostService", () => {
	let directory: string;
	let runtime: BotRuntime;
	let service: HostService;
	let events: HostEventType[];
	let secrets: MemorySecretStore;
	let configFile: MemoryConfigFile;
	/** Resolves with the first conversation snapshot that satisfies the predicate. */
	let nextSnapshot: (predicate: (snapshot: ConversationSnapshot) => boolean) => Promise<ConversationSnapshot>;

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "openbot-host-"));
		runtime = await BotRuntime.open({ databasePath: join(directory, "db.sqlite"), models: scriptedModels("Done.").models });
		events = [];
		secrets = new MemorySecretStore();
		configFile = memoryConfigFile();
		const waiters: { predicate: (snapshot: ConversationSnapshot) => boolean; resolve: (s: ConversationSnapshot) => void }[] =
			[];
		nextSnapshot = (predicate) => {
			const { promise, resolve } = Promise.withResolvers<ConversationSnapshot>();
			waiters.push({ predicate, resolve });
			return promise;
		};
		service = new HostService({
			runtime,
			secrets,
			status,
			dataDirectory: directory,
			modelConfig: configFile,
			approvals: new ApprovalBook(() => {}),
			workspace: directory,
			emit: (event) => {
				events.push(event.type);
				if (event.type !== "conversation.updated") return;
				for (const waiter of [...waiters]) {
					if (!waiter.predicate(event.payload)) continue;
					waiters.splice(waiters.indexOf(waiter), 1);
					waiter.resolve(event.payload);
				}
			},
		});
		await service.start();
	});

	afterEach(async () => {
		await service.stop();
		await runtime.close();
		await rm(directory, { recursive: true, force: true });
	});

	it("refuses messages until a model is chosen, then answers and marks the Bot unread", async () => {
		const bot = await service.handle("bots.create", { requestId: "r1", name: "Scout" });
		await expect(service.handle("messages.submit", { botId: bot.botId, requestId: "m1", text: "Hi" })).rejects.toThrow(
			"Choose a model",
		);

		await service.handle("settings.update", { defaultModel: SCRIPTED_MODEL });
		const answered = nextSnapshot((s) => s.live === undefined && s.items.some((item) => item.kind === "assistant"));
		await service.handle("messages.submit", { botId: bot.botId, requestId: "m1", text: "Hi" });
		expect((await answered).items.map((item) => item.kind)).toEqual(["user", "assistant"]);

		const list = await service.handle("bots.list", {});
		expect(list.find((b) => b.botId === bot.botId)?.activity).toBe("unread");
		await service.handle("conversations.markRead", { botId: bot.botId });
		expect((await service.handle("bots.list", {})).find((b) => b.botId === bot.botId)?.activity).toBe("idle");
		expect(events).toContain("bots.changed");
	});

	it("creates one Bot per request ID", async () => {
		const first = await service.handle("bots.create", { requestId: "same", name: "Scout" });
		const second = await service.handle("bots.create", { requestId: "same", name: "Other" });
		expect(second.botId).toBe(first.botId);
		expect(await service.handle("bots.list", {})).toHaveLength(1);
	});

	it("never returns stored API keys in settings", async () => {
		const settings = await service.handle("credentials.set", { providerId: "openai", apiKey: " sk-secret " });
		expect(JSON.stringify(settings)).not.toContain("sk-secret");
		expect(secrets.read("openai")).toBe("sk-secret");
	});

	it("applies edits to the model configuration without a restart and reports problems by path", async () => {
		expect((await service.handle("models.list", {})).some((model) => model.provider === "gateway")).toBe(false);

		configFile.text = `{
			// Comments and trailing commas are allowed, as in Pi's models.json.
			"providers": {
				"gateway": {
					"baseUrl": "https://gateway.example/v1",
					"api": "openai-completions",
					"apiKey": "$GATEWAY_KEY",
					"models": [{ "id": "gpt-5.5" }, { "id": "house-model", "name": "House", "contextWindow": 32000 },],
				},
				"offline": { "baseUrl": "http://localhost:1/v1", "api": "openai-completions", "apiKey": "$MISSING", "models": [{ "id": "m" }] },
				// Overlay of a built-in without its own key: still needs a stored key.
				"faux": { "baseUrl": "http://localhost:2/v1" },
			},
		}`;
		const models = await service.handle("models.list", {});
		expect(models.filter((model) => model.provider === "gateway").map((model) => model.modelId)).toEqual([
			"gpt-5.5",
			"house-model",
		]);
		expect(models.find((model) => model.modelId === "house-model")).toMatchObject({ name: "House", reasoning: false });

		const settings = await service.handle("settings.get", {});
		expect(settings.providers.find((p) => p.providerId === "gateway")).toMatchObject({ source: "config", configured: true });
		expect(settings.providers.find((p) => p.providerId === "offline")).toMatchObject({ source: "config", configured: false });
		expect(settings.providers.find((p) => p.providerId === "faux")).toMatchObject({ source: "config", configured: false });
		expect(settings.modelConfig.errors).toEqual([]);
		expect(JSON.stringify(settings)).not.toContain("sk-from-env");

		configFile.text = `{ "providers": { "gateway": { "api": "openai-chat", "modelz": [] } } }`;
		const broken = await service.handle("settings.get", {});
		expect(broken.providers.some((p) => p.providerId === "gateway")).toBe(false);
		// The overlay is gone, so the built-in is back.
		expect(broken.providers.find((p) => p.providerId === "faux")).toMatchObject({ source: "builtin" });
		expect(broken.modelConfig.errors).toEqual(
			expect.arrayContaining([
				"providers.gateway.modelz: unknown property",
				expect.stringMatching(/^providers\.gateway\.api: must be one of /),
			]),
		);
	});
});
