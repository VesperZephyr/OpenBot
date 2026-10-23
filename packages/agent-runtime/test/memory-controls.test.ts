import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { BotRuntime } from "../src/index.ts";
import { randomUUID } from "node:crypto";
import { scriptedModels } from "../src/testing.ts";

let directory: string;
let runtime: BotRuntime;
let call: { runId: string; conversationId: string };
const open = () => BotRuntime.open({ databasePath: join(directory, "db.sqlite"), models: scriptedModels("OK").models });
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "openbot-memory-"));
	runtime = await open();
	await runtime.createBot({ botId: "a", name: "A", createdAt: 0, memory: "Legacy note" });
	await runtime.createBot({ botId: "b", name: "B", createdAt: 0 });
	call = { runId: "run-a", conversationId: await runtime.conversationKey("a") };
	await runtime.runsStore().put({ runId: call.runId, botId: "a", state: "running", origin: "user", requestIds: ["source-a"], createdAt: 0, messages: [{ requestId: "source-a", text: "Remember my preference" }], inputs: [{ requestId: "source-a", text: "Remember my preference" }] });
});
afterEach(async () => {
	await runtime.close();
	await rm(directory, { recursive: true, force: true });
});

it("migrates content-only documents additively and restores only this Bot's bounded history", async () => {
	expect(await runtime.memoryState("a")).toMatchObject({ content: "Legacy note", revision: 0, source: "legacy", updatedAt: null, history: [] });
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
		runtime.editMemory("a", { action: "replace", section: "Notes", content: "Model note", expectedRevision: 0 }, "race", call),
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
	expect(await runtime.editMemory("a", edit, "conversation:call", call)).toBe(1);
	for (let rev = 1; rev < 23; rev++) await runtime.setMemory("a", "Corrected", rev);
	await runtime.close();
	runtime = await open();
	expect(await runtime.editMemory("a", edit, "conversation:call", call)).toBe(1);
	expect(await runtime.memoryState("a")).toMatchObject({ content: "Corrected", revision: 23 });
	await expect(runtime.editMemory("b", edit, "conversation:call", call)).rejects.toThrow("arguments changed");
	await expect(runtime.editMemory("a", { ...edit, content: "Forged" }, "conversation:call", call)).rejects.toThrow("arguments changed");
});

it("does not create a receipt for failed edits and rejects deleted-Bot writes", async () => {
	const edit = { action: "append" as const, section: "Notes", content: "中".repeat(3000), expectedRevision: 0 };
	await expect(runtime.editMemory("a", edit, "failed", call)).rejects.toThrow("limited");
	expect((await runtime.memoryState("a")).revision).toBe(0);
	expect(await runtime.editMemory("a", { ...edit, content: "Fine" }, "failed", call)).toBe(1);
	await runtime.updateBot("a", { status: "deleted" });
	await expect(runtime.setMemory("a", "", 1)).rejects.toThrow("deleted");
	await expect(runtime.restoreMemory("a", 0, 1)).rejects.toThrow("deleted");
	await expect(runtime.editMemory("a", { ...edit, content: "Fine", expectedRevision: 1 }, "deleted", call)).rejects.toThrow("deleted");
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

it("binds note provenance to the actual Run, rejects foreign contexts and reports pruned evidence honestly", async () => {
	await runtime.editMemory("a", { action: "replace", section: "Response language", content: "Use Chinese", expectedRevision: 0 }, "source-call", call);
	const state = await runtime.memoryState("a"), note = state.notes.find(n => n.heading === "Response language")!;
	expect(note.original).toMatchObject({ kind: "model", botId: "a", runId: call.runId, conversationId: call.conversationId, requestIds: ["source-a"] });
	expect(await runtime.memorySource("a", "bot", note.id, "original")).toMatchObject({ available: true, requests: [{ requestId: "source-a", text: "Remember my preference" }] });
	await expect(runtime.editMemory("b", { action: "append", section: "Foreign", content: "No", expectedRevision: 0 }, "foreign", call)).rejects.toThrow("direct user request");
	await expect(runtime.editMemory("a", { action: "append", section: "Wrong context", content: "No", expectedRevision: 1 }, "context", { ...call, conversationId: "999" })).rejects.toThrow("direct user request");
	await runtime.runsStore().put({ ...(await runtime.runsStore().get(call.runId))!, state: "completed", endedAt: 1 });
	for (let i = 0; i < 51; i++) await runtime.runsStore().put({ runId: `prune-${i}`, botId: "a", origin: "user", state: "completed", createdAt: i + 2, endedAt: i + 2, requestIds: [], messages: [], inputs: [] });
	expect(await runtime.memorySource("a", "bot", note.id, "original")).toMatchObject({ available: false, requests: [], source: { runId: call.runId } });
});

it("protects an owner correction and forgotten topic even from fresh model revisions after restart", async () => {
	const edit = { action: "replace" as const, section: "Current city", content: "London", expectedRevision: 0 };
	await runtime.editMemory("a", edit, "city", call);
	const note = (await runtime.memoryState("a")).notes.find(n => n.heading === "Current city")!;
	const correction = { botId: "a", scope: "bot" as const, requestId: randomUUID(), action: "edit" as const, noteId: note.id, content: "Singapore", expectedRevision: 1 };
	await runtime.changeMemoryNote(correction);
	await expect(runtime.editMemory("a", { ...edit, expectedRevision: 2 }, "old-source", call)).rejects.toThrow("protected");
	await runtime.changeMemoryNote({ botId: "a", scope: "bot", requestId: randomUUID(), action: "forget", noteId: note.id, expectedRevision: 2 });
	await runtime.close(); runtime = await open();
	await expect(runtime.editMemory("a", { ...edit, expectedRevision: 3 }, "revive", call)).rejects.toThrow("protected");
	expect(await runtime.editMemory("a", edit, "city", call)).toBe(1);
	expect((await runtime.memoryState("a")).content).not.toContain("London");
	await runtime.changeMemoryNote(correction); // Lost owner response replay must not revive the corrected note.
	expect((await runtime.memoryState("a")).revision).toBe(3);
	await expect(runtime.changeMemoryNote({ ...correction, content: "Paris" })).rejects.toThrow("arguments changed");
	await runtime.restoreMemory("a", 2, 3);
	expect((await runtime.memoryState("a")).notes.find(n => n.id === note.id)).toMatchObject({ content: "Singapore", protected: true, status: "active", changed: { kind: "restore" } });
});

it("moves scope atomically, preserves attribution, blocks shadowing and requires both current revisions", async () => {
	await runtime.editMemory("a", { action: "append", section: "Timezone", content: "Asia/Singapore", expectedRevision: 0 }, "zone", call);
	const note = (await runtime.memoryState("a")).notes.find(n => n.heading === "Timezone")!;
	const share = { botId: "a", scope: "bot" as const, requestId: randomUUID(), action: "share" as const, noteId: note.id, expectedRevision: 1, otherRevision: 0 };
	await runtime.setSharedMemory("## Language\nChinese", 0);
	await expect(runtime.changeMemoryNote(share)).rejects.toThrow("Memory changed");
	expect((await runtime.memoryState("a")).notes.find(n => n.id === note.id)?.status).toBe("active");
	const accepted = { ...share, otherRevision: 1 };
	await runtime.changeMemoryNote(accepted);
	expect((await runtime.sharedMemory()).notes.find(n => n.key === "timezone")).toMatchObject({ original: note.original, protected: true });
	expect((await runtime.memoryState("a")).notes.find(n => n.id === note.id)).toMatchObject({ status: "shared", content: "", protected: true });
	await runtime.changeMemoryNote(accepted);
	expect((await runtime.sharedMemory()).revision).toBe(2);
	await expect(runtime.editMemory("a", { action: "replace", section: "TimeZone", content: "UTC", expectedRevision: 2 }, "shadow", call)).rejects.toThrow("protected");
	await runtime.changeMemoryNote({ botId: "b", scope: "shared", requestId: randomUUID(), action: "unshare", noteId: note.id, expectedRevision: 2, otherRevision: 0 });
	expect((await runtime.memoryState("b")).content).toContain("Asia/Singapore");
	expect((await runtime.sharedMemory()).content).not.toContain("Asia/Singapore");
	await runtime.close(); runtime = await open();
	expect((await runtime.memoryState("b")).notes[0]?.original).toEqual(note.original);
});

it("rolls back oversized sharing and destination collisions without losing the source note", async () => {
	await runtime.setMemory("a", `## Long note\n${"x".repeat(4096)}`, 0);
	const local = await runtime.memoryState("a"), note = local.notes.find(n => n.heading === "Long note")!;
	await expect(runtime.changeMemoryNote({ botId: "a", scope: "bot", requestId: randomUUID(), action: "share", noteId: note.id, expectedRevision: 1, otherRevision: 0 })).rejects.toThrow("limited to 4 KB");
	expect(await runtime.memoryState("a")).toEqual(local);
	expect((await runtime.sharedMemory()).revision).toBe(0);
	await runtime.setSharedMemory("## Long note\nDestination", 0);
	await expect(runtime.changeMemoryNote({ botId: "a", scope: "bot", requestId: randomUUID(), action: "share", noteId: note.id, expectedRevision: 1, otherRevision: 1 })).rejects.toThrow("destination already");
	expect(await runtime.memoryState("a")).toEqual(local);
});

it.each(["peer", "background", "routine"] as const)("rejects %s memory writes and accepts no scope from the model", async origin => {
	const run = (await runtime.runsStore().get(call.runId))!;
	await runtime.runsStore().put({ ...run, origin });
	await expect(runtime.editMemory("a", { action: "append", section: "Forbidden", content: "No", expectedRevision: 0 }, origin, call)).rejects.toThrow("direct user request");
	expect((await runtime.memoryState("a")).revision).toBe(0);
	await runtime.ensureChannel("a", "group_test");
	await runtime.runsStore().put({ ...run, channelId: "group_test" });
	await expect(runtime.editMemory("a", { action: "append", section: "Forbidden", content: "No", expectedRevision: 0 }, `${origin}-group`, call)).rejects.toThrow("direct user request");
});

it("retains topic tombstones at the quota instead of silently forgetting correction protection", async () => {
	await runtime.setMemory("b", Array.from({ length: 128 }, (_, i) => `## Topic ${i}\nx`).join("\n\n"), 0);
	await runtime.setMemory("b", "", 1);
	await expect(runtime.changeMemoryNote({ botId: "b", scope: "bot", requestId: randomUUID(), action: "add", heading: "New topic", content: "New", expectedRevision: 2 })).rejects.toThrow("note limit");
	expect((await runtime.memoryState("b")).notes).toHaveLength(128);
	expect((await runtime.memoryState("b")).content).toBe("");
});
