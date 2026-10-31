import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { BotRuntime, type ToolInvoker } from "@openbot/agent-runtime";
import { scriptedModels, SCRIPTED_MODEL } from "@openbot/agent-runtime/testing";
import { TOOL_CATALOG, type ToolDefinition } from "@openbot/protocol";
import { BotMessages, type ToolCall } from "../src/messages.ts";
import { RunScheduler } from "../src/runs.ts";

const waitTool: ToolDefinition = {
	name: "wait_for_user",
	capability: "commands",
	destination: "host",
	description: "Test gate",
	parameters: { type: "object", properties: {}, additionalProperties: false },
};
let root: string, runtime: BotRuntime, scheduler: RunScheduler, messages: BotMessages;
let release: PromiseWithResolvers<void>, entered: PromiseWithResolvers<void>, calls: ToolCall[];
const target = { kind: "local", targetId: "test" } as const;
async function open(...turns: Parameters<typeof scriptedModels>) {
	const model = scriptedModels(...turns);
	release = Promise.withResolvers();
	entered = Promise.withResolvers();
	calls = [];
	const invoke: ToolInvoker = async (call) => {
		if (call.tool === "send_message") {
			const bound = { ...call, target };
			calls.push(bound);
			return messages.send(bound);
		}
		entered.resolve();
		await Promise.race([
			release.promise,
			new Promise((_, reject) => call.signal.addEventListener("abort", () => reject(call.signal.reason), { once: true })),
		]);
		return { status: "succeeded", output: "Released" };
	};
	runtime = await BotRuntime.open({
		databasePath: join(root, "db"),
		models: model.models,
		tools: { invoke, definitions: [...TOOL_CATALOG, waitTool] },
	});
	messages = new BotMessages({ runtime, targetId: target.targetId, assertAllowed: () => {}, assertContext: async () => {} });
	scheduler = new RunScheduler({ runtime, maxActiveRuns: 1, changed: () => {}, now: Date.now, stopping: () => {} });
	await scheduler.start();
	runtime.resume();
	if (!(await runtime.getBot("a"))) await runtime.createBot({ botId: "a", name: "A", createdAt: 1, model: SCRIPTED_MODEL });
	return model;
}
async function ended(runId: string, state = "completed") {
	await expect.poll(async () => (await runtime.runsStore().get(runId))?.state).toBe(state);
}
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "openbot-messages-"));
});
afterEach(async () => {
	release?.resolve();
	scheduler?.stop();
	await runtime?.close();
	await rm(root, { recursive: true, force: true });
});

it("publishes once, preserves canonical finals and rebuilds bounded history without hidden tool bubbles", async () => {
	const model = await open(
		{ tool: "send_message", args: { text: "Found the evidence." } },
		{ tool: "wait_for_user", args: {} },
		"Exact final answer.",
	);
	const run = await scheduler.submit("a", "r1", "Investigate");
	await entered.promise;
	const call = { ...calls[0]!, signal: new AbortController().signal };
	const receipt = await messages.send(call);
	expect(await messages.send(call)).toEqual(receipt);
	await expect(messages.send({ ...call, args: { text: "Changed" } })).rejects.toThrow("changed");
	const during = await runtime.snapshot("a");
	expect(during.items.filter((i) => i.kind === "assistant")).toMatchObject([{ parts: [{ text: "Found the evidence." }] }]);
	expect(during.items.filter((i) => i.kind === "tool" && i.tool === "send_message")).toEqual([]);
	release.resolve();
	await ended(run.runId);
	const stored = (await runtime.runsStore().get(run.runId))!;
	const exact = await runtime.submissionAnswer("a", stored.inputs[0]!.submissionId!, "direct");
	expect(exact).toBe("Exact final answer.");
	const before = (await runtime.snapshot("a")).items.filter((i) => i.kind === "assistant");
	expect(before).toHaveLength(2);
	await runtime.runsStore().put(stored);
	expect((await runtime.snapshot("a")).items.filter((i) => i.kind === "assistant")).toEqual(before);
	await expect.poll(() => runtime.historyStatus().state, { timeout: 10000 }).toBe("ready");
	const window = await runtime.historyWindow({ conversationKey: "bot:a", position: { kind: "latest" } });
	expect(
		window.status === "ready" &&
			window.window.rows.filter((r) => r.content.kind === "direct" && r.content.item.kind === "assistant").map((r) => r.id),
	).toEqual(before.map((i) => i.id));
	expect(model.requests()).toBe(3);
	scheduler.stop();
	await runtime.close();
	await open();
	expect(await messages.replay(call)).toEqual(receipt);
	expect((await runtime.snapshot("a")).items.filter((i) => i.kind === "assistant")).toEqual(before);
	await runtime.retryHistory();
	await expect.poll(() => runtime.historyStatus().state, { timeout: 10000 }).toBe("ready");
	expect((await runtime.conversationIndex().list()).find((c) => c.conversationKey === "bot:a")?.incomingCount).toBe(2);
});

it("enforces origin, target, child and text boundaries and durable quotas without consuming replay quota", async () => {
	await open({ tool: "send_message", args: { text: "First update" } }, { tool: "wait_for_user", args: {} }, "Final after quota.");
	const run = await scheduler.submit("a", "q", "Work");
	await entered.promise;
	const call = { ...calls[0]!, signal: new AbortController().signal };
	for (const extra of [
		{ runId: "missing" },
		{ botId: "missing" },
		{ conversationId: "999" },
		{ target: { kind: "local" as const, targetId: "elsewhere" } },
		{ appExecutionId: "child" },
		{ args: { text: "  " } },
		{ args: { text: "x", recipient: "elsewhere" } },
		{ args: { text: "中".repeat(6000) } },
	])
		await expect(messages.send({ ...call, ...extra, callId: "invalid" })).rejects.toThrow();
	for (let i = 1; i < 16; i++) await messages.send({ ...call, callId: `extra-${i}`, args: { text: `Update ${i}` } });
	await messages.send(call);
	await expect(messages.send({ ...call, callId: "overflow" })).rejects.toThrow("quota");
	release.resolve();
	await ended(run.runId);
	await expect(messages.send({ ...call, callId: "after-end" })).rejects.toThrow("unavailable");
	expect((await runtime.snapshot("a")).items.filter((i) => i.kind === "assistant")).toHaveLength(17);
	scheduler.stop();
	await runtime.close();
	await open();
	expect(await messages.replay(call)).toMatchObject({ status: "succeeded" });
});

it("retains cancellation with no Pi input across pruning and index rebuild", async () => {
	await open();
	const run = {
		runId: "queued",
		botId: "a",
		state: "queued" as const,
		requestIds: ["q"],
		createdAt: 1,
		messages: [{ requestId: "q", text: "Queued" }],
		inputs: [],
	};
	await runtime.runsStore().put(run);
	await runtime.runsStore().put({ ...run, state: "cancelled", endedAt: 2 });
	await runtime.runsStore().put({ ...run, state: "cancelled", endedAt: 2 });
	for (let i = 0; i < 51; i++) await runtime.runsStore().put({ ...run, runId: `later-${i}`, state: "completed", createdAt: i + 3 });
	expect(await runtime.runsStore().get("queued")).toBeUndefined();
	const items = (await runtime.snapshot("a")).items;
	expect(items).toEqual([expect.objectContaining({ id: "run-outcome:queued", kind: "outcome", category: "queued_cancelled" })]);
	await runtime.retryHistory();
	await expect.poll(() => runtime.historyStatus().state, { timeout: 10000 }).toBe("ready");
	const result = await runtime.historyWindow({ conversationKey: "bot:a", position: { kind: "latest" } });
	expect(result.status === "ready" && result.window.rows.map((r) => r.id)).toEqual(["run-outcome:queued"]);
});

it("counts a shared canonical answer once across consumed steers and preserves it through a new topic", async () => {
	await open({ tool: "wait_for_user", args: {} }, "One answer to both inputs.");
	const first = await scheduler.submit("a", "first", "First input");
	await entered.promise;
	await scheduler.submit("a", "steer", "Consumed steer");
	release.resolve();
	await ended(first.runId);
	const run = (await runtime.runsStore().get(first.runId))!;
	expect(run.inputs).toHaveLength(2);
	const answers = (await runtime.snapshot("a")).items.filter((i) => i.kind === "assistant");
	expect(answers).toHaveLength(1);
	await runtime.reset("a");
	expect((await runtime.snapshot("a")).items.filter((i) => i.kind === "assistant")).toEqual(answers);
	await runtime.retryHistory();
	await expect.poll(() => runtime.historyStatus().state, { timeout: 10000 }).toBe("ready");
	const window = await runtime.historyWindow({ conversationKey: "bot:a", position: { kind: "latest" } });
	expect(window.status === "ready" && window.window.readCursor).toBe(1);
});

it("restores the canonical answer when Pi settled before the Host persisted its outcome", async () => {
	await open("Crash-safe answer.");
	scheduler.stop();
	const run = {
		runId: "crash",
		botId: "a",
		origin: "user" as const,
		state: "queued" as const,
		requestIds: ["crash-input"],
		createdAt: 1,
		messages: [{ requestId: "crash-input", text: "Answer" }],
		inputs: [{ requestId: "crash-input", text: "Answer" }],
	};
	await runtime.runsStore().put(run);
	await runtime.runsStore().put({ ...run, state: "running" });
	const submission = await runtime.submit("a", "crash-input", "Answer", "start");
	await runtime.runsStore().put({ ...run, state: "running", inputs: [{ ...run.inputs[0]!, submissionId: submission.submissionId }] });
	await runtime.waitSubmission("a", submission.submissionId);
	expect((await runtime.snapshot("a")).items.some((i) => i.kind === "assistant")).toBe(false);
	await runtime.close();
	await open();
	await ended("crash");
	expect((await runtime.snapshot("a")).items.filter((i) => i.kind === "assistant")).toMatchObject([
		{ parts: [{ text: "Crash-safe answer." }] },
	]);
});

it("keeps the causal Retry input when a later steer is withdrawn", async () => {
	const pending = Promise.withResolvers<void>();
	await open({ error: "PRIVATE_PROVIDER_DATA", after: pending.promise });
	const first = await scheduler.submit("a", "failed", "Causal input");
	await scheduler.submit("a", "withdrawn", "Withdrawn steer");
	pending.resolve();
	await ended(first.runId, "failed");
	const retry = scheduler.retry("a");
	expect(retry?.text).toBe("Causal input");
	const items = (await runtime.snapshot("a")).items;
	expect(items.filter((i) => i.kind === "outcome")).toEqual([expect.objectContaining({ id: retry!.outcomeId, category: "failed" })]);
	expect(JSON.stringify(items)).not.toContain("PRIVATE_PROVIDER_DATA");
	scheduler.stop();
	await runtime.close();
	await open();
	expect(scheduler.retry("a")?.text).toBe("Causal input");
});

it("coalesces interruption intent and settlement and clears an intent resolved by success", async () => {
	await open();
	const run = {
		runId: "interrupted",
		messageMode: "messages-v1" as const,
		botId: "a",
		origin: "user" as const,
		state: "running" as const,
		requestIds: [],
		createdAt: 1,
		messages: [],
		inputs: [],
	};
	await runtime.runsStore().put(run);
	const intent = { ...run, interruption: { reason: "user" as const, requestedAt: 2 } };
	await runtime.runsStore().put(intent);
	expect((await runtime.snapshot("a")).items).toEqual([expect.objectContaining({ category: "stopping" })]);
	await runtime.runsStore().put({ ...intent, state: "needs_attention", interruption: { ...intent.interruption, settledAt: 3 } });
	expect((await runtime.snapshot("a")).items).toEqual([
		expect.objectContaining({ id: "run-outcome:interrupted", category: "interrupted" }),
	]);
	await runtime.runsStore().put({ ...intent, state: "completed", endedAt: 4 });
	expect((await runtime.snapshot("a")).items).toEqual([]);
	await runtime.retryHistory();
	await expect.poll(() => runtime.historyStatus().state, { timeout: 10000 }).toBe("ready");
	const window = await runtime.historyWindow({ conversationKey: "bot:a", position: { kind: "latest" } });
	expect(window.status === "ready" && window.window.rows).toEqual([]);
});

it("retries a later failed input without hiding an earlier successful answer in that Run", async () => {
	await open("Earlier exact answer", { error: "LATER_FAILURE" });
	scheduler.stop();
	const run = {
		runId: "two-inputs",
		botId: "a",
		state: "queued" as const,
		createdAt: 1,
		requestIds: ["first", "later"],
		messages: [],
		inputs: [],
	};
	await runtime.runsStore().put(run);
	await runtime.runsStore().put({ ...run, state: "running" });
	const first = await runtime.submit("a", "first", "Earlier request", "start");
	await runtime.waitSubmission("a", first.submissionId);
	const answered = { requestId: "first", text: "Earlier request", submissionId: first.submissionId, outcome: { status: "done" as const } };
	await runtime.runsStore().put({ ...run, state: "running", inputs: [answered] });
	const later = await runtime.submit("a", "later", "Later failed request", "start");
	await runtime.waitSubmission("a", later.submissionId);
	await runtime
		.runsStore()
		.put({
			...run,
			state: "failed",
			inputs: [
				answered,
				{
					requestId: "later",
					text: "Later failed request",
					submissionId: later.submissionId,
					outcome: { status: "unanswered", reason: "error" },
				},
			],
		});
	await scheduler.start();
	expect(scheduler.retry("a")).toMatchObject({ text: "Later failed request", outcomeId: `outcome:${later.submissionId}` });
	const items = (await runtime.snapshot("a")).items;
	expect(items.filter((i) => i.kind === "assistant")).toMatchObject([{ parts: [{ text: "Earlier exact answer" }] }]);
	expect(items.filter((i) => i.kind === "outcome")).toMatchObject([{ id: `outcome:${later.submissionId}`, category: "failed" }]);
});
