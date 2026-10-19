import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BotRuntime, type StoredRun } from "@openbot/agent-runtime";
import { SCRIPTED_MODEL, scriptedModels } from "@openbot/agent-runtime/testing";
import type { BackgroundTaskReceipt } from "@openbot/protocol";
import { BackgroundTasks } from "../src/background.ts";
import type { ManagementCall } from "../src/bot-management.ts";
import type { RunScheduler } from "../src/runs.ts";
let root: string, runtime: BotRuntime, service: BackgroundTasks, source: StoredRun, receipt: BackgroundTaskReceipt;
let submit: ReturnType<typeof vi.fn>,
	stop: ReturnType<typeof vi.fn<(id: string) => Promise<void>>>,
	call: ManagementCall,
	loseAdmission = false;
async function open() {
	runtime = await BotRuntime.open({ databasePath: join(root, "host.sqlite"), models: scriptedModels().models });
}
function createService() {
	service = new BackgroundTasks({
		runtime,
		runs: {
			submit,
			cancel: async (id: string) => {
				const run = await runtime.runsStore().get(id);
				if (run) await runtime.runsStore().put({ ...run, state: "cancelled" });
			},
		} as unknown as RunScheduler,
		targetId: "local",
		canRun: () => true,
		groupAdmissible: async () => true,
		changed: () => {},
		port: {
			inspect: async () => [receipt],
			result: async () => ({ status: "succeeded", taskId: "task_one", output: "Started" }),
			stop,
		},
	});
}
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "openbot-completion-"));
	await open();
	await runtime.createBot({ botId: "bot", name: "Analyst", model: SCRIPTED_MODEL, createdAt: 1 });
	const conversationId = await runtime.conversationKey("bot");
	source = {
		runId: "source",
		botId: "bot",
		origin: "user",
		state: "running",
		createdAt: 1,
		requestIds: ["request"],
		messages: [{ requestId: "request", text: "Run a job" }],
		inputs: [],
	};
	await runtime.runsStore().put(source);
	receipt = {
		taskId: "task_one",
		invocationId: `${conversationId}:call`,
		conversationId,
		botId: "bot",
		runId: "source",
		status: "succeeded",
		output: "FINAL 13",
		consumed: false,
		exit: { code: 0, signal: null },
		finishedAt: 2,
	};
	call = {
		botId: "bot",
		runId: "source",
		conversationId,
		callId: "call",
		tool: "local_exec",
		args: { command: "job" },
		target: { kind: "local", targetId: "local" },
		signal: new AbortController().signal,
	};
	loseAdmission = false;
	submit = vi.fn(async (botId: string, requestId: string, text: string, options: any) => {
		let run = (await runtime.runsStore().list()).find((r) => r.requestIds.includes(requestId));
		if (!run) {
			run = {
				runId: "continuation",
				botId,
				origin: options.origin,
				state: "queued",
				createdAt: 3,
				requestIds: [requestId],
				messages: [{ requestId, text }],
				inputs: [],
			};
			await runtime.runsStore().put(run);
		}
		if (loseAdmission) {
			loseAdmission = false;
			throw Error("Lost admission response");
		}
		return { runId: run.runId, state: run.state, steered: false };
	});
	stop = vi.fn(async () => {});
	createService();
});
afterEach(async () => {
	await service.close();
	await runtime.close();
	await rm(root, { recursive: true, force: true });
});
async function subscribe() {
	expect(await service.prepare(call, "digest")).toBe(true);
	await service.settle(call, { status: "succeeded", output: "Started", taskId: receipt.taskId });
}
async function completed() {
	source = { ...source, state: "completed", endedAt: 2 };
	await runtime.runsStore().put(source);
}
it("waits for the source turn then delivers one separate unattended Run across duplicate receipts and restart", async () => {
	await subscribe();
	await service.sweep();
	expect(submit).not.toHaveBeenCalled();
	await completed();
	await service.sweep();
	expect(submit).toHaveBeenCalledTimes(1);
	expect(submit.mock.calls[0]![3]).toEqual({ origin: "background", separate: true });
	expect(submit.mock.calls[0]![2]).toContain("untrusted command output");
	await service.close();
	await runtime.close();
	await open();
	createService();
	await service.sweep();
	expect(submit).toHaveBeenCalledTimes(1);
	const run = await runtime.runsStore().get("continuation");
	await runtime.runsStore().put({ ...run!, state: "completed" });
	await service.sweep();
	expect((await runtime.background().get(receipt.invocationId))?.state).toBe("delivered");
	for (let i = 0; i < 60; i++)
		await runtime
			.runsStore()
			.put({ ...source, state: "completed", endedAt: 100 + i, createdAt: 100 + i, runId: `later${i}`, requestIds: [`later${i}`] });
	expect(await runtime.runsStore().get("source")).toBeUndefined();
	expect((await service.settle(call, { status: "succeeded", output: "Started", taskId: receipt.taskId })).status).toBe("succeeded");
	expect((await runtime.background().get(receipt.invocationId))?.state).toBe("delivered");
});
it("reconciles a crash after admission with the same logical request", async () => {
	await subscribe();
	await completed();
	loseAdmission = true;
	await expect(service.sweep()).rejects.toThrow("Lost admission");
	await service.sweep();
	expect(submit.mock.calls[0]![1]).toBe(submit.mock.calls[1]![1]);
	expect((await runtime.runsStore().list()).filter((r) => r.origin === "background")).toHaveLength(1);
});
it("persists Stop before cancellation and rejects a late success without resurrecting the task", async () => {
	await subscribe();
	await service.stop(receipt.invocationId);
	expect(stop).toHaveBeenCalledWith(receipt.invocationId);
	await completed();
	await service.sweep();
	expect(submit).not.toHaveBeenCalled();
	expect((await runtime.background().get(receipt.invocationId))?.state).toBe("suppressed");
});
it("suppresses already consumed output and preserves unknown command outcomes for attention", async () => {
	await subscribe();
	await completed();
	receipt = { ...receipt, consumed: true };
	await service.sweep();
	expect(submit).not.toHaveBeenCalled();
	expect((await runtime.background().get(receipt.invocationId))?.reason).toBe("Final output already read");
});
it("never turns uncertain receipts or failed sources into new work", async () => {
	await subscribe();
	await completed();
	receipt = { ...receipt, status: "unknown" };
	await service.sweep();
	expect(submit).not.toHaveBeenCalled();
	expect((await runtime.background().get(receipt.invocationId))?.state).toBe("attention");
	for (const [index, state] of (["failed", "needs_attention", "completed"] as const).entries()) {
		await runtime.runsStore().put({ ...source, state: "running" });
		call = { ...call, callId: `failure${index}` };
		receipt = { ...receipt, invocationId: `${call.conversationId}:${call.callId}`, taskId: `task_failure${index}`, status: "succeeded" };
		await subscribe();
		await runtime
			.runsStore()
			.put({
				...source,
				state,
				...(state === "completed" ? { interruption: { reason: "user" as const, requestedAt: 1, settledAt: 2 } } : {}),
			});
		await service.sweep();
		expect((await runtime.background().get(receipt.invocationId))?.state).toBe("suppressed");
	}
	expect(submit).not.toHaveBeenCalled();
});
it("rejects origin changes, conflicting identities and recursive background subscriptions", async () => {
	await subscribe();
	await expect(service.prepare(call, "changed")).rejects.toThrow("identity");
	await runtime.runsStore().put({ ...source, origin: "background" });
	expect(await service.prepare({ ...call, callId: "next" }, "other")).toBe(false);
	await completed();
	await runtime.runsStore().put({ ...source, state: "cancelled" });
	await service.sweep();
	expect(submit).not.toHaveBeenCalled();
});
it("pins a source Run until completion and enforces per-Run pending capacity", async () => {
	await subscribe();
	await completed();
	for (let i = 0; i < 60; i++)
		await runtime.runsStore().put({ ...source, runId: `other${i}`, createdAt: i + 10, requestIds: [`other${i}`] });
	expect(await runtime.runsStore().get("source")).toBeDefined();
	const record = (await runtime.background().get(receipt.invocationId))!;
	for (let i = 0; i < 7; i++) await runtime.background().reserve({ ...record, invocationId: `extra${i}`, state: "reserved" });
	await expect(runtime.background().reserve({ ...record, invocationId: "over" })).rejects.toThrow("capacity");
});

it("coalesces concurrent polling and never resurrects missing or mismatched receipts", async () => {
	await subscribe();
	await completed();
	const gate = Promise.withResolvers<readonly BackgroundTaskReceipt[]>();
	let queries = 0;
	service.options.port!.inspect = async () => {
		queries++;
		return gate.promise;
	};
	const pending = service.sweep();
	await vi.waitFor(() => expect(queries).toBe(1));
	expect(service.sweep()).toBe(pending);
	expect(service.sweep()).toBe(pending);
	gate.resolve([{ ...receipt, botId: "forged" }]);
	await pending;
	expect(submit).not.toHaveBeenCalled();
	expect((await runtime.background().get(receipt.invocationId))?.state).toBe("attention");
	service.options.port!.inspect = async () => [receipt];
	await service.sweep();
	expect(submit).not.toHaveBeenCalled();
});
it("cancels an acknowledged queued continuation when its Bot is deleted", async () => {
	await subscribe();
	await completed();
	await service.sweep();
	expect((await runtime.background().get(receipt.invocationId))?.acknowledged).toBe(true);
	await runtime.updateBot("bot", { status: "deleted" });
	await service.sweep();
	expect((await runtime.runsStore().get("continuation"))?.state).toBe("cancelled");
	expect((await runtime.background().get(receipt.invocationId))?.state).toBe("suppressed");
});
it("suppresses a copied receipt before admission on context reset or Stop", async () => {
	await subscribe();
	await service.sweep();
	expect((await runtime.background().get(receipt.invocationId))?.state).toBe("ready");
	await service.stopConversation("bot", call.conversationId);
	await completed();
	await service.sweep();
	expect(submit).not.toHaveBeenCalled();
	await expect(service.prepare({ ...call, callId: "wrong", target: { kind: "local", targetId: "other" } }, "digest")).rejects.toThrow(
		"target",
	);
});
it("records metadata transitions without command output", async () => {
	const audit = vi.fn();
	service.options.audit = audit;
	await subscribe();
	await completed();
	await service.sweep();
	expect(audit).toHaveBeenCalled();
	expect(JSON.stringify(audit.mock.calls)).not.toContain("FINAL 13");
	expect(audit.mock.calls.some(([event]) => event.state === "queued")).toBe(true);
});

it("keeps an old pending command visible when newer completed history fills the snapshot", async () => {
	await subscribe();
	receipt = { ...receipt, status: "running" };
	const record = (await runtime.background().get(receipt.invocationId))!;
	for (let i = 0; i < 70; i++)
		await runtime.background().reserve({ ...record, invocationId: `history${i}`, taskId: `task_history${i}`, state: "delivered" });
	await service.sweep();
	const visible = service.view("bot", call.conversationId);
	expect(visible).toHaveLength(64);
	expect(visible[0]?.invocationId).toBe(receipt.invocationId);
	expect(visible.at(-1)?.invocationId).toBe("history69");
});
