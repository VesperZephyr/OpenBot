import { mkdtemp, rm, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it } from "vitest";
import { Harness, createRegistry } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { BotsDoc } from "../src/bots.ts";
import { defaultAvatar } from "@openbot/protocol";
import { BotRuntime } from "../src/index.ts";
import { scriptedModels } from "../src/testing.ts";
let directory: string, runtime: BotRuntime;
const open = () => BotRuntime.open({ databasePath: join(directory, "db"), models: scriptedModels().models });
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "openbot-avatars-"));
	runtime = await open();
});
afterEach(async () => {
	await runtime.close();
	await rm(directory, { recursive: true, force: true });
});
const image = { sha256: "a".repeat(64), base64: "dGVzdA==" };
const avatar = { kind: "image" as const, sha256: image.sha256 };
it("keeps generated identities stable across name/role edits, duplicate names and restart", async () => {
	const core = await runtime.ensureCoreBot(1),
		specialist = await runtime.createBot({ botId: "other", name: core.name, createdAt: 2 });
	expect(specialist.avatar).not.toEqual(core.avatar);
	const updated = await runtime.updateBot(core.botId, {
		expectedRevision: core.revision,
		name: "Nova",
		role: "Research",
	});
	expect(updated.avatar).toEqual(core.avatar);
	await runtime.close();
	runtime = await open();
	expect((await runtime.ensureCoreBot(3)).avatar).toEqual(core.avatar);
	for (const change of [{ status: "hidden" as const }, { status: "deleted" as const }, { pinned: false }])
		await expect(runtime.updateBot(core.botId, change)).rejects.toThrow("Core Bot");
});
it("commits image and profile atomically, rejects stale revisions and missing asset references", async () => {
	const bot = await runtime.createBot({ botId: "one", name: "One", createdAt: 1 });
	await runtime.updateBot(bot.botId, { name: "Renamed", expectedRevision: 1 });
	await expect(runtime.updateBot(bot.botId, { avatar, expectedRevision: 1 }, undefined, image)).rejects.toThrow(
		"Profile changed",
	);
	expect(await runtime.avatarImage(bot.botId)).toBeNull();
	await expect(runtime.updateBot(bot.botId, { avatar, expectedRevision: 2 })).rejects.toThrow("unavailable");
	const updated = await runtime.updateBot(bot.botId, { avatar, expectedRevision: 2 }, undefined, image);
	expect(updated.revision).toBe(3);
	expect(await runtime.avatarImage(bot.botId)).toEqual(image);
	expect(JSON.stringify(await runtime.listBots())).not.toContain(image.base64);
	await runtime.close();
	runtime = await open();
	expect(await runtime.avatarImage(bot.botId)).toEqual(image);
});
it("shares duplicate artwork and releases it only after the last retained reference changes", async () => {
	const first = await runtime.createBot({ botId: "one", name: "One", createdAt: 1 });
	await runtime.updateBot(first.botId, { avatar }, undefined, image);
	const copy = await runtime.createBot({ botId: "two", name: "Copy", avatar, createdAt: 2 });
	expect(await runtime.avatarImage(copy.botId)).toEqual(image);
	expect(await runtime.memory(copy.botId)).toBe("");
	await runtime.updateBot(first.botId, { avatar: defaultAvatar(first.botId) });
	expect(await runtime.avatarImage(copy.botId)).toEqual(image);
	await runtime.updateBot(copy.botId, { avatar: defaultAvatar(copy.botId) });
	await expect(runtime.updateBot(first.botId, { avatar })).rejects.toThrow("unavailable");
});

it("loads a pre-avatar profile with stable identity and preserves its prompt and memory", async () => {
	await runtime.createBot({
		botId: "legacy",
		name: "Before avatars",
		instructions: "Keep my prompt",
		memory: "Keep my memory",
		createdAt: 1,
	});
	await runtime.close();
	const harness = await Harness.open(
		await openNodeSqliteStorage(join(directory, "db")),
		{ models: scriptedModels().models, registry: createRegistry() },
		BACKGROUND_CONTEXT,
	);
	await harness.commit(async (tx) => {
		const bots = await tx.doc(BotsDoc);
		const { avatar: _avatar, ...legacy } = bots.bots.legacy!;
		bots.bots.legacy = legacy;
	}, BACKGROUND_CONTEXT);
	await harness.close(BACKGROUND_CONTEXT);
	runtime = await open();
	expect(await runtime.getBot("legacy")).toMatchObject({
		name: "Before avatars",
		instructions: "Keep my prompt",
		avatar: defaultAvatar("legacy"),
	});
	expect(await runtime.memory("legacy")).toBe("Keep my memory");
	await runtime.updateBot("legacy", { name: "New name" });
	expect((await runtime.getBot("legacy"))?.avatar).toEqual(defaultAvatar("legacy"));
});
it("restores uploaded artwork together with a copied closed SQLite store", async () => {
	await runtime.createBot({ botId: "backup", name: "Backup", createdAt: 1 });
	await runtime.updateBot("backup", { avatar }, undefined, image);
	await runtime.close();
	const path = join(directory, "backup.sqlite");
	await copyFile(join(directory, "db"), path);
	const restored = await BotRuntime.open({ databasePath: path, models: scriptedModels().models });
	try {
		expect((await restored.getBot("backup"))?.avatar).toEqual(avatar);
		expect(await restored.avatarImage("backup")).toEqual(image);
	} finally {
		await restored.close();
		runtime = await open();
	}
});

it("caps distinct retained images while allowing replacement and shared duplicate artwork", async () => {
	for (let i = 0; i < 128; i++) {
		const botId = `image-${i}`,
			sha256 = i.toString(16).padStart(64, "0");
		await runtime.createBot({ botId, name: botId, createdAt: i });
		await runtime.updateBot(botId, { avatar: { kind: "image", sha256 } }, undefined, { sha256, base64: image.base64 });
	}
	await runtime.createBot({ botId: "overflow", name: "Overflow", createdAt: 129 });
	await expect(runtime.updateBot("overflow", { avatar }, undefined, image)).rejects.toThrow("storage is full");
	await runtime.updateBot("image-0", { avatar }, undefined, image);
	await runtime.updateBot("overflow", { avatar });
	expect(await runtime.avatarImage("overflow")).toEqual(image);
	await runtime.updateBot("overflow", { status: "deleted" });
	await runtime.updateBot("image-0", { avatar: defaultAvatar("image-0") });
	await runtime.createBot({ botId: "retained-copy", name: "Retained copy", avatar, createdAt: 130 });
	expect(await runtime.avatarImage("retained-copy")).toEqual(image);
});
