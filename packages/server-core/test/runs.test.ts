import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BotRuntime, type ToolInvoker } from "@openbot/agent-runtime";
import { SCRIPTED_MODEL, type ScriptedModels, scriptedModels } from "@openbot/agent-runtime/testing";
import type { BotId, RunRecord, ToolDefinition } from "@openbot/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunScheduler } from "../src/runs.ts";

const waitTool: ToolDefinition = {
	name: "wait_for_user",
	description: "Waits until the test releases it.",
	parameters: { type: "object", properties: {}, additionalProperties: false },
	capability: "commands",
	destination: "host",
};
const WAIT = { tool: "wait_for_user", args: {} } as const;

/** A tool call per Bot that waits until the test releases it, or until its Run is aborted. */
class Gates {
	readonly #open = new Map<BotId, PromiseWithResolvers<void>>();
	readonly #entered = new Map<BotId, PromiseWithResolvers<void>>();

	readonly invoke: ToolInvoker = async ({ botId, signal }) => {
		this.#of(this.#entered, botId).resolve();
		const gate = this.#of(this.#open, botId);
		const aborted = Promise.withResolvers<never>();
		signal.addEventListener("abort", () => aborted.reject(signal.reason), { once: true });
		await Promise.race([gate.promise, aborted.promise]);
		return { status: "succeeded", output: "released" };
	};

	entered(botId: BotId): Promise<void> {
		return this.#of(this.#entered, botId).promise;
	}

	release(botId: BotId): void {
		this.#of(this.#open, botId).resolve();
	}

	#of(map: Map<BotId, PromiseWithResolvers<void>>, botId: BotId): PromiseWithResolvers<void> {
		let entry = map.get(botId);
		if (entry === undefined) {
			entry = Promise.withResolvers<void>();
			map.set(botId, entry);
		}
		return entry;
	}
}

describe("RunScheduler", () => {
	let directory: string;
	let databasePath: string;
	let runtime: BotRuntime;
	let scripted: ScriptedModels;
	let gates: Gates;
	let scheduler: RunScheduler;
	let clock: number;
	let admitted = true;
	/** Bots whose running Run was stopped, as reported to the `stopping` hook. */
	let stopped: BotId[];
	/** Resolves when the Run reaches the state; checked after every change the scheduler reports. */
	let reaches: (botId: BotId, runId: string, state: RunRecord["state"]) => Promise<void>;
	let changed: () => void;

	async function open(...turns: Parameters<typeof scriptedModels>): Promise<void> {
		scripted = scriptedModels(...turns);
		gates = new Gates();
		runtime = await BotRuntime.open({
			databasePath,
			models: scripted.models,
			tools: { invoke: gates.invoke, definitions: [waitTool] },
		});
		const waiters = new Set<() => Promise<boolean>>();
		changed = () => {
			for (const check of [...waiters]) void check().then((done) => done && waiters.delete(check));
		};
		reaches = (_botId, runId, state) => {
			const { promise, resolve } = Promise.withResolvers<void>();
			const check = async (): Promise<boolean> => {
				const run = await runtime.runsStore().get(runId);
				if (run?.state !== state) return false;
				resolve();
				return true;
			};
			waiters.add(check);
			changed();
			return promise;
		};
		scheduler = new RunScheduler({
			runtime,
			maxActiveRuns: 1,
			canAdmit: () => admitted,
			changed: () => changed(),
			now: () => ++clock,
			stopping: (botId) => stopped.push(botId),
		});
		runtime.resume();
	}

	async function close(): Promise<void> {
		scheduler.stop();
		await runtime.close();
	}

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "openbot-scheduler-"));
		databasePath = join(directory, "openbot.sqlite");
		clock = 0;
		admitted = true;
		stopped = [];
	});

	afterEach(async () => {
		await rm(directory, { recursive: true, force: true });
	});

	async function createBots(...botIds: BotId[]): Promise<void> {
		for (const botId of botIds) await runtime.createBot({ botId, name: botId, model: SCRIPTED_MODEL, createdAt: 0 });
	}

	it("interrupts active work, preserves the queue and continues with a fresh stable request", async () => {
		await open(WAIT, "Queued answer", "Continued answer");
		await createBots("a", "b");
		await scheduler.start();
		const first = await scheduler.submit("a", "one", "Original task");
		await gates.entered("a");
		const queued = await scheduler.submit("b", "two", "Queued task");
		admitted = false;
		await scheduler.interruptAll("user");
		expect(scripted.requests()).toBe(1);
		expect(scheduler.attention("a")).toMatchObject({
			runId: first.runId,
			state: "needs_attention",
			interruption: { reason: "user", settledAt: expect.any(Number) },
		});
		expect((await runtime.runsStore().get(queued.runId))?.state).toBe("queued");
		await expect(scheduler.continue(first.runId, "continued")).rejects.toThrow("paused");
		admitted = true;
		await scheduler.resume();
		await reaches("b", queued.runId, "completed");
		const continued = await scheduler.continue(first.runId, "continued");
		expect(continued.runId).not.toBe(first.runId);
		await reaches("a", continued.runId, "completed");
		expect((await scheduler.continue(first.runId, "continued")).runId).toBe(continued.runId);
		expect(scripted.requests()).toBe(3);
		expect(scheduler.attention("a")).toBeUndefined();
		await close();
	});
	it("keeps an unconfirmed interruption unavailable for continuation until reconciliation succeeds", async () => {
		await open(WAIT);
		await createBots("a");
		await scheduler.start();
		const first = await scheduler.submit("a", "one", "Work");
		await gates.entered("a");
		admitted = false;
		await expect(
			scheduler.interruptAll("suspended", async () => {
				throw Error("unknown");
			}),
		).rejects.toThrow("unknown");
		expect((await runtime.runsStore().get(first.runId))?.interruption?.settledAt).toBeUndefined();
		admitted = true;
		await expect(scheduler.continue(first.runId, "continued")).rejects.toThrow("Only an interrupted");
		admitted = false;
		await scheduler.interruptAll("recovery");
		expect(scheduler.attention("a")?.interruption?.settledAt).toBeDefined();
		await close();
	});
	it("does not submit crash-recovered work before native readiness, even when its channel is no longer admissible", async () => {
		await open("Must not run");
		await createBots("a");
		await runtime.runsStore().put({
			runId: "saved",
			botId: "a",
			state: "running",
			requestIds: ["saved-request"],
			createdAt: 1,
			messages: [{ requestId: "saved-request", text: "Work" }],
			inputs: [{ requestId: "saved-request", text: "Work" }],
		});
		admitted = false;
		scheduler = new RunScheduler({
			runtime,
			maxActiveRuns: 1,
			canAdmit: () => admitted,
			admissible: async () => false,
			changed: () => changed(),
			now: () => ++clock,
		});
		await scheduler.start();
		expect(scripted.requests()).toBe(0);
		await scheduler.interruptAll("recovery");
		expect(scripted.requests()).toBe(0);
		expect(scheduler.attention("a")?.state).toBe("needs_attention");
		await close();
	});

	it("preserves a committed answer when startup observation was interrupted", async () => {
		await open("Already answered");
		await createBots("a");
		const input = await runtime.submit("a", "one", "Work", "start");
		await runtime.waitSubmission("a", input.submissionId);
		await runtime
			.runsStore()
			.put({
				runId: "saved-answer",
				botId: "a",
				state: "running",
				requestIds: ["one"],
				createdAt: 1,
				messages: [{ requestId: "one", text: "Work" }],
				inputs: [{ requestId: "one", text: "Work", submissionId: input.submissionId }],
			});
		admitted = false;
		await scheduler.start();
		await scheduler.interruptAll("recovery");
		expect((await runtime.runsStore().get("saved-answer"))?.state).toBe("completed");
		expect(scheduler.attention("a")).toBeUndefined();
		expect(scripted.requests()).toBe(1);
		await close();
	});

	it("keeps channels queued separately, prioritizes direct work and cancels only the selected channel", async () => {
		await open(WAIT, "Group done", "Direct done");
		await createBots("a");
		await runtime.ensureChannel("a", "group");
		await runtime.ensureChannel("a", "other");
		await scheduler.start();
		const first = await scheduler.submit("a", "g1", "Group task", { channelId: "group", separate: true });
		await gates.entered("a");
		const queued = await scheduler.submit("a", "g2", "Other task", { channelId: "other", separate: true });
		const direct = await scheduler.submit("a", "dm", "Direct task");
		expect(direct.steered).toBe(false);
		expect(direct.state).toBe("queued");
		await expect(scheduler.submit("a", "dm", "Direct task", { channelId: "group" })).rejects.toThrow("another message");
		await scheduler.cancelMatching((run) => run.channelId === "other");
		expect((await runtime.runsStore().get(queued.runId))?.state).toBe("cancelled");
		gates.release("a");
		await reaches("a", first.runId, "completed");
		await reaches("a", direct.runId, "completed");
		expect(JSON.stringify((await runtime.snapshot("a")).items)).toContain("Direct task");
		expect(JSON.stringify((await runtime.snapshot("a")).items)).not.toContain("Group task");
		expect((await runtime.snapshot("a", "other")).items).toEqual([]);
		await close();
	});

	it("admits aged channel work before newer direct work across restart", async () => {
		await open(WAIT, "Blocker done", "Aged group done", "Direct done");
		await createBots("a", "b");
		await runtime.ensureChannel("a", "group");
		await scheduler.start();
		const blocker = await scheduler.submit("b", "block", "Block");
		await gates.entered("b");
		const group = await scheduler.submit("a", "g", "Group", { channelId: "group", separate: true });
		clock += 30_001;
		const direct = await scheduler.submit("a", "dm", "Direct");
		gates.release("b");
		await reaches("b", blocker.runId, "completed");
		await reaches("a", group.runId, "completed");
		await reaches("a", direct.runId, "completed");
		expect((await runtime.runsStore().get(group.runId))!.startedAt).toBeLessThan((await runtime.runsStore().get(direct.runId))!.startedAt!);
		const key = await runtime.conversationKey("a", "group");
		await close();
		await open("After restart");
		await scheduler.start();
		expect(await runtime.conversationKey("a", "group")).toBe(key);
		expect((await scheduler.submit("a", "g", "Group", { channelId: "group", separate: true })).runId).toBe(group.runId);
		await close();
	});

	it("recovers an unadmitted channel Run with its original identity", async () => {
		await open();
		await createBots("a");
		await runtime.ensureChannel("a", "group");
		await runtime.runsStore().put({
			runId: "saved",
			botId: "a",
			channelId: "group",
			origin: "user",
			state: "queued",
			requestIds: ["saved-request"],
			createdAt: 1,
			messages: [{ requestId: "saved-request", text: "Recovered group task" }],
			inputs: [],
		});
		await close();
		await open("Recovered answer");
		await scheduler.start();
		await reaches("a", "saved", "completed");
		expect((await runtime.snapshot("a")).items).toEqual([]);
		expect(JSON.stringify((await runtime.snapshot("a", "group")).items)).toContain("Recovered answer");
		await close();
	});

	it("queues a second Bot's message at the cap and starts it when the first Run ends", async () => {
		await open(WAIT, "A done.", "B done.");
		await createBots("a", "b");
		await scheduler.start();

		const a = await scheduler.submit("a", "m1", "Work");
		expect(a).toMatchObject({ state: "running", steered: false });
		await gates.entered("a");
		const b = await scheduler.submit("b", "m2", "Also work");
		expect(b).toMatchObject({ state: "queued", steered: false });
		expect(scheduler.active("b")?.state).toBe("queued");
		// Nothing of B reached Pi while it waits.
		expect((await runtime.snapshot("b")).items).toEqual([]);

		gates.release("a");
		await reaches("a", a.runId, "completed");
		await reaches("b", b.runId, "completed");
		const run = await runtime.runsStore().get(b.runId);
		expect(run?.startedAt).toBeGreaterThan((await runtime.runsStore().get(a.runId))?.endedAt ?? Number.POSITIVE_INFINITY);
		expect((await runtime.snapshot("b")).items.map((item) => item.kind)).toEqual(["user", "assistant"]);
		await close();
	});

	it("cancels a queued Run without touching Pi and admits the next one", async () => {
		await open(WAIT, "A done.", "C done.");
		await createBots("a", "b", "c");
		await scheduler.start();
		const a = await scheduler.submit("a", "m1", "Work");
		await gates.entered("a");
		const b = await scheduler.submit("b", "m2", "Queued");
		const c = await scheduler.submit("c", "m3", "Queued too");

		expect(await scheduler.cancel(b.runId)).toBe("cancelled");
		expect(await scheduler.cancel(b.runId)).toBe("cancelled");
		gates.release("a");
		await reaches("c", c.runId, "completed");
		expect((await runtime.snapshot("b")).items).toEqual([]);
		expect((await runtime.runsStore().get(a.runId))?.state).toBe("completed");
		// Nothing ran for the queued Run, so there is no background work to stop.
		expect(stopped).toEqual([]);
		await close();
	});

	it("cancels a running Run, frees its slot, and starts a new Run for the next message", async () => {
		await open(WAIT, "B done.", "Fresh start.");
		await createBots("a", "b");
		await scheduler.start();
		const a = await scheduler.submit("a", "m1", "Work");
		await gates.entered("a");
		const b = await scheduler.submit("b", "m2", "Queued");

		expect(await scheduler.cancel(a.runId)).toBe("cancelled");
		expect(stopped).toEqual(["a"]);
		await reaches("b", b.runId, "completed");
		const items = (await runtime.snapshot("a")).items;
		expect(items.find((item) => item.kind === "tool")).toMatchObject({ status: "cancelled" });
		expect(items.at(-1)).toMatchObject({ kind: "stopped" });
		// A terminal Run reports its state and changes nothing.
		expect(await scheduler.cancel(a.runId)).toBe("cancelled");

		const next = await scheduler.submit("a", "m3", "Again");
		expect(next.runId).not.toBe(a.runId);
		await reaches("a", next.runId, "completed");
		await close();
	});

	it("steers a running Run with a message sent while it works", async () => {
		await open(WAIT, "Switched.");
		await createBots("a");
		await scheduler.start();
		const first = await scheduler.submit("a", "m1", "Read a.txt");
		await gates.entered("a");
		const steer = await scheduler.submit("a", "m2", "Use a different file");
		expect(steer).toEqual({ runId: first.runId, state: "running", steered: true });

		gates.release("a");
		await reaches("a", first.runId, "completed");
		expect(scripted.requests()).toBe(2);
		expect((await runtime.runsStore().list()).map((run) => run.runId)).toEqual([first.runId]);
		expect((await runtime.runsStore().get(first.runId))?.requestIds).toEqual(["m1", "m2"]);
		await close();
	});

	it("keeps a failed Run failed when a steer was still queued", async () => {
		const respond = Promise.withResolvers<void>();
		await open({ error: "provider 500", after: respond.promise });
		await createBots("a");
		await scheduler.start();
		const first = await scheduler.submit("a", "m1", "Work");
		const steer = await scheduler.submit("a", "m2", "Also this");
		expect(steer).toMatchObject({ runId: first.runId, steered: true });
		respond.resolve();

		await reaches("a", first.runId, "failed");
		const run = await runtime.runsStore().get(first.runId);
		expect(run?.error).toBe("model_error");
		// A failure is not a stop: no "Stopped" note, and the Bot was never asked to stop its work.
		expect((await runtime.snapshot("a")).items.some((item) => item.kind === "stopped")).toBe(false);
		expect(stopped).toEqual([]);
		await close();
	});

	it("joins messages to a queued Run and submits them together when it starts", async () => {
		await open(WAIT, "A done.", "Both read.");
		await createBots("a", "b");
		await scheduler.start();
		await scheduler.submit("a", "m1", "Work");
		await gates.entered("a");
		const b1 = await scheduler.submit("b", "m2", "First");
		const b2 = await scheduler.submit("b", "m3", "Second");
		expect(b2).toEqual({ runId: b1.runId, state: "queued", steered: true });

		gates.release("a");
		await reaches("b", b1.runId, "completed");
		const users = (await runtime.snapshot("b")).items.filter((item) => item.kind === "user");
		expect(users).toMatchObject([{ parts: [{ text: "First\n\nSecond" }] }]);
		expect(scripted.requests()).toBe(3);
		await close();
	});

	it("same requestId returns the same run across reopen", async () => {
		await open("Done.");
		await createBots("a");
		await scheduler.start();
		const first = await scheduler.submit("a", "m1", "Hello");
		await reaches("a", first.runId, "completed");
		await expect(scheduler.submit("a", "m1", "Other text")).rejects.toMatchObject({ code: "request_conflict" });
		await close();

		await open();
		await scheduler.start();
		expect(await scheduler.submit("a", "m1", "Hello")).toEqual({ runId: first.runId, state: "completed", steered: false });
		expect(scripted.requests()).toBe(0);
		await close();
	});

	it("running Run without Pi submission is resubmitted once", async () => {
		await open("Done.");
		await createBots("a");
		// A crash after Pi admitted the input but before the Run recorded its submission.
		await runtime.submit("a", "m1", "Hello", "start");
		await runtime.runsStore().put({
			runId: "run_crashed",
			botId: "a",
			state: "running",
			requestIds: ["m1"],
			createdAt: 1,
			startedAt: 1,
			messages: [{ requestId: "m1", text: "Hello" }],
			inputs: [{ requestId: "m1", text: "Hello" }],
		});
		await close();

		await open("Unused.");
		await scheduler.start();
		await reaches("a", "run_crashed", "completed");
		const stored = await runtime.runsStore().get("run_crashed");
		expect(stored?.inputs[0]?.submissionId).toBeDefined();
		expect((await runtime.snapshot("a")).items.map((item) => item.kind)).toEqual(["user", "assistant"]);
		await close();
	});

	it("starts a running Run whose Pi submission was never created", async () => {
		await open("Done.");
		await createBots("a");
		await runtime.runsStore().put({
			runId: "run_unsent",
			botId: "a",
			state: "running",
			requestIds: ["m1"],
			createdAt: 1,
			startedAt: 1,
			messages: [{ requestId: "m1", text: "Hello" }],
			inputs: [{ requestId: "m1", text: "Hello" }],
		});
		await scheduler.start();
		await reaches("a", "run_unsent", "completed");
		expect(scripted.requests()).toBe(1);
		await close();
	});
});
