import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BotRuntime } from "@openbot/agent-runtime";
import { scriptedModels } from "@openbot/agent-runtime/testing";
import type { PendingApproval } from "@openbot/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApprovalBook } from "../src/index.ts";

const approval: PendingApproval = {
	approvalId: "approval:1:call_1",
	botId: "bot",
	callId: "call_1",
	tool: "local_exec",
	args: { command: "echo run >> count.txt" },
	target: { kind: "local", targetId: "mac" },
	reason: "Runs a command on this Mac",
	createdAt: 1_000,
};

describe("ApprovalBook", () => {
	let directory: string;
	let runtime: BotRuntime | undefined;

	/** A Host start on the same database: a fresh runtime and a fresh book over its store. */
	const restart = async (): Promise<ApprovalBook> => {
		await runtime?.close();
		runtime = await BotRuntime.open({ databasePath: join(directory, "db.sqlite"), models: scriptedModels().models });
		const book = new ApprovalBook(() => {});
		await book.start(runtime.approvals());
		return book;
	};
	const live = (): AbortSignal => new AbortController().signal;

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "openbot-book-"));
	});

	afterEach(async () => {
		await runtime?.close();
		runtime = undefined;
		await rm(directory, { recursive: true, force: true });
	});

	it("shows a pending approval again after a restart and wakes the rerun on decision", async () => {
		const first = await restart();
		const shutdown = new AbortController();
		const waiting = first.request(approval, shutdown.signal);
		await expect.poll(() => first.forBot("bot").length).toBe(1);
		first.close();
		shutdown.abort(new Error("shutdown"));
		await expect(waiting).rejects.toThrow("shutdown");

		const second = await restart();
		expect(second.forBot("bot")).toEqual([approval]);
		const rerun = second.request(approval, live());
		expect(await second.decide(approval.approvalId, "allow_once")).toBe(true);
		expect(await rerun).toBe("allow_once");
		expect(second.forBot("bot")).toEqual([]);
	});

	it("decision survives a new book on the same store", async () => {
		const first = await restart();
		const waiting = first.request(approval, live());
		await expect.poll(() => first.forBot("bot").length).toBe(1);
		await first.decide(approval.approvalId, "allow_once");
		expect(await waiting).toBe("allow_once");

		const second = await restart();
		expect(second.forBot("bot")).toEqual([]);
		expect(await second.request(approval, live())).toBe("allow_once");
	});

	it("denied approval answers a rerun without waiting", async () => {
		const first = await restart();
		const waiting = first.request(approval, live());
		await expect.poll(() => first.forBot("bot").length).toBe(1);
		await first.decide(approval.approvalId, "deny");
		expect(await waiting).toBe("deny");

		const second = await restart();
		// Resolves without anyone deciding: an unanswered request would time the test out.
		expect(await second.request(approval, live())).toBe("deny");
		expect(await second.decide(approval.approvalId, "allow_once")).toBe(false);
	});

	it("a consumed approval still answers a rerun with its decision", async () => {
		const first = await restart();
		const waiting = first.request(approval, live());
		await expect.poll(() => first.forBot("bot").length).toBe(1);
		await first.decide(approval.approvalId, "allow_once");
		await waiting;
		await first.settled(approval.botId, approval.callId);

		const second = await restart();
		expect(await second.request(approval, live())).toBe("allow_once");
	});

	it("an abort after close leaves the record pending", async () => {
		const first = await restart();
		const controller = new AbortController();
		const waiting = first.request(approval, controller.signal);
		await expect.poll(() => first.forBot("bot").length).toBe(1);
		first.close();
		controller.abort(new Error("shutdown"));
		await expect(waiting).rejects.toThrow();
		expect(await runtime?.approvals().get(approval.approvalId)).toMatchObject({ state: "pending" });
	});

	it("cancelling the Run withdraws the request", async () => {
		const first = await restart();
		const controller = new AbortController();
		const waiting = first.request(approval, controller.signal);
		await expect.poll(() => first.forBot("bot").length).toBe(1);
		controller.abort(new Error("cancelled"));
		await expect(waiting).rejects.toThrow("cancelled");
		expect(first.forBot("bot")).toEqual([]);
		await expect.poll(async () => (await runtime?.approvals().get(approval.approvalId))?.state).toBe("withdrawn");
		expect(await first.decide(approval.approvalId, "allow_once")).toBe(false);

		const second = await restart();
		expect(second.forBot("bot")).toEqual([]);
	});
});
