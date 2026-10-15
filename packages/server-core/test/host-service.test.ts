import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BotRuntime } from "@openbot/agent-runtime";
import { SCRIPTED_MODEL, scriptedModels } from "@openbot/agent-runtime/testing";
import { type ConversationSnapshot, type HostEventType, PROTOCOL_VERSION } from "@openbot/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HostService, MemorySecretStore } from "../src/index.ts";

const status = { protocolVersion: PROTOCOL_VERSION, hostVersion: "test", nodeVersion: "test", targetId: "mac", startedAt: 0 };

describe("HostService", () => {
	let directory: string;
	let runtime: BotRuntime;
	let service: HostService;
	let events: HostEventType[];
	let secrets: MemorySecretStore;
	/** Resolves with the first conversation snapshot that satisfies the predicate. */
	let nextSnapshot: (predicate: (snapshot: ConversationSnapshot) => boolean) => Promise<ConversationSnapshot>;

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "openbot-host-"));
		runtime = await BotRuntime.open({ databasePath: join(directory, "db.sqlite"), models: scriptedModels("Done.").models });
		events = [];
		secrets = new MemorySecretStore();
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
});
