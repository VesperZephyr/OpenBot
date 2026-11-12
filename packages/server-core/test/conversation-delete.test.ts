import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BotRuntime } from "@openbot/agent-runtime";
import { SCRIPTED_MODEL, scriptedModels } from "@openbot/agent-runtime/testing";
import { ProtocolError, type PendingApproval } from "@openbot/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalBook } from "../src/approvals.ts";
import type { ConversationHost } from "../src/host-conversations.ts";
import { deleteConversation, submitMessage } from "../src/host-conversations.ts";
import { RunScheduler } from "../src/runs.ts";

/**
 * A Run admitted while delete is still cleaning up can record a tool approval before
 * `forgetConversation`. The stand-in below stores one only if `messages.submit` reaches the scheduler.
 */
const RACING_APPROVAL = "approval:submit-window";

describe("deleteConversation concurrency", () => {
	let root: string;
	let runtime: BotRuntime;
	let scheduler: RunScheduler;
	let book: ApprovalBook;
	let botId: string;
	let conversationId: string;
	let existingRunId: string;
	let requests: AbortController;

	const key = () => `bot:${botId}` as const;
	const runsFor = async (requestId: string) =>
		(await runtime.runsStore().list()).filter((run) => run.requestIds.includes(requestId));
	const racing = (): PendingApproval => ({
		approvalId: RACING_APPROVAL,
		botId,
		callId: "submit-window",
		conversationId,
		tool: "local_exec",
		args: {},
		target: { kind: "local", targetId: "mac" },
		reason: "Runs a command on this Mac",
		createdAt: 3,
	});

	function watchAdmission(): void {
		const submit = scheduler.submit.bind(scheduler);
		vi.spyOn(scheduler, "submit").mockImplementation(async (id, requestId, text, options) => {
			const outcome = await submit(id, requestId, text, options);
			const pending = book.request(racing(), requests.signal);
			pending.catch(() => {});
			await expect.poll(() => book.forBot(botId).some((row) => row.approvalId === RACING_APPROVAL)).toBe(true);
			return outcome;
		});
	}

	function host(stopConversation: (botId: string, conversationId: string) => Promise<void>, emit: ConversationHost["emit"]): ConversationHost {
		return {
			runtime,
			emit,
			liveBot: async (id: string) => {
				const bot = await runtime.getBot(id);
				if (bot === undefined || bot.status === "deleted") throw new ProtocolError("not_found", `Unknown Bot: ${id}`);
				return bot;
			},
			runs: scheduler,
			approvals: book,
			observers: new Map(),
			feed: { subscribed: null, publish() {}, subscribe() {} },
			background: { stopConversation },
			groups: {},
			toolSettled() {},
			management: {},
		} as unknown as ConversationHost;
	}

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "openbot-delete-race-"));
		requests = new AbortController();
		runtime = await BotRuntime.open({ databasePath: join(root, "db"), models: scriptedModels("Done.").models });
		const bot = await runtime.createBot({ botId: "cedar", name: "Cedar", createdAt: 1, model: SCRIPTED_MODEL });
		botId = bot.botId;
		conversationId = await runtime.conversationKey(botId);
		book = new ApprovalBook(() => {});
		await book.start(runtime.approvals());
		const existing: PendingApproval = { ...racing(), approvalId: "approval:existing", callId: "existing", createdAt: 1 };
		const waiting = book.request(existing, requests.signal);
		waiting.catch(() => {});
		await expect.poll(() => book.forBot(botId).some((row) => row.approvalId === "approval:existing")).toBe(true);
		scheduler = new RunScheduler({
			runtime,
			maxActiveRuns: 1,
			canAdmit: () => false,
			changed: () => {},
			now: () => Date.now(),
		});
		existingRunId = (await scheduler.submit(botId, "existing", "Still working")).runId;
		expect((await runtime.runsStore().get(existingRunId))?.state).toBe("queued");
		watchAdmission();
	});

	afterEach(async () => {
		requests?.abort();
		book?.close();
		scheduler?.stop();
		await runtime?.close();
		await rm(root, { recursive: true, force: true });
	});

	it("does not leave a run or approval when a submit arrives during cleanup", async () => {
		const release = Promise.withResolvers<void>();
		const entered = Promise.withResolvers<void>();
		const events: string[] = [];
		const deleting = deleteConversation(
			host(async () => {
				entered.resolve();
				await release.promise;
			}, () => events.push("bots.changed")),
			{ conversationKey: key() },
		);
		try {
			await entered.promise;
			let failure: unknown;
			try {
				await submitMessage(host(async () => {}, () => {}), { botId, requestId: "submit-window", text: "During delete" });
			} catch (error) {
				failure = error;
			}
			expect(failure).toBeInstanceOf(ProtocolError);
			expect((failure as ProtocolError).message).toBe("Conversation is unavailable");
			expect(await runsFor("submit-window")).toEqual([]);
			expect(book.forBot(botId).some((row) => row.approvalId === RACING_APPROVAL)).toBe(false);
			expect(await runtime.conversationIndex().deleted(key())).toBe(true);
		} finally {
			release.resolve();
		}
		await deleting;
		expect(await runsFor("submit-window")).toEqual([]);
		expect(book.forBot(botId).map((row) => row.approvalId)).toEqual([]);
		expect(await runtime.approvals().get("approval:existing")).toBeUndefined();
		expect((await runtime.runsStore().get(existingRunId))?.state ?? "cancelled").toBe("cancelled");
		expect(await runtime.conversationIndex().deleted(key())).toBe(true);
		expect(events).toEqual(["bots.changed"]);
	});

	it("keeps the conversation deleted when cleanup fails and the retry clears the orphan run", async () => {
		const release = Promise.withResolvers<void>();
		const entered = Promise.withResolvers<void>();
		const original = scheduler.cancelMatching.bind(scheduler);
		let failed = false;
		vi.spyOn(scheduler, "cancelMatching").mockImplementation(async (matches) => {
			if (!failed) {
				failed = true;
				entered.resolve();
				await release.promise;
				throw new Error("cleanup failed");
			}
			return original(matches);
		});
		const events: string[] = [];
		const conversation = host(async () => {}, () => events.push("bots.changed"));
		const deleting = deleteConversation(conversation, { conversationKey: key() });
		try {
			await entered.promise;
			let failure: unknown;
			try {
				await submitMessage(conversation, { botId, requestId: "submit-window", text: "During delete" });
			} catch (error) {
				failure = error;
			}
			expect(failure).toBeInstanceOf(ProtocolError);
			expect((failure as ProtocolError).message).toBe("Conversation is unavailable");
			expect(await runsFor("submit-window")).toEqual([]);
			expect(book.forBot(botId).some((row) => row.approvalId === RACING_APPROVAL)).toBe(false);
			expect(await runtime.conversationIndex().deleted(key())).toBe(true);
		} finally {
			release.resolve();
		}
		await expect(deleting).rejects.toThrow("cleanup failed");
		expect(await runtime.conversationIndex().deleted(key())).toBe(true);
		expect((await runtime.runsStore().get(existingRunId))?.state).toBe("queued");
		expect(await runtime.approvals().get("approval:existing")).toMatchObject({ approvalId: "approval:existing" });
		await expect(submitMessage(conversation, { botId, requestId: "after-failure", text: "Still deleted" })).rejects.toThrow(
			"Conversation is unavailable",
		);
		expect(await runsFor("after-failure")).toEqual([]);
		expect(await runsFor("submit-window")).toEqual([]);

		const removed = await deleteConversation(conversation, { conversationKey: key() });
		expect(removed.conversationId).toBe(conversationId);
		expect((await runtime.runsStore().get(existingRunId))?.state ?? "cancelled").toBe("cancelled");
		expect(await runtime.approvals().get("approval:existing")).toBeUndefined();
		expect(book.forBot(botId)).toEqual([]);
		expect(await runtime.conversationIndex().deleted(key())).toBe(true);
		await expect(submitMessage(conversation, { botId, requestId: "after-retry", text: "Still deleted" })).rejects.toThrow(
			"Conversation is unavailable",
		);
		expect(await runsFor("after-retry")).toEqual([]);
		expect(events).toEqual(["bots.changed", "bots.changed"]);
	});
});
