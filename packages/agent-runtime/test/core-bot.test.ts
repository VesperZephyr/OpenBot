import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BotRuntime } from "../src/index.ts";
import { scriptedModels } from "../src/testing.ts";
let directory: string;
let runtime: BotRuntime;
const open = () => BotRuntime.open({ databasePath: join(directory, "db.sqlite"), models: scriptedModels("OK").models });
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "openbot-core-")); runtime = await open(); });
afterEach(async () => { await runtime.close(); await rm(directory, { recursive: true, force: true }); });

it("creates exactly one Core without a model and preserves existing legacy-shaped Bots", async () => {
	await runtime.createBot({ botId: "legacy", name: "Old", instructions: "Keep my role", createdAt: 1, memory: "Keep my memory" });
	const cores = await Promise.all(Array.from({ length: 5 }, () => runtime.ensureCoreBot(2)));
	expect(new Set(cores.map((c) => c.botId)).size).toBe(1);
	expect(await runtime.listBots()).toHaveLength(2);
	expect(await runtime.getBot("legacy")).toMatchObject({ kind: "specialist", instructions: "Keep my role" });
	await runtime.updateBot(cores[0]!.botId, { name: "Renamed", instructions: "Keep this too" });
	await runtime.close(); runtime = await open();
	expect(await runtime.ensureCoreBot(3)).toMatchObject({ botId: cores[0]!.botId, kind: "core", name: "Renamed", instructions: "Keep this too" });
	expect(await runtime.memory("legacy")).toBe("Keep my memory");
	for (const change of [{ status: "deleted" as const }, { status: "hidden" as const }, { pinned: false }]) {
		await expect(runtime.updateBot(cores[0]!.botId, change)).rejects.toThrow("Core Bot");
	}
});

it("reuses the allocated identity after interrupted bootstrap", async () => {
	const create = vi.spyOn(runtime, "createBot").mockRejectedValueOnce(new Error("Interrupted"));
	await expect(runtime.ensureCoreBot(1)).rejects.toThrow("Interrupted");
	const allocated = create.mock.calls[0]![0].botId;
	create.mockRestore();
	await runtime.close(); runtime = await open();
	expect((await runtime.ensureCoreBot(2)).botId).toBe(allocated);
	expect(await runtime.listBots()).toHaveLength(1);
});
