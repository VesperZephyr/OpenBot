import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { BotRuntime } from "@openbot/agent-runtime";
import { scriptedModels, SCRIPTED_MODEL } from "@openbot/agent-runtime/testing";
import { TOOL_CATALOG, PROTOCOL_VERSION, type ExecutionObservation, type ToolOutcome } from "@openbot/protocol";
import { ApprovalBook, HostService, MemorySecretStore } from "@openbot/server-core";
import { ToolRouter, type ToolCall } from "@openbot/tool-router";

let runtime: BotRuntime, service: HostService, root: string;
afterEach(async () => {
	await service?.stop();
	await runtime?.close();
	if (root) await rm(root, { recursive: true, force: true });
});
const untilAbort = (signal: AbortSignal) => new Promise<never>((_, reject) => {
	signal.addEventListener("abort", () => reject(signal.reason), { once: true });
	if (signal.aborted) reject(signal.reason);
});

async function setup(...turns: Parameters<typeof scriptedModels>) {
	root = await mkdtemp(join(tmpdir(), "openbot-execution-identity-"));
	const model = scriptedModels(...turns);
	const book = new ApprovalBook(() => {});
	const calls: ToolCall[] = [];
	const events: ExecutionObservation[] = [];
	const dispatches: { call: ToolCall; phase: string; observation: ExecutionObservation | undefined }[] = [];
	let execute: (call: ToolCall) => Promise<ToolOutcome> = async () => ({ status: "succeeded", output: "Ready" });
	let afterPublish: (call: ToolCall) => Promise<void> = async () => {};
	const router = new ToolRouter({
		target: { kind: "local", targetId: "mac" },
		observeExecution: (call, phase) => {
			service.observeExecution(call, phase);
			dispatches.push({ call, phase, observation: runtime.execution.current.get(call.runId!) });
		},
		policy: {
			decide: async (c, d) => d.capability === "app.read" || c.tool === "codemode"
				? service.capabilities.authorize(c) : { kind: "allow" },
			grants: async () => ({ read: [], readwrite: [] }),
		},
		approvals: book,
		executor: { invoke: invocation => execute(calls.find(c => `${c.conversationId}:${c.callId}` === invocation.invocationId)!) },
		hostReceipt: call => call.tool === "send_message" ? service.messages.replay(call) : Promise.resolve(undefined),
		hostTools: {
			send_message: async (_args, _signal, call) => {
				await execute(call);
				const result = await service.messages.send(call);
				await afterPublish(call);
				return result;
			},
			...Object.fromEntries(TOOL_CATALOG.filter(d => d.capability === "app.read").map(d => [d.name,
				async (_args: unknown, _signal: unknown, call: ToolCall) => {
					await execute(call);
					return service.capabilities.invokeTool(call);
				}])),
		},
	});
	runtime = await BotRuntime.open({ databasePath: join(root, "db"), models: model.models,
		tools: { definitions: TOOL_CATALOG, admitOrchestration: c => router.admitOrchestration(c), invoke: c => {
			calls.push(c);
			return router.invoke(c);
		} } });
	runtime.execution.changes.add(() => {
		for (const value of runtime.execution.current.values()) events.push(value);
	});
	service = new HostService({ runtime, approvals: book, secrets: new MemorySecretStore(),
		status: { protocolVersion: PROTOCOL_VERSION, hostVersion: "test", nodeVersion: "test", targetId: "mac", startedAt: 0 },
		dataDirectory: root, workspace: root, emit: () => {},
		modelConfig: { path: join(root, "models.json"), read: async () => undefined, write: async () => {},
			environment: { env: () => undefined, run: async () => "" } } });
	await service.start();
	await runtime.setDefaultModel(SCRIPTED_MODEL);
	const botId = (await runtime.ensureCoreBot(1)).botId;
	return { botId, model, calls, events, dispatches,
		setExecute: (fn: typeof execute) => { execute = fn; },
		afterPublish: (fn: typeof afterPublish) => { afterPublish = fn; },
		send: (requestId: string) => service.handle("messages.submit", { botId, requestId, text: requestId }),
	};
}
async function ended(runId: string, state = "completed") {
	await expect.poll(async () => (await runtime.runsStore().get(runId))?.state).toBe(state);
	await expect.poll(() => runtime.execution.current.has(runId)).toBe(false);
}

it("maps actual Pi requests, polling invocations, progress and accepted versus consumed steers through Router", async () => {
	const h = await setup(
		{ tool: "task_output", args: { taskId: "background-1" } },
		{ tool: "task_output", args: { taskId: "background-1" } },
		{ tool: "task_output", args: { taskId: "background-1" } },
		{ tool: "task_output", args: { taskId: "background-2" } },
		"Exact final answer",
	);
	const gates = Array.from({ length: 4 }, () => Promise.withResolvers<void>());
	let count = 0;
	h.setExecute(async call => {
		const index = count++;
		await Promise.race([gates[index]!.promise, untilAbort(call.signal)]);
		return { status: "succeeded", output: "Still running", taskId: String(call.args.taskId) };
	});
	const run = await h.send("initial-input");
	await expect.poll(() => count).toBe(1);
	const first = runtime.execution.current.get(run.runId)!;
	const initial = (await runtime.runsStore().get(run.runId))!.inputs[0]!.submissionId;
	expect(initial).toBeDefined();
	expect(first).toMatchObject({ phase: "dispatching", family: "waiting_result", taskId: "background-1", consumedInputId: initial });
	h.calls[0]!.onProgress("First output chunk");
	h.calls[0]!.onProgress("Second output chunk");
	expect(runtime.execution.current.get(run.runId)).toEqual(first);
	gates[0]!.resolve();
	await expect.poll(() => count).toBe(2);
	const second = runtime.execution.current.get(run.runId)!;
	expect(second).toMatchObject({ phase: "dispatching", taskId: "background-1", consumedInputId: initial });
	expect(second.executionKey).not.toBe(first.executionKey);
	expect(h.calls[1]!.callId).not.toBe(h.calls[0]!.callId);
	const between = h.events.slice(h.events.indexOf(first) + 1, h.events.indexOf(second));
	expect(between.some(e => e.phase === "generating" && e.consumedInputId === initial && e.executionKey !== second.executionKey)).toBe(true);
	await h.send("accepted-steer");
	await expect.poll(async () => (await runtime.runsStore().get(run.runId))!.inputs[1]?.submissionId).toBeDefined();
	const steer = (await runtime.runsStore().get(run.runId))!.inputs[1]!.submissionId;
	expect(runtime.execution.current.get(run.runId)).toEqual(second);
	expect(h.events.some(e => e.consumedInputId === steer)).toBe(false);
	gates[1]!.resolve();
	await expect.poll(() => count).toBe(3);
	const third = runtime.execution.current.get(run.runId)!;
	expect(third).toMatchObject({ taskId: "background-1", consumedInputId: steer });
	expect(third.executionKey).not.toBe(second.executionKey);
	gates[2]!.resolve();
	await expect.poll(() => count).toBe(4);
	const fourth = runtime.execution.current.get(run.runId)!;
	expect(fourth).toMatchObject({ taskId: "background-2", consumedInputId: steer });
	expect(fourth.executionKey).not.toBe(third.executionKey);
	gates[3]!.resolve();
	await ended(run.runId);
	expect(h.model.requests()).toBe(5);
	for (const call of h.calls) {
		const phases = h.dispatches.filter(e => e.call.callId === call.callId);
		expect(phases.map(e => e.phase)).toEqual(["preparing", "dispatching", "settled"]);
		expect(new Set(phases.map(e => e.observation?.executionKey)).size).toBe(3);
	}
	const generations = h.events.filter(e => e.phase === "generating");
	expect(generations).toHaveLength(5);
	expect(new Set(generations.map(e => e.executionKey)).size).toBe(5);
}, 15000);

it("retains an unpublished send_message failure as tool evidence", async () => {
	const h = await setup({ tool: "send_message", args: { text: " " } }, "Final after rejection");
	const run = await h.send("invalid-update");
	await ended(run.runId);
	const items = (await runtime.snapshot(h.botId)).items;
	expect(items.filter(i => i.kind === "tool" && i.tool === "send_message")).toMatchObject([{ status: "failed" }]);
	expect(items.filter(i => i.kind === "assistant")).toMatchObject([{ parts: [{ text: "Final after rejection" }] }]);
});

it("distinguishes actual sequential Code Mode children and clears cancelled execution identity", async () => {
	const h = await setup({ tool: "codemode", args: { code: "await tools.app_bots_list({}); await tools.app_bots_list({}); text('done');" } });
	const gates = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
	let count = 0;
	h.setExecute(async call => {
		await Promise.race([gates[count++]!.promise, untilAbort(call.signal)]);
		return { status: "succeeded", output: "Ready" };
	});
	const run = await h.send("inspect-roster");
	await expect.poll(() => count).toBe(1);
	const first = runtime.execution.current.get(run.runId)!;
	expect(first).toMatchObject({ phase: "dispatching", family: "working_application" });
	expect(h.calls[0]).toMatchObject({ runId: run.runId, appExecutionId: expect.any(String) });
	gates[0]!.resolve();
	await expect.poll(() => count).toBe(2);
	const second = runtime.execution.current.get(run.runId)!;
	expect(h.calls[1]!.appExecutionId).toBe(h.calls[0]!.appExecutionId);
	expect(h.calls[1]!.callId).not.toBe(h.calls[0]!.callId);
	expect(second.executionKey).not.toBe(first.executionKey);
	expect(second.consumedInputId).toBe(first.consumedInputId);
	await service.handle("runs.cancel", { runId: run.runId });
	await ended(run.runId, "cancelled");
	expect(h.model.requests()).toBe(1);
	expect(h.dispatches.at(-1)?.phase).toBe("settled");
}, 15000);

it("keeps one committed message when cancellation wins before Pi records its tool result, including rebuild and reopen", async () => {
	const h = await setup({ tool: "send_message", args: { text: "Committed before cancellation" } });
	const admitted = Promise.withResolvers<void>(), allowPublication = Promise.withResolvers<void>();
	h.setExecute(async call => {
		admitted.resolve();
		await Promise.race([allowPublication.promise, untilAbort(call.signal)]);
		return { status: "succeeded", output: "Ready" };
	});
	const published = Promise.withResolvers<void>();
	h.afterPublish(async call => { published.resolve(); await untilAbort(call.signal); });
	const run = await h.send("publish-update");
	await admitted.promise;
	await expect.poll(async () => {
		const window = await runtime.historyWindow({ conversationKey: `bot:${h.botId}`, position: { kind: "latest" } });
		return window.status === "ready" && window.window.rows.some(r => r.content.kind === "direct" && r.content.item.kind === "tool" && r.content.item.tool === "send_message");
	}, { timeout: 10000 }).toBe(true);
	allowPublication.resolve();
	await published.promise;
	const assertVisible = async () => {
		const items = (await runtime.snapshot(h.botId)).items;
		expect(items.filter(i => i.kind === "assistant")).toMatchObject([{ parts: [{ text: "Committed before cancellation" }] }]);
		expect(items.filter(i => i.kind === "tool" && i.tool === "send_message")).toEqual([]);
		await expect.poll(() => runtime.historyStatus().state, { timeout: 10000 }).toBe("ready");
		const window = await runtime.historyWindow({ conversationKey: `bot:${h.botId}`, position: { kind: "latest" } });
		expect(window.status === "ready" && window.window.rows.some(r => r.content.kind === "direct" && r.content.item.kind === "tool" && r.content.item.tool === "send_message")).toBe(false);
	};
	await assertVisible();
	await service.handle("runs.cancel", { runId: run.runId });
	await ended(run.runId, "cancelled");
	await assertVisible();
	await runtime.retryHistory();
	await assertVisible();
	await service.stop();
	await runtime.close();
	runtime = await BotRuntime.open({ databasePath: join(root, "db"), models: h.model.models });
	await assertVisible();
}, 15000);
