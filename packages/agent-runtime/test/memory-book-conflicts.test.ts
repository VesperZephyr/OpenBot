import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { BotRuntime } from "../src/index.ts";
import { scriptedModels } from "../src/testing.ts";

let directory: string;
let runtime: BotRuntime;
let call: { runId: string; conversationId: string };
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "openbot-memory-conflict-"));
	runtime = await BotRuntime.open({ databasePath: join(directory, "db.sqlite"), models: scriptedModels().models });
	await runtime.createBot({ botId: "a", name: "A", createdAt: 0, memory: "Legacy note" });
	call = { runId: "run-a", conversationId: await runtime.conversationKey("a") };
	await runtime.runsStore().put({
		runId: call.runId,
		botId: "a",
		state: "running",
		origin: "user",
		requestIds: ["source-a"],
		createdAt: 0,
		messages: [{ requestId: "source-a", text: "Remember my preference" }],
		inputs: [{ requestId: "source-a", text: "Remember my preference" }],
	});
});
afterEach(async () => {
	await runtime.close();
	await rm(directory, { recursive: true, force: true });
});

const changed = {
	code: "request_conflict",
	message: "Memory changed. Reload before saving your draft.",
};

it("rejects a concurrent model write, a replay bound to another run, and a stale revision", async () => {
	const section = { action: "replace" as const, section: "City", expectedRevision: 0 };
	const raced = await Promise.allSettled([
		runtime.editMemory("a", { ...section, content: "London" }, "race-left", call),
		runtime.editMemory("a", { ...section, content: "Paris" }, "race-right", call),
	]);
	expect(raced[0]).toEqual({ status: "fulfilled", value: 1 });
	expect(raced[1]?.status).toBe("rejected");
	if (raced[1]?.status !== "rejected") return;
	expect(raced[1].reason).toMatchObject({ ...changed, details: { currentRevision: 1 } });
	const saved = await runtime.memoryState("a");
	expect(saved.revision).toBe(1);
	expect(saved.notes.find((note) => note.heading === "City")?.content).toBe("London");
	expect(saved.content).not.toContain("Paris");

	await expect(
		runtime.editMemory("a", { ...section, content: "London" }, "race-left", { ...call, runId: "run-other" }),
	).rejects.toMatchObject({ code: "request_conflict", message: "Memory invocation arguments changed" });
	expect(await runtime.editMemory("a", { ...section, content: "London" }, "race-left", call)).toBe(1);
	expect(await runtime.memoryState("a")).toEqual(saved);

	await expect(runtime.editMemory("a", { ...section, content: "Paris" }, "race-right", call)).rejects.toMatchObject({
		...changed,
		details: { currentRevision: 1 },
	});
	expect(await runtime.editMemory("a", { ...section, content: "Paris", expectedRevision: 1 }, "race-right", call)).toBe(2);
	expect((await runtime.memoryState("a")).notes.find((note) => note.heading === "City")?.content).toBe("Paris");
});

it("rejects a stale note revision, a duplicate topic, and a concurrent note write", async () => {
	await runtime.setMemory("a", "## City\nLondon", 0);
	const note = (await runtime.memoryState("a")).notes.find((item) => item.heading === "City")!;
	const saved = await runtime.memoryState("a");
	await expect(
		runtime.changeMemoryNote({
			botId: "a",
			scope: "bot",
			requestId: "stale",
			action: "edit",
			noteId: note.id,
			content: "Singapore",
			expectedRevision: 0,
		}),
	).rejects.toMatchObject({ ...changed, details: { currentRevision: 1 } });
	await expect(
		runtime.changeMemoryNote({
			botId: "a",
			scope: "bot",
			requestId: "duplicate",
			action: "add",
			heading: "city",
			content: "Paris",
			expectedRevision: 1,
		}),
	).rejects.toMatchObject({
		code: "request_conflict",
		message: "This memory topic already exists. Edit the existing note.",
	});
	expect(await runtime.memoryState("a")).toEqual(saved);

	const raced = await Promise.allSettled([
		runtime.changeMemoryNote({
			botId: "a",
			scope: "bot",
			requestId: "left",
			action: "edit",
			noteId: note.id,
			content: "Singapore",
			expectedRevision: 1,
		}),
		runtime.changeMemoryNote({
			botId: "a",
			scope: "bot",
			requestId: "right",
			action: "edit",
			noteId: note.id,
			content: "Paris",
			expectedRevision: 1,
		}),
	]);
	expect(raced[0]?.status).toBe("fulfilled");
	expect(raced[1]?.status).toBe("rejected");
	if (raced[1]?.status !== "rejected") return;
	expect(raced[1].reason).toMatchObject({ ...changed, details: { currentRevision: 2 } });
	const after = await runtime.memoryState("a");
	expect(after.revision).toBe(2);
	expect(after.notes.find((item) => item.id === note.id)?.content).toBe("Singapore");
	expect(after.content).not.toContain("Paris");
	expect((await runtime.sharedMemory()).revision).toBe(0);
});

it("rejects a stale shared-memory save and restore", async () => {
	const saved = await runtime.setSharedMemory("## Language\nChinese", 0);
	expect(saved.revision).toBe(1);
	await expect(runtime.setSharedMemory("## Language\nEnglish", 0)).rejects.toMatchObject({
		...changed,
		details: { currentRevision: 1 },
	});
	await expect(runtime.restoreSharedMemory(0, 0)).rejects.toMatchObject({ ...changed, details: { currentRevision: 1 } });
	expect(await runtime.sharedMemory()).toEqual(saved);
	expect((await runtime.memoryState("a")).revision).toBe(0);
});
