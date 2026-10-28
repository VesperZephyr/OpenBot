import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
import { Harness, createRegistry } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { HistoryProjection } from "../src/history-projection.ts";
import { seedHistory } from "./history-fixture.ts";
import { scriptedModels } from "../src/testing.ts";

// Worker readiness is setup for correctness checks; performance budgets are asserted in history-scaling e2e.
const expectIndexState = (readState: () => string, state: "ready" | "unavailable") =>
	expect.poll(readState, { timeout: 10000 }).toBe(state);

it("builds bounded public windows and reopens checked source checkpoints", async () => {
	const root = await mkdtemp(join(tmpdir(), "openbot-history-projection-")),
		databasePath = join(root, "openbot.sqlite");
	await seedHistory(databasePath, 1000, 0);
	const harness = await Harness.open(
		await openNodeSqliteStorage(databasePath),
		{ models: scriptedModels().models, registry: createRegistry() },
		BACKGROUND_CONTEXT,
	);
	const options = { path: join(root, "cache", "history.sqlite"), databasePath, channels: async () => [], changed: () => {} };
	let projection = new HistoryProjection(harness, BACKGROUND_CONTEXT, options);
	try {
		const ready = () => expectIndexState(() => projection.status().state, "ready");
		await ready();
		const latest = await projection.window({ conversationKey: "bot:history_0", position: { kind: "latest" } });
		expect(latest.status).toBe("ready");
		if (latest.status !== "ready") throw Error("Not ready");
		expect(latest.window.rows).toHaveLength(100);
		expect(latest.window.readCursor).toBe(1000);
		expect(latest.window.before).toBeDefined();
		const group = await projection.window({
			conversationKey: "group:group_history",
			position: { kind: "around", rowId: "post_5" },
			limit: 10,
		});
		expect(group.status === "ready" && group.window.rows.map((r) => r.id)).toContain("post_5");
		expect((await projection.search("星图", ["bot:history_0", "group:group_history"], "owner")).items).toHaveLength(30);
		await projection.close();
		projection = new HistoryProjection(harness, BACKGROUND_CONTEXT, options);
		await ready();
		const reopened = await projection.window({ conversationKey: "bot:history_0", position: { kind: "latest" } });
		expect(reopened).toEqual(latest);
	} finally {
		await projection.close();
		await harness.close(BACKGROUND_CONTEXT);
		await rm(root, { recursive: true, force: true });
	}
}, 30000);

it("restarts once, keeps execution receipts independent of the worker, and explicitly retries", async () => {
	const { vi } = await import("vitest"),
		{ HistoryClient } = await import("../src/history-client.ts"),
		{ BotRuntime } = await import("../src/index.ts");
	const root = await mkdtemp(join(tmpdir(), "openbot-history-failure-")),
		clients: Awaited<ReturnType<typeof HistoryClient.open>>[] = [];
	const original = HistoryClient.open;
	const opened = vi.spyOn(HistoryClient, "open").mockImplementation(async (...args) => {
		const client = await original(...args);
		clients.push(client);
		return client;
	});
	const model = scriptedModels({ tool: "receipt_probe", args: {} }, "Completed with history unavailable");
	const invoked = vi.fn(async () => ({ status: "succeeded" as const, output: "Committed receipt" }));
	const runtime = await BotRuntime.open({
		databasePath: join(root, "openbot.sqlite"),
		models: model.models,
		tools: {
			invoke: invoked,
			definitions: [
				{
					name: "receipt_probe",
					description: "Synthetic receipt probe",
					parameters: { type: "object", properties: {} },
					capability: "commands",
					destination: "host",
				},
			],
		},
	});
	let stop = () => {};
	try {
		await runtime.createBot({ botId: "probe", name: "Probe", createdAt: 0, model: { provider: "faux", modelId: "faux-1" } });
		const outcomes: unknown[] = [],
			snapshots: unknown[] = [];
		stop = await runtime.observeLive(
			"probe",
			(s) => snapshots.push(s.items),
			(outcome) => outcomes.push(outcome),
		);
		await expectIndexState(() => runtime.historyStatus().state, "ready");
		const first = await runtime.historyWindow({ conversationKey: "bot:probe", position: { kind: "latest" } });
		await clients[0]!.worker.terminate();
		await expect.poll(() => clients.length, { timeout: 10000 }).toBe(2);
		await expectIndexState(() => runtime.historyStatus().state, "ready");
		const rebuilt = await runtime.historyWindow({ conversationKey: "bot:probe", position: { kind: "latest" } });
		expect(first.status === "ready" && rebuilt.status === "ready" && first.window.generation !== rebuilt.window.generation).toBe(true);
		await clients[1]!.worker.terminate();
		await expectIndexState(() => runtime.historyStatus().state, "unavailable");
		await runtime.submitAndWait("probe", "receipt-input", "Run the receipt probe");
		await expect.poll(() => outcomes.length).toBe(1);
		expect(outcomes[0]).toMatchObject({ tool: "receipt_probe", status: "succeeded" });
		expect(invoked).toHaveBeenCalledTimes(1);
		expect(snapshots.every((s) => Array.isArray(s) && s.length === 0)).toBe(true);
		expect(await runtime.historyWindow({ conversationKey: "bot:probe", position: { kind: "latest" } })).toEqual({
			status: "unavailable",
			retryable: true,
		});
		await runtime.retryHistory();
		await expectIndexState(() => runtime.historyStatus().state, "ready");
		const ready = await runtime.historyWindow({ conversationKey: "bot:probe", position: { kind: "latest" } });
		expect(JSON.stringify(ready)).toContain("Committed receipt");
		expect(invoked).toHaveBeenCalledTimes(1);
	} finally {
		stop();
		await runtime.close();
		opened.mockRestore();
		await rm(root, { recursive: true, force: true });
	}
}, 30000);

it("catches up missed commits and invalidates stale cursors without rereading old topics", async () => {
	const root = await mkdtemp(join(tmpdir(), "openbot-history-catchup-")),
		databasePath = join(root, "openbot.sqlite");
	await seedHistory(databasePath, 1000, 0);
	const harness = await Harness.open(
		await openNodeSqliteStorage(databasePath),
		{ models: scriptedModels().models, registry: createRegistry() },
		BACKGROUND_CONTEXT,
	);
	const { BotsDoc } = await import("../src/bots.ts"),
		{ fauxAssistantMessage } = await import("@earendil-works/pi-ai/providers/faux");
	const bot = (await harness.snapshot(BotsDoc, BACKGROUND_CONTEXT))!.bots.history_0!;
	const options = { path: join(root, "history.sqlite"), databasePath, channels: async () => [], changed: () => {} };
	const { vi } = await import("vitest"),
		{ HistoryClient } = await import("../src/history-client.ts");
	const open = HistoryClient.open;
	// A loaded CI runner can take longer than the default one-second poll to start its worker.
	const opened = vi.spyOn(HistoryClient, "open").mockImplementationOnce(async (...args) => {
		await delay(1500);
		return open(...args);
	});
	let projection = new HistoryProjection(harness, BACKGROUND_CONTEXT, options);
	try {
		await expectIndexState(() => projection.status().state, "ready");
		const first = await projection.window({ conversationKey: "bot:history_0", position: { kind: "latest" } });
		if (first.status !== "ready") throw Error();
		await projection.close();
		await harness.commit(async (tx) => {
			await tx.appendEntry(bot.conversationId as import("@earendil-works/pi-durable").ConversationId, {
				kind: "pi.assistant",
				model: [fauxAssistantMessage("OFFLINE_APPEND_SENTINEL")],
			});
		}, BACKGROUND_CONTEXT);
		projection = new HistoryProjection(harness, BACKGROUND_CONTEXT, options);
		await expectIndexState(() => projection.status().state, "ready");
		const current = await projection.window({ conversationKey: "bot:history_0", position: { kind: "latest" } });
		expect(current.status === "ready" && current.window.generation).toBe(first.window.generation);
		expect(JSON.stringify(current)).toContain("OFFLINE_APPEND_SENTINEL");
		await expect(
			projection.window({ conversationKey: "bot:history_0", position: { kind: "cursor", cursor: first.window.before! } }),
		).rejects.toThrow("History changed");
	} finally {
		await projection.close();
		opened.mockRestore();
		await harness.close(BACKGROUND_CONTEXT);
		await rm(root, { recursive: true, force: true });
	}
}, 30000);

it("fails visibly on an unwritable cache location and recovers after explicit Retry", async () => {
	const { mkdir } = await import("node:fs/promises");
	const root = await mkdtemp(join(tmpdir(), "openbot-history-path-")),
		databasePath = join(root, "openbot.sqlite"),
		path = join(root, "cache.sqlite");
	await seedHistory(databasePath, 2, 0);
	await mkdir(path);
	const harness = await Harness.open(
		await openNodeSqliteStorage(databasePath),
		{ models: scriptedModels().models, registry: createRegistry() },
		BACKGROUND_CONTEXT,
	);
	const projection = new HistoryProjection(harness, BACKGROUND_CONTEXT, {
		path,
		databasePath,
		channels: async () => [],
		changed: () => {},
	});
	try {
		await expectIndexState(() => projection.status().state, "unavailable");
		expect(await projection.window({ conversationKey: "bot:history_0", position: { kind: "latest" } })).toEqual({
			status: "unavailable",
			retryable: true,
		});
		await rm(path, { recursive: true });
		await projection.retry();
		await expectIndexState(() => projection.status().state, "ready");
		const result = await projection.window({ conversationKey: "bot:history_0", position: { kind: "latest" } });
		expect(result.status === "ready" && result.window.rows.length).toBe(2);
	} finally {
		await projection.close();
		await harness.close(BACKGROUND_CONTEXT);
		await rm(root, { recursive: true, force: true });
	}
}, 30000);

it("matches legacy rows across compaction, reset and a tool result separated by several source batches", async () => {
	const { BotRuntime } = await import("../src/index.ts"),
		{ BotsDoc } = await import("../src/bots.ts");
	const { fauxAssistantMessage, fauxToolCall } = await import("@earendil-works/pi-ai/providers/faux");
	const root = await mkdtemp(join(tmpdir(), "openbot-history-fidelity-")),
		databasePath = join(root, "openbot.sqlite");
	await seedHistory(databasePath, 20, 0);
	const harness = await Harness.open(
		await openNodeSqliteStorage(databasePath),
		{ models: scriptedModels().models, registry: createRegistry() },
		BACKGROUND_CONTEXT,
	);
	const id = (await harness.snapshot(BotsDoc, BACKGROUND_CONTEXT))!.bots.history_0!
		.conversationId as import("@earendil-works/pi-durable").ConversationId;
	await harness.commit(async (tx) => {
		await tx.appendEntry(id, {
			kind: "pi.assistant",
			model: [
				fauxAssistantMessage({ ...fauxToolCall("read_file", { path: "fixture.txt" }), id: "distant-call" }, { stopReason: "toolUse" }),
			],
		});
		let head: import("@earendil-works/pi-durable").EntryId | undefined;
		for (let i = 0; i < 700; i++) {
			const e = await tx.appendEntry(id, { kind: "pi.assistant", model: [fauxAssistantMessage(`intervening ${i}`)] });
			if (i === 500) head = e.id;
		}
		await tx.appendEntry(id, {
			kind: "pi.compaction",
			head: head!,
			model: [{ role: "user", content: "Synthetic compaction summary", timestamp: 1 }],
		});
		await tx.appendEntry(id, { kind: "pi.reset", head: "self" });
		await tx.appendEntry(id, {
			kind: "pi.tool-result",
			model: [
				{
					role: "toolResult",
					toolCallId: "distant-call",
					toolName: "read_file",
					content: [{ type: "text", text: "Final durable evidence" }],
					isError: false,
					timestamp: 2,
				},
			],
		});
	}, BACKGROUND_CONTEXT);
	await harness.close(BACKGROUND_CONTEXT);
	const runtime = await BotRuntime.open({ databasePath, models: scriptedModels().models });
	try {
		await expectIndexState(() => runtime.historyStatus().state, "ready");
		const legacy = await runtime.snapshot("history_0");
		let position: import("@openbot/protocol").TimelinePosition = { kind: "latest" };
		const rows: import("@openbot/protocol").TranscriptItem[] = [];
		for (;;) {
			const result = await runtime.historyWindow({ conversationKey: "bot:history_0", position });
			if (result.status !== "ready") throw Error("History is not ready");
			rows.unshift(...result.window.rows.flatMap((r) => (r.content.kind === "direct" ? [r.content.item] : [])));
			if (!result.window.before) break;
			position = { kind: "cursor", cursor: result.window.before };
		}
		expect(rows).toEqual(legacy.items);
		expect(rows.find((r) => r.id === "distant-call")).toMatchObject({ status: "succeeded", output: "Final durable evidence" });
	} finally {
		await runtime.close();
		await rm(root, { recursive: true, force: true });
	}
}, 30000);

it("coalesces commit overflow into catch-up and bounds waiting search admission", async () => {
	const root = await mkdtemp(join(tmpdir(), "openbot-history-overflow-")),
		databasePath = join(root, "openbot.sqlite");
	await seedHistory(databasePath, 1000, 0);
	const harness = await Harness.open(
		await openNodeSqliteStorage(databasePath),
		{ models: scriptedModels().models, registry: createRegistry() },
		BACKGROUND_CONTEXT,
	);
	const subscribe = harness.subscribeCommits.bind(harness);
	let notify: Parameters<typeof harness.subscribeCommits>[0] | undefined;
	harness.subscribeCommits = (listener) => {
		notify = listener;
		return subscribe(listener);
	};
	const projection = new HistoryProjection(harness, BACKGROUND_CONTEXT, {
		path: join(root, "history.sqlite"),
		databasePath,
		channels: async () => [],
		changed: () => {},
	});
	try {
		const cancelled = new AbortController();
		const waiting = Array.from({ length: 4 }, () =>
			projection.search("needle", ["bot:history_0"], "owner", undefined, cancelled.signal).catch((e) => e),
		);
		await expect(projection.search("needle", ["bot:history_0"], "owner")).rejects.toThrow("busy");
		cancelled.abort();
		expect((await Promise.all(waiting)).every((e) => e instanceof Error)).toBe(true);
		await expectIndexState(() => projection.status().state, "ready");
		for (let i = 0; i < 300; i++)
			notify!({ changes: [{ type: "entry", value: { conversationId: 10000 + i } }] } as any, BACKGROUND_CONTEXT);
		const { BotsDoc } = await import("../src/bots.ts"),
			{ fauxAssistantMessage } = await import("@earendil-works/pi-ai/providers/faux");
		const id = (await harness.snapshot(BotsDoc, BACKGROUND_CONTEXT))!.bots.history_0!
			.conversationId as import("@earendil-works/pi-durable").ConversationId;
		await harness.commit(
			(tx) => tx.appendEntry(id, { kind: "pi.assistant", model: [fauxAssistantMessage("OVERFLOW_COMMIT_SENTINEL")] }),
			BACKGROUND_CONTEXT,
		);
		const results = await projection.search("OVERFLOW_COMMIT_SENTINEL", ["bot:history_0"], "owner");
		expect(results.items).toHaveLength(1);
		expect(projection.status().state).toBe("ready");
	} finally {
		await projection.close();
		await harness.close(BACKGROUND_CONTEXT);
		await rm(root, { recursive: true, force: true });
	}
}, 30000);

it("does not reread settled Code Mode source entries for a later ordinary message", async () => {
	const { BotsDoc } = await import("../src/bots.ts"),
		{ AppExecutionsDoc } = await import("../src/app-executions.ts");
	const { APP_CODE_LIMITS, APP_CODE_VERSION } = await import("@openbot/protocol");
	const { fauxAssistantMessage, fauxToolCall } = await import("@earendil-works/pi-ai/providers/faux");
	const root = await mkdtemp(join(tmpdir(), "openbot-history-code-count-")),
		databasePath = join(root, "openbot.sqlite");
	await seedHistory(databasePath, 20, 0);
	const harness = await Harness.open(
		await openNodeSqliteStorage(databasePath),
		{ models: scriptedModels().models, registry: createRegistry() },
		BACKGROUND_CONTEXT,
	);
	const id = (await harness.snapshot(BotsDoc, BACKGROUND_CONTEXT))!.bots.history_0!
		.conversationId as import("@earendil-works/pi-durable").ConversationId;
	let callId = 0;
	await harness.commit(async (tx) => {
		callId = (
			await tx.appendEntry(id, {
				kind: "pi.assistant",
				model: [
					fauxAssistantMessage({ ...fauxToolCall("codemode", { code: "text('done')" }), id: "settled-code" }, { stopReason: "toolUse" }),
				],
			})
		).id;
		await tx.appendEntry(id, {
			kind: "pi.tool-result",
			model: [
				{
					role: "toolResult",
					toolCallId: "settled-code",
					toolName: "codemode",
					content: [{ type: "text", text: "done" }],
					isError: false,
					timestamp: 1,
				},
			],
		});
		(await tx.doc(AppExecutionsDoc)).executions.code = {
			executionId: "code",
			parentCallId: "settled-code",
			botId: "history_0",
			conversationId: String(id),
			authority: { runId: "fixture", channelId: "direct", origin: "user", rootRequestId: "fixture" },
			targetId: "local",
			version: APP_CODE_VERSION,
			catalogDigest: "fixture",
			sourceDigest: "fixture",
			limits: { ...APP_CODE_LIMITS },
			admittedAt: 0,
			deadline: 100,
			state: "succeeded",
			children: [],
			endedAt: 1,
		};
	}, BACKGROUND_CONTEXT);
	const reads: number[] = [],
		original = harness.conversation.bind(harness);
	harness.conversation = async (...args) => {
		const c = await original(...args);
		if (!c) return c;
		return new Proxy(c, {
			get(target, key) {
				const member = Reflect.get(target, key);
				if (key === "entries")
					return (...params: any[]) => {
						reads.push(params[0]?.minEntryId ?? 0);
						return member.apply(target, params);
					};
				return typeof member === "function" ? member.bind(target) : member;
			},
		});
	};
	const projection = new HistoryProjection(harness, BACKGROUND_CONTEXT, {
		path: join(root, "history.sqlite"),
		databasePath,
		channels: async () => [],
		changed: () => {},
	});
	try {
		await expectIndexState(() => projection.status().state, "ready");
		reads.length = 0;
		await harness.commit(
			(tx) => tx.appendEntry(id, { kind: "pi.assistant", model: [fauxAssistantMessage("AFTER_SETTLED_CODE")] }),
			BACKGROUND_CONTEXT,
		);
		expect((await projection.search("AFTER_SETTLED_CODE", ["bot:history_0"], "owner")).items).toHaveLength(1);
		expect(reads).not.toContain(callId);
		expect(reads.length).toBeLessThanOrEqual(2);
	} finally {
		await projection.close();
		await harness.close(BACKGROUND_CONTEXT);
		await rm(root, { recursive: true, force: true });
	}
}, 30000);
