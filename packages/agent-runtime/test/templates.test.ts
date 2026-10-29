import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, it, expect } from "vitest";
import { BotRuntime, type CreateBotInput } from "../src/index.ts";
import { scriptedModels } from "../src/testing.ts";
import { TemplateImportsDoc } from "../src/template-imports.ts";
import { Harness, createRegistry } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { BotsDoc } from "../src/bots.ts";
import { AvatarDoc } from "../src/avatars.ts";
let dir: string, runtime: BotRuntime;
const open = () => BotRuntime.open({ databasePath: join(dir, "db"), models: scriptedModels().models, history: false });
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "openbot-template-runtime-"));
	runtime = await open();
});
afterEach(async () => {
	await runtime.close();
	await rm(dir, { recursive: true, force: true });
});
function request() {
	const id = randomUUID(),
		botId = `bot_template_${id}`;
	return {
		input: {
			botId,
			name: "Researcher",
			instructions: "Only portable instructions",
			createdAt: 1,
		} satisfies CreateBotInput,
		receipt: { requestId: id, requestDigest: "a".repeat(64), botId, committedAt: 1 },
	};
}
it("commits one new identity under concurrent replay and survives response loss, restart, edits and deletion", async () => {
	const r = request();
	const results = await Promise.all([
		runtime.importTemplate(r.input, r.receipt),
		runtime.importTemplate(r.input, r.receipt),
	]);
	expect(results[0]).toEqual(results[1]);
	expect(await runtime.listBots()).toHaveLength(1);
	expect(await runtime.memory(r.input.botId)).toBe("");
	expect((await runtime.snapshot(r.input.botId)).items).toEqual([]);
	await expect(runtime.importTemplate(r.input, { ...r.receipt, requestDigest: "b".repeat(64) })).rejects.toThrow(
		"different choices",
	);
	await runtime.close();
	runtime = await open();
	expect(await runtime.templateStatus(r.receipt.requestId, r.receipt.requestDigest)).toEqual(results[0]);
	await runtime.updateBot(r.input.botId, { name: "Edited", status: "deleted" });
	expect(await runtime.importTemplate(r.input, r.receipt)).toEqual({ botId: r.input.botId, state: "deleted" });
	expect((await runtime.getBot(r.input.botId))?.name).toBe("Edited");
});
it("rolls back the conversation and receipt on missing image and rejects an unrelated identity collision", async () => {
	const r = request();
	await expect(
		runtime.importTemplate({ ...r.input, avatar: { kind: "image", sha256: "a".repeat(64) } }, r.receipt),
	).rejects.toThrow("unavailable");
	expect(await runtime.templateStatus(r.receipt.requestId)).toBeNull();
	expect(await runtime.listBots()).toEqual([]);
	await runtime.createBot(r.input);
	await expect(runtime.importTemplate(r.input, r.receipt)).rejects.toThrow("identity already exists");
});
it("exports a revision-bound allowlist including Core and atomically imports uploaded artwork", async () => {
	const core = await runtime.ensureCoreBot(1);
	await runtime.updateBot(core.botId, { instructions: "portable", role: "Analyst" });
	await expect(runtime.exportTemplate(core.botId, core.revision)).rejects.toThrow("Profile changed");
	const doc = await runtime.exportTemplate(core.botId, 2);
	expect(Object.keys(doc.profile).sort()).toEqual([
		"avatar",
		"defaultSkills",
		"instructions",
		"model",
		"name",
		"role",
		"thinkingLevel",
	]);
	expect(JSON.stringify(doc)).not.toContain(core.botId);
	const r = request(),
		image = { sha256: "b".repeat(64), base64: "dGVzdA==" };
	await runtime.importTemplate({ ...r.input, avatar: { kind: "image", sha256: image.sha256 } }, r.receipt, image);
	expect(await runtime.avatarImage(r.input.botId)).toEqual(image);
	expect((await runtime.getBot(r.input.botId))?.kind).toBe("specialist");
	expect((await runtime.exportTemplate(r.input.botId, 1)).profile.avatar).toEqual({
		kind: "png",
		base64: image.base64,
	});
	await runtime.updateBot(r.input.botId, { instructions: "a".repeat(65537) });
	await expect(runtime.exportTemplate(r.input.botId, 2)).rejects.toThrow("Invalid Bot template");
	await runtime.updateBot(r.input.botId, { instructions: "portable" });
	await runtime.close();
	const h = await Harness.open(
		await openNodeSqliteStorage(join(dir, "db")),
		{ registry: createRegistry(), models: scriptedModels().models },
		BACKGROUND_CONTEXT,
	);
	await h.commit(async (tx) => {
		(await tx.doc(AvatarDoc, image.sha256, null)).base64 = "";
	}, BACKGROUND_CONTEXT);
	await h.close(BACKGROUND_CONTEXT);
	runtime = await open();
	await expect(runtime.exportTemplate(r.input.botId, 3)).rejects.toThrow("Invalid Bot template");
});
it("validates receipt integrity when reopening a restored database", async () => {
	const r = request();
	await runtime.importTemplate(r.input, r.receipt);
	await runtime.close();
	const h = await Harness.open(
		await openNodeSqliteStorage(join(dir, "db")),
		{ registry: createRegistry(), models: scriptedModels().models },
		BACKGROUND_CONTEXT,
	);
	await h.commit(async (tx) => {
		(await tx.doc(TemplateImportsDoc)).receipts[r.receipt.requestId]!.botId = "missing";
	}, BACKGROUND_CONTEXT);
	await h.close(BACKGROUND_CONTEXT);
	await expect(open()).rejects.toThrow("Invalid template import receipts");
});
it("keeps all 4096 receipts, permits replay and ordinary creation, and rejects an untracked import", async () => {
	const first = request();
	await runtime.importTemplate(first.input, first.receipt);
	await runtime.close();
	const h = await Harness.open(
		await openNodeSqliteStorage(join(dir, "db")),
		{ registry: createRegistry(), models: scriptedModels().models },
		BACKGROUND_CONTEXT,
	);
	await h.commit(async (tx) => {
		const bots = (await tx.doc(BotsDoc)).bots,
			receipts = (await tx.doc(TemplateImportsDoc)).receipts;
		const source = JSON.parse(JSON.stringify(bots[first.input.botId]));
		for (let i = 1; i < 4096; i++) {
			const r = request();
			bots[r.input.botId] = { ...source, botId: r.input.botId };
			receipts[r.receipt.requestId] = r.receipt;
		}
	}, BACKGROUND_CONTEXT);
	await h.close(BACKGROUND_CONTEXT);
	runtime = await open();
	const next = request();
	await expect(runtime.importTemplate(next.input, next.receipt)).rejects.toThrow("create a Bot normally");
	expect(await runtime.templateStatus(next.receipt.requestId)).toBeNull();
	expect(await runtime.getBot(next.input.botId)).toBeUndefined();
	expect(await runtime.importTemplate(first.input, first.receipt)).toEqual({
		botId: first.input.botId,
		state: "active",
	});
	await runtime.createBot({ botId: "ordinary", name: "Ordinary", createdAt: 2 });
	expect((await runtime.listBots()).length).toBe(4097);
}, 30000);
it("rolls back imports at the shared 128-image quota without consuming a receipt", async () => {
	const first = request();
	await runtime.importTemplate(first.input, first.receipt);
	await runtime.close();
	const h = await Harness.open(
		await openNodeSqliteStorage(join(dir, "db")),
		{ registry: createRegistry(), models: scriptedModels().models },
		BACKGROUND_CONTEXT,
	);
	await h.commit(async (tx) => {
		const bots = (await tx.doc(BotsDoc)).bots,
			source = JSON.parse(JSON.stringify(bots[first.input.botId]));
		for (let i = 0; i < 128; i++)
			bots[`image-${i}`] = {
				...source,
				botId: `image-${i}`,
				avatar: { kind: "image", sha256: i.toString(16).padStart(64, "0") },
			};
	}, BACKGROUND_CONTEXT);
	await h.close(BACKGROUND_CONTEXT);
	runtime = await open();
	const r = request(),
		image = { sha256: "f".repeat(64), base64: "dGVzdA==" };
	await expect(
		runtime.importTemplate({ ...r.input, avatar: { kind: "image", sha256: image.sha256 } }, r.receipt, image),
	).rejects.toThrow("Avatar storage is full");
	expect(await runtime.templateStatus(r.receipt.requestId)).toBeNull();
	expect(await runtime.getBot(r.input.botId)).toBeUndefined();
	expect((await runtime.listBots()).length).toBe(129);
});
