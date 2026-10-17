import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { BotRuntime } from "../src/index.ts";
import { scriptedModels } from "../src/testing.ts";

let directory: string;
let runtime: BotRuntime;
const open = () => BotRuntime.open({ databasePath: join(directory, "db.sqlite"), models: scriptedModels("OK").models });
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "openbot-memory-"));
	runtime = await open();
	await runtime.createBot({ botId: "a", name: "A", createdAt: 0, memory: "Legacy note" });
	await runtime.createBot({ botId: "b", name: "B", createdAt: 0 });
});
afterEach(async () => {
	await runtime.close();
	await rm(directory, { recursive: true, force: true });
});

it("migrates content-only documents additively and restores only this Bot's bounded history", async () => {
	expect(await runtime.memoryState("a")).toEqual({ content: "Legacy note", revision: 0, source: "legacy", updatedAt: null, history: [] });
	for (let revision = 0; revision < 22; revision++) await runtime.setMemory("a", `Note ${revision + 1}`, revision);
	const state = await runtime.memoryState("a");
	expect(state.history).toHaveLength(20);
	expect(state.history[0]?.revision).toBe(2);
	await expect(runtime.restoreMemory("a", 0, 22)).rejects.toThrow("no longer available");
	await expect(runtime.restoreMemory("b", 20, 0)).rejects.toThrow("no longer available");
	const restored = await runtime.restoreMemory("a", 3, 22);
	expect(restored).toMatchObject({ revision: 23, content: "Note 3", source: "restore", restoredFrom: 3 });
	await runtime.close();
	runtime = await open();
	expect(await runtime.memoryState("a")).toEqual(restored);
	expect(await runtime.memoryState("b")).toMatchObject({ content: "", revision: 0 });
});

it("serializes concurrent user/model edits and rejects stale clears and restores", async () => {
	const results = await Promise.allSettled([
		runtime.setMemory("a", "User correction", 0),
		runtime.editMemory("a", { action: "replace", section: "Notes", content: "Model note", expectedRevision: 0 }, "race"),
	]);
	expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
	const current = await runtime.memoryState("a");
	expect(current.revision).toBe(1);
	await expect(runtime.setMemory("a", "", 0)).rejects.toThrow("Memory changed");
	await expect(runtime.restoreMemory("a", 0, 0)).rejects.toThrow("Memory changed");
	expect(await runtime.memoryState("a")).toEqual(current);
});

it("replays the original receipt after restart and history eviction without overwriting later corrections", async () => {
	const edit = { action: "replace" as const, section: "Notes", content: "Original", expectedRevision: 0 };
	expect(await runtime.editMemory("a", edit, "conversation:call")).toBe(1);
	for (let rev = 1; rev < 23; rev++) await runtime.setMemory("a", "Corrected", rev);
	await runtime.close();
	runtime = await open();
	expect(await runtime.editMemory("a", edit, "conversation:call")).toBe(1);
	expect(await runtime.memoryState("a")).toMatchObject({ content: "Corrected", revision: 23 });
	await expect(runtime.editMemory("b", edit, "conversation:call")).rejects.toThrow("arguments changed");
	await expect(runtime.editMemory("a", { ...edit, content: "Forged" }, "conversation:call")).rejects.toThrow("arguments changed");
});

it("does not create a receipt for failed edits and rejects deleted-Bot writes", async () => {
	const edit = { action: "append" as const, section: "Notes", content: "中".repeat(3000), expectedRevision: 0 };
	await expect(runtime.editMemory("a", edit, "failed")).rejects.toThrow("limited");
	expect((await runtime.memoryState("a")).revision).toBe(0);
	expect(await runtime.editMemory("a", { ...edit, content: "Fine" }, "failed")).toBe(1);
	await runtime.updateBot("a", { status: "deleted" });
	await expect(runtime.setMemory("a", "", 1)).rejects.toThrow("deleted");
	await expect(runtime.restoreMemory("a", 0, 1)).rejects.toThrow("deleted");
	await expect(runtime.editMemory("a", { ...edit, content: "Fine", expectedRevision: 1 }, "deleted")).rejects.toThrow("deleted");
	expect((await runtime.memoryState("a")).revision).toBe(1);
});

it("protects stale Prompt edits and keeps the raw Prompt separate from its request marker", async () => {
	await runtime.updateBot("a", { instructions: "Answer in Chinese.", expectedRevision: 1 });
	await expect(runtime.updateBot("a", { instructions: "Stale", expectedRevision: 1 })).rejects.toThrow("Profile changed");
	expect(await runtime.getBot("a")).toMatchObject({ instructions: "Answer in Chinese.", revision: 2 });
	await runtime.close();
	runtime = await open();
	expect(await runtime.getBot("a")).toMatchObject({ instructions: "Answer in Chinese.", revision: 2 });
});
