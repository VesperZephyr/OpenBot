import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BotRuntime } from "@openbot/agent-runtime";
import { SCRIPTED_MODEL, scriptedModels } from "@openbot/agent-runtime/testing";
import { type ConversationSnapshot, type HostEventType, PROTOCOL_VERSION } from "@openbot/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
		async write(text) {
			this.text = text;
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
 let responses: ReturnType<typeof scriptedModels>;
	let service: HostService;
	let events: HostEventType[];
	/** Bot of every `conversation.updated` event, in order. */
	let updated: string[];
	let secrets: MemorySecretStore;
	let configFile: MemoryConfigFile;
	/** Bots whose background commands the service asked the Host to stop. */
	let stoppedBots: string[];
	let audit: unknown[];
	/** Resolves with the first conversation snapshot that satisfies the predicate. */
	let nextSnapshot: (predicate: (snapshot: ConversationSnapshot) => boolean) => Promise<ConversationSnapshot>;

 async function answeredWindow(botId:string){
  let result:Awaited<ReturnType<typeof runtime.historyWindow>>={status:"building"};
  await expect.poll(async()=>{result=await service.handle("conversations.window",{conversationKey:`bot:${botId}`,position:{kind:"latest"}});return result.status==="ready"&&result.window.rows.some(row=>row.content.kind==="direct"&&row.content.item.kind==="assistant");}).toBe(true);
  const ready=await runtime.historyWindow({conversationKey:`bot:${botId}`,position:{kind:"latest"}});if(ready.status!=="ready")throw Error("History is not ready");return ready.window;
 }

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "openbot-host-"));
		responses = scriptedModels("Done.");
  runtime = await BotRuntime.open({ databasePath: join(directory, "db.sqlite"), models: responses.models });
		events = [];
		audit = [];
		stoppedBots = [];
		updated = [];
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
			audit: (event) => audit.push(event),
			secrets,
			status,
			dataDirectory: directory,
			modelConfig: configFile,
			approvals: new ApprovalBook(() => {}),
			workspace: directory,
			conversationStopped: (botId) => stoppedBots.push(botId),
			emit: (event) => {
				events.push(event.type);
				if (event.type !== "conversation.updated") return;
				expect(event.payload.items).toEqual([]);
 updated.push(event.payload.botId);
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

	it("requires owner profile revisions and rejects unavailable role skills without changing the Bot", async () => {
		const bot = await service.handle("bots.create", { requestId: "roles", name: "Analyst" });
		const ref = { name: "report", revision: 1, sha256: "a".repeat(64) };
		await expect(service.handle("bots.update", { botId: bot.botId, defaultSkills: [ref] })).rejects.toThrow("Reload the profile");
		await expect(service.handle("bots.update", { botId: bot.botId, expectedRevision: 1, defaultSkills: [ref] })).rejects.toThrow("unavailable");
		expect((await runtime.getBot(bot.botId))?.revision).toBe(1);
		await expect(runtime.updateBot(bot.botId, { defaultSkills: [ref, ref] })).rejects.toThrow("distinct skills");
		await runtime.updateBot(bot.botId, { defaultSkills: [ref], expectedRevision: 1 });
		const copy = await service.handle("bots.duplicate", { botId: bot.botId, requestId: "role-copy" });
		expect(copy.defaultSkills).toEqual([ref]);
		expect(await runtime.memory(copy.botId)).toBe("");
		await expect(service.handle("bots.update", { botId: bot.botId, expectedRevision: 1, defaultSkills: [] })).rejects.toThrow("Profile changed");
		expect((await runtime.getBot(bot.botId))?.defaultSkills).toEqual([ref]);
	});

	it("refuses messages until a model is chosen, then answers and marks the Bot unread", async () => {
		const bot = await service.handle("bots.create", { requestId: "r1", name: "Scout" });
		await expect(service.handle("messages.submit", { botId: bot.botId, requestId: "m1", text: "Hi" })).rejects.toThrow(
			"Choose a model",
		);

		await service.handle("settings.update", { defaultModel: SCRIPTED_MODEL });
		await service.handle("conversations.subscribe", { botId: bot.botId });
		const answered = answeredWindow(bot.botId);
		await service.handle("messages.submit", { botId: bot.botId, requestId: "m1", text: "Hi" });
		expect((await answered).rows.map((row) => row.content.kind==="direct"?row.content.item.kind:row.content.kind)).toEqual(["user", "assistant"]);

		const list = await service.handle("bots.list", {});
		expect(list.find((b) => b.botId === bot.botId)?.activity).toBe("unread");
		await service.handle("conversations.markRead", { conversationKey: `bot:${bot.botId}`, through: 1 });
		expect((await service.handle("bots.list", {})).find((b) => b.botId === bot.botId)?.activity).toBe("idle");
		expect(events).toContain("bots.changed");
	});

	it("lists bounded summaries without loading histories and rejects read receipts for deleted Bots", async () => {
		const bot = await service.handle("bots.create", { requestId: "index", name: "Reader" });
		const snap = vi.spyOn(runtime, "snapshot");
		const originalGroups = runtime.groups();
		const posts = vi.fn(originalGroups.posts);
		const groups = vi.spyOn(runtime, "groups").mockReturnValue({ ...originalGroups, posts });
		const rows = await service.handle("conversations.list", {});
		expect(rows.find((r) => r.conversationKey === `bot:${bot.botId}`)?.unreadCount).toBe(0);
		expect(snap).not.toHaveBeenCalled();
		expect(posts).not.toHaveBeenCalled();
		snap.mockRestore();
		groups.mockRestore();
		await service.handle("bots.delete", { botId: bot.botId });
		expect((await service.handle("conversations.list", {})).some((r) => r.conversationKey === `bot:${bot.botId}`)).toBe(false);
		await expect(service.handle("conversations.markRead", { conversationKey: `bot:${bot.botId}`, through: 0 })).rejects.toThrow("Unknown Bot");
	});

	it("searches current eligible identities and unread conversations without history reads or content audit", async () => {
		await service.handle("settings.update", { defaultModel: SCRIPTED_MODEL });
		const bot = await service.handle("bots.create", { requestId: "search", name: "Reader" });
		await service.handle("conversations.subscribe", { botId: bot.botId });
		const answered = answeredWindow(bot.botId);
		await service.handle("messages.submit", { botId: bot.botId, requestId: "q", text: "SEARCH_PRIVATE_SENTINEL" });
		await answered;
		const snap = vi.spyOn(runtime, "snapshot");
		const store = runtime.groups(), posts = vi.fn(store.posts), history = vi.fn(store.history);
		const groups = vi.spyOn(runtime, "groups").mockReturnValue({ ...store, posts, history });
		const before = await service.handle("conversations.list", {});
		const calls = audit.length;
		expect((await service.handle("conversations.search", { query: "search_private_sentinel", unreadOnly: true })).items).toHaveLength(1);
		expect(await service.handle("conversations.list", {})).toEqual(before);
		expect(snap).not.toHaveBeenCalled(); expect(posts).not.toHaveBeenCalled(); expect(history).not.toHaveBeenCalled();
		expect(audit).toHaveLength(calls);
		expect(JSON.stringify(audit)).not.toContain("SEARCH_PRIVATE_SENTINEL");
		snap.mockRestore(); groups.mockRestore();
		await service.handle("conversations.markRead", { conversationKey: `bot:${bot.botId}`, through: 1 });
		expect((await service.handle("conversations.search", { query: "sentinel", unreadOnly: true })).items).toHaveLength(0);
		await service.handle("bots.update", { botId: bot.botId, status: "hidden" });
		expect((await service.handle("conversations.search", { query: "sentinel" })).items).toHaveLength(0);
		expect((await service.handle("conversations.search", { query: "sentinel", includeHidden: true })).items).toHaveLength(1);
		await service.handle("bots.delete", { botId: bot.botId });
		expect((await service.handle("conversations.search", { query: "sentinel", includeHidden: true })).items).toHaveLength(0);
	});

	it("creates one Bot per request ID", async () => {
		const first = await service.handle("bots.create", { requestId: "same", name: "Scout" });
		const second = await service.handle("bots.create", { requestId: "same", name: "Other" });
		expect(second.botId).toBe(first.botId);
		expect(await service.handle("bots.list", {})).toHaveLength(2);
	});

	it("never returns stored API keys in settings", async () => {
		const settings = await service.handle("credentials.set", { providerId: "openai", apiKey: " sk-secret " });
		expect(JSON.stringify(settings)).not.toContain("sk-secret");
		expect(await secrets.getApiKey("openai")).toBe("sk-secret");
	});

	it("reports the search key as web search, never as a model provider", async () => {
		expect((await service.handle("settings.get", {})).webSearch).toEqual({ provider: "tavily", configured: false });
		const settings = await service.handle("credentials.set", { providerId: "search:tavily", apiKey: "tvly-secret" });
		expect(settings.webSearch).toEqual({ provider: "tavily", configured: true });
		expect(settings.providers.some((provider) => provider.providerId.startsWith("search:"))).toBe(false);
		expect(JSON.stringify(settings)).not.toContain("tvly-secret");
		expect((await service.handle("credentials.delete", { providerId: "search:tavily" })).webSearch.configured).toBe(false);
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

	it("sends conversation updates only for the subscribed Bot", async () => {
  responses.answer("Done.");
		await service.handle("settings.update", { defaultModel: SCRIPTED_MODEL });
		const watched = await service.handle("bots.create", { requestId: "w", name: "Watched" });
		const other = await service.handle("bots.create", { requestId: "o", name: "Other" });
		await service.handle("conversations.subscribe", { botId: watched.botId });
		updated.length = 0;

		const answered = answeredWindow(watched.botId);
		await service.handle("messages.submit", { botId: other.botId, requestId: "m-other", text: "Hi" });
		await service.handle("messages.submit", { botId: watched.botId, requestId: "m-watched", text: "Hi" });
		await answered;
		expect(updated.length).toBeGreaterThan(0);
		expect(updated.every((botId) => botId === watched.botId)).toBe(true);
		// The other Bot still reaches the sidebar.
		expect(events).toContain("bots.changed");
		await expect(service.handle("conversations.subscribe", { botId: "bot_missing" })).rejects.toThrow("Unknown Bot");
	});

 it("keeps Prompt and memory content out of diagnostics while recording edit and restore outcomes", async () => {
  const bot = await service.handle("bots.create", {requestId: "privacy", name: "Privacy", instructions: "PRIVATE_PROMPT_SENTINEL"});
  await service.handle("bots.memory.update", {botId: bot.botId, content: "PRIVATE_MEMORY_SENTINEL", expectedRevision: 0});
  await service.handle("bots.memory.restore", {botId: bot.botId, revision: 0, expectedRevision: 1});
  await expect(service.handle("bots.memory.update", {botId: bot.botId, content: "PRIVATE_DRAFT_SENTINEL", expectedRevision: 0})).rejects.toThrow("Memory changed");
  expect(JSON.stringify(audit)).not.toContain("SENTINEL");
  expect(audit).toEqual(expect.arrayContaining([
   expect.objectContaining({operation: "bots.memory.update", outcome: "succeeded"}),
   expect.objectContaining({operation: "bots.memory.restore", outcome: "succeeded"}),
   expect.objectContaining({operation: "bots.memory.update", outcome: "failed"}),
  ]));
 });

	it("duplicates profile with empty memory and history, once per request ID", async () => {
		await service.handle("settings.update", { defaultModel: SCRIPTED_MODEL });
		const source = await service.handle("bots.create", { requestId: "s", name: "Ada", role: "Research", instructions: "Cite sources." });
		await service.handle("bots.update", { botId: source.botId, thinkingLevel: "high" });
		await service.handle("bots.memory.update", { expectedRevision: 0, botId: source.botId, content: "## Preferences\n- Short answers\n" });
		await service.handle("conversations.subscribe", { botId: source.botId });
		const answered = answeredWindow(source.botId);
		await service.handle("messages.submit", { botId: source.botId, requestId: "m1", text: "Hi" });
		await answered;

		const copy = await service.handle("bots.duplicate", { botId: source.botId, requestId: "d1" });
		expect(copy).toMatchObject({ name: "Ada (copy)", role: "Research", instructions: "Cite sources.", thinkingLevel: "high" });
		expect(copy.botId).not.toBe(source.botId);
		expect((await service.handle("bots.memory.get", { botId: copy.botId })).content).toBe("");
		expect((await service.handle("conversations.snapshot", { botId: copy.botId })).items).toEqual([]);
		expect((await service.handle("bots.duplicate", { botId: source.botId, requestId: "d1" })).botId).toBe(copy.botId);
		expect(await service.handle("bots.list", {})).toHaveLength(3);
	});

	it("deletes a Bot: hidden everywhere, its conversation kept", async () => {
		const bot = await service.handle("bots.create", { requestId: "x", name: "Gone" });
		await service.handle("bots.memory.update", { expectedRevision: 0, botId: bot.botId, content: "kept" });
		await service.handle("bots.delete", { botId: bot.botId });
		// No Run was active, but background commands it started earlier must still stop.
		expect(stoppedBots).toEqual([bot.botId]);
		expect((await service.handle("bots.list", {})).filter((b) => b.kind !== "core")).toEqual([]);
		await expect(service.handle("messages.submit", { botId: bot.botId, requestId: "m", text: "Hi" })).rejects.toThrow("Unknown Bot");
		await expect(service.handle("bots.update", { botId: bot.botId, status: "active" })).rejects.toThrow("Unknown Bot");
		await expect(service.handle("bots.duplicate", { botId: bot.botId, requestId: "d" })).rejects.toThrow("Unknown Bot");
		// Stored, not removed (architecture 8.3 keeps the conversation on disk).
		expect((await runtime.getBot(bot.botId))?.status).toBe("deleted");
		expect(await runtime.memory(bot.botId)).toBe("kept");
		// Idempotent.
		await service.handle("bots.delete", { botId: bot.botId });
	});

	it("adds a custom provider to the model configuration without touching other entries or writing keys", async () => {
		configFile.text = JSON.stringify({ $schema: "x", providers: { gateway: { baseUrl: "https://g/v1", api: "openai-completions", apiKey: "$GATEWAY_KEY", models: [{ id: "g1" }] } } });
		const settings = await service.handle("models.addProvider", {
			id: "local-llm",
			name: "Local LLM",
			baseUrl: "http://127.0.0.1:1234/v1/",
			api: "openai-completions",
			modelIds: ["llama", "llama", " qwen "],
		});
		const written = JSON.parse(configFile.text ?? "{}");
		expect(written.$schema).toBe("x");
		expect(written.providers.gateway.apiKey).toBe("$GATEWAY_KEY");
		expect(written.providers["local-llm"]).toEqual({
			name: "Local LLM",
			baseUrl: "http://127.0.0.1:1234/v1",
			api: "openai-completions",
			models: [{ id: "llama" }, { id: "qwen" }],
		});
		// Settings report a declared provider without `apiKey` as configured; a key stored under its ID is what requests use.
		expect(settings.providers.find((p) => p.providerId === "local-llm")).toMatchObject({ source: "config", configured: true });
		expect((await service.handle("models.list", {})).filter((m) => m.provider === "local-llm").map((m) => m.modelId)).toEqual(["llama", "qwen"]);

		await expect(
			service.handle("models.addProvider", { id: "faux", name: "F", baseUrl: "http://x", api: "openai-completions", modelIds: ["m"] }),
		).rejects.toThrow("built-in provider");
		await expect(
			service.handle("models.addProvider", { id: "y", name: "Y", baseUrl: "file:///etc", api: "openai-completions", modelIds: ["m"] }),
		).rejects.toThrow("http");
		configFile.text = "{ // comment\n }";
		await service.handle("models.addProvider", { id: "y", name: "Y", baseUrl: "http://x", api: "openai-completions", modelIds: ["m"] });
		expect(configFile.text).toContain("// comment");
	});

	it("tests a model with a real request and reports failures as results", async () => {
		expect(await service.handle("models.test", SCRIPTED_MODEL)).toEqual({ ok: true });
		const unknown = await service.handle("models.test", { provider: "faux", modelId: "nope" });
		expect(unknown.ok).toBe(false);
		expect(unknown.error).toContain("Unknown model");
	});
	it("serializes provider additions and records content-free outcomes", async () => {
		await Promise.all(["one", "two"].map((id) => service.handle("models.addProvider", { id, name: "private-name", baseUrl: "https://example.com/private", api: "openai-completions", modelIds: ["private-model"] })));
		expect(Object.keys(JSON.parse(configFile.text!).providers)).toEqual(["one", "two"]);
		await expect(service.handle("models.addProvider", { id: "one", name: "secret", baseUrl: "https://example.com", api: "openai-completions", modelIds: ["m"] })).rejects.toThrow("already exists");
		await service.handle("credentials.set", { providerId: "one", apiKey: "private-key" });
		expect(JSON.stringify(audit)).not.toMatch(/private|secret|example/);
		expect(audit).toEqual(expect.arrayContaining([expect.objectContaining({ operation: "models.addProvider", outcome: "failed" }), expect.objectContaining({ operation: "credentials.set", outcome: "succeeded" })]));
		const models = await service.handle("models.list", {});
		expect(models.find((m) => m.provider === "one")).toMatchObject({ source: "custom", overridden: false, endpoint: "https://example.com" });
		configFile.text = '{"providers":{"faux":{"baseUrl":"https://example.com/secret"}}}';
		expect((await service.handle("models.list", {})).find((m) => m.provider === "faux")).toMatchObject({ source: "builtin", overridden: true });
	});

	it("protects the Core before cancellation and copies it only as a Specialist", async () => {
		const [core] = await service.handle("bots.list", {});
		expect(core).toMatchObject({ kind: "core", name: "OpenBot", status: "active", pinned: true });
		await service.handle("bots.memory.update", { expectedRevision: 0, botId: core!.botId, content: "private core memory" });
		for (const change of [{ pinned: false }, { status: "hidden" as const }]) {
			await expect(service.handle("bots.update", { botId: core!.botId, ...change })).rejects.toThrow("Core Bot");
		}
		await expect(service.handle("bots.delete", { botId: core!.botId })).rejects.toThrow("Core Bot");
		expect(stoppedBots).toEqual([]);
		const copy = await service.handle("bots.duplicate", { botId: core!.botId, requestId: "copy-core" });
		expect(copy.kind).toBe("specialist");
		expect(await runtime.memory(copy.botId)).toBe("");
		await service.handle("bots.update", { botId: core!.botId, name: "My assistant", instructions: "Use short answers" });
		expect((await runtime.getBot(core!.botId))?.kind).toBe("core");
	});

});
