import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { BotRuntime, type StoredRun } from "../src/index.ts";
import { scriptedModels, SCRIPTED_MODEL } from "../src/testing.ts";

it("keeps legacy answers across cutover and explains an empty new-mode answer without a false completion", async () => {
	const directory = await mkdtemp(join(tmpdir(), "openbot-message-upgrade-"));
	const model = scriptedModels("Legacy answer", "");
	const runtime = await BotRuntime.open({ databasePath: join(directory, "db"), models: model.models });
	try {
		await runtime.createBot({ botId: "a", name: "A", createdAt: 1, model: SCRIPTED_MODEL });
		runtime.resume();
		const legacy: StoredRun = {
			runId: "legacy",
			botId: "a",
			state: "running",
			requestIds: ["old"],
			createdAt: 1,
			messages: [],
			inputs: [],
		};
		await runtime.runsStore().put(legacy);
		const old = await runtime.submit("a", "old", "Legacy input", "start");
		await runtime.waitSubmission("a", old.submissionId);
		const before = (await runtime.snapshot("a")).items;
		expect((await runtime.snapshot("a")).messageMode).toBe(false);
		expect(before.filter((i) => i.kind === "assistant")).toMatchObject([{ parts: [{ text: "Legacy answer" }] }]);
		await runtime.runsStore().put({ ...legacy, state: "completed" });
		const next: StoredRun = { runId: "next", botId: "a", state: "queued", requestIds: ["new"], createdAt: 2, messages: [], inputs: [] };
		await runtime.runsStore().put(next);
		await runtime.runsStore().put({ ...next, state: "running" });
		const input = await runtime.submit("a", "new", "Empty result", "start");
		await runtime.waitSubmission("a", input.submissionId);
		await runtime
			.runsStore()
			.put({
				...next,
				state: "completed",
				inputs: [{ requestId: "new", text: "Empty result", submissionId: input.submissionId, outcome: { status: "done" } }],
			});
		const after = await runtime.snapshot("a");
		expect(after.messageMode).toBe(true);
		expect(after.items.filter((i) => i.kind === "assistant")).toEqual(before.filter((i) => i.kind === "assistant"));
		expect(after.items.filter((i) => i.kind === "outcome")).toMatchObject([{ id: `outcome:${input.submissionId}`, category: "empty" }]);
		await runtime.retryHistory();
		await expect.poll(() => runtime.historyStatus().state, { timeout: 10000 }).toBe("ready");
		const window = await runtime.historyWindow({ conversationKey: "bot:a", position: { kind: "latest" } });
		expect(window.status === "ready" && window.window.readCursor).toBe(1);
	} finally {
		await runtime.close();
		await rm(directory, { recursive: true, force: true });
	}
});

it("persists the byte quota across reopen and receipts independently of pruned Runs", async () => {
	const directory = await mkdtemp(join(tmpdir(), "openbot-message-quota-"));
	const options = { databasePath: join(directory, "db"), models: scriptedModels("Canonical answer").models };
	let runtime = await BotRuntime.open(options);
	try {
		await runtime.createBot({ botId: "a", name: "A", createdAt: 1, model: SCRIPTED_MODEL });
		const run: StoredRun = { runId: "quota", botId: "a", state: "queued", requestIds: ["input"], createdAt: 1, messages: [], inputs: [] };
		await runtime.runsStore().put(run);
		await runtime.runsStore().put({ ...run, state: "running" });
		runtime.resume();
		const input = await runtime.submit("a", "input", "Work", "start");
		await runtime.waitSubmission("a", input.submissionId);
		const call = {
			botId: "a",
			conversationId: await runtime.conversationKey("a"),
			runId: run.runId,
			callId: "update-0",
			targetId: "test",
			text: "x".repeat(16384),
		};
		const receipt = await runtime.messages().publish(call, () => {});
		for (let i = 1; i < 8; i++) await runtime.messages().publish({ ...call, callId: `update-${i}` }, () => {});
		await runtime.close();
		runtime = await BotRuntime.open(options);
		expect(await runtime.messages().publish(call, () => {})).toEqual(receipt);
		await expect(runtime.messages().publish({ ...call, callId: "overflow", text: "x" }, () => {})).rejects.toThrow("quota");
		await runtime
			.runsStore()
			.put({
				...run,
				state: "completed",
				inputs: [{ requestId: "input", text: "Work", submissionId: input.submissionId, outcome: { status: "done" } }],
			});
		for (let i = 0; i < 51; i++) await runtime.runsStore().put({ ...run, runId: `later-${i}`, state: "completed", createdAt: i + 2 });
		expect(await runtime.runsStore().get(run.runId)).toBeUndefined();
		expect(await runtime.messages().receipt(call)).toEqual(receipt);
		expect((await runtime.snapshot("a")).items.filter((i) => i.kind === "assistant")).toHaveLength(9);
	} finally {
		await runtime.close();
		await rm(directory, { recursive: true, force: true });
	}
});
