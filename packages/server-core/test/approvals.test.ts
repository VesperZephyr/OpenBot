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
	const restart = async (now: () => number = Date.now): Promise<ApprovalBook> => {
		await runtime?.close();
		runtime = await BotRuntime.open({ databasePath: join(directory, "db.sqlite"), models: scriptedModels().models });
		const book = new ApprovalBook(() => {}, now);
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

	it("reads allow and deny records after a restart", async () => {
		const allow = { ...approval, conversationId: "session-a", approvalId: "approval:session-a:call_1", callId: "call_1" };
		const deny = {
			...approval,
			conversationId: "session-b",
			approvalId: "approval:session-b:call_2",
			callId: "call_2",
			tool: "local_write",
		};
		const first = await restart();
		const waitingAllow = first.request(allow, live());
		const waitingDeny = first.request(deny, live());
		await expect.poll(() => first.forBot("bot").length).toBe(2);
		await first.decide(allow.approvalId, "allow_once");
		await first.decide(deny.approvalId, "deny");
		await waitingAllow;
		await waitingDeny;

		const second = await restart();
		expect(await second.decisions("session-a")).toMatchObject([
			{ approvalId: allow.approvalId, decision: "allow_once", tool: "local_exec", conversationId: "session-a" },
		]);
		expect(await second.decisions("session-b")).toMatchObject([
			{ approvalId: deny.approvalId, decision: "deny", tool: "local_write", conversationId: "session-b" },
		]);
		expect(second.forBot("bot")).toEqual([]);
	});

	it("returns always_allow unchanged after a restart", async () => {
		const scope = { kind: "command" as const, rule: { program: "echo", exact: "echo kept" } };
		const saved = {
			...approval,
			conversationId: "session-a",
			approvalId: "approval:session-a:call_always",
			callId: "call_always",
			alwaysAllowOptions: [{ label: "echo kept", scope }],
		};
		const first = await restart();
		const waiting = first.request(saved, live());
		await expect.poll(() => first.forBot("bot").some((row) => row.approvalId === saved.approvalId)).toBe(true);
		expect(await first.decide(saved.approvalId, { kind: "always_allow", scope })).toBe(true);
		expect(await waiting).toEqual({ kind: "always_allow", scope });

		const second = await restart();
		expect(await second.decisions("session-a")).toMatchObject([
			{ approvalId: saved.approvalId, decision: "always_allow", tool: "local_exec", conversationId: "session-a" },
		]);
	});

	it("returns only the requested conversation, newest 32", async () => {
		let clock = 5_000;
		const first = await restart(() => clock);
		const settle = async (item: PendingApproval, decision: "allow_once" | "deny") => {
			const waiting = first.request(item, live());
			await expect.poll(() => first.forBot("bot").some((row) => row.approvalId === item.approvalId)).toBe(true);
			clock += 1;
			await first.decide(item.approvalId, decision);
			await waiting;
		};
		for (let i = 0; i < 33; i++) {
			await settle(
				{
					...approval,
					conversationId: "session-a",
					approvalId: `approval:session-a:call_${i}`,
					callId: `call_${i}`,
					createdAt: clock,
				},
				i % 2 === 0 ? "allow_once" : "deny",
			);
		}
		await settle(
			{ ...approval, approvalId: "approval:session-a:bare", callId: "bare", createdAt: clock },
			"allow_once",
		);
		await settle(
			{
				...approval,
				conversationId: "session-b",
				approvalId: "approval:session-b:other",
				callId: "other",
				tool: "local_write",
				createdAt: clock,
			},
			"deny",
		);

		const second = await restart(() => clock);
		const page = await second.decisions("session-a");
		expect(page).toHaveLength(32);
		expect(page.every((row) => row.conversationId === "session-a")).toBe(true);
		expect(page.map((row) => row.approvalId)).toEqual(Array.from({ length: 32 }, (_, n) => `approval:session-a:call_${32 - n}`));
		expect(page.some((row) => row.approvalId === "approval:session-a:bare")).toBe(false);
		expect(await second.decisions("session-b")).toMatchObject([
			{ approvalId: "approval:session-b:other", decision: "deny", conversationId: "session-b" },
		]);
	});

	it("uses conversationId and skips a record that does not have one", async () => {
		const first = await restart();
		const labeled = { ...approval, conversationId: "session-a", approvalId: "approval:session-a:labeled", callId: "labeled" };
		const bare = { ...approval, approvalId: "approval:session-a:bare-pending", callId: "bare-pending" };
		const other = { ...approval, conversationId: "session-b", approvalId: "approval:other:pending", callId: "other-pending" };
		const waitingLabeled = first.request(labeled, live());
		const waitingBare = first.request(bare, live());
		const waitingOther = first.request(other, live());
		await expect.poll(() => first.forBot("bot").length).toBe(3);
		expect(first.forBot("bot", "session-a").map((row) => row.approvalId)).toEqual([labeled.approvalId]);
		expect(first.forBot("bot", "session-b").map((row) => row.approvalId)).toEqual([other.approvalId]);
		await first.decide(labeled.approvalId, "allow_once");
		await first.decide(bare.approvalId, "deny");
		await first.decide(other.approvalId, "allow_once");
		await waitingLabeled;
		await waitingBare;
		await waitingOther;
		expect((await first.decisions("session-a")).map((row) => row.approvalId)).toEqual([labeled.approvalId]);
		expect((await first.decisions("session-a")).some((row) => row.approvalId === bare.approvalId)).toBe(false);
	});

	it("clears a deleted conversation's records and leaves records without that conversationId", async () => {
		const first = await restart();
		const gone = { ...approval, conversationId: "session-a", approvalId: "approval:session-a:gone", callId: "gone" };
		const kept = { ...approval, conversationId: "session-b", approvalId: "approval:session-b:kept", callId: "kept" };
		const bare = { ...approval, approvalId: "approval:session-a:bare-kept", callId: "bare-kept" };
		for (const item of [gone, kept, bare]) {
			const waiting = first.request(item, live());
			await expect.poll(() => first.forBot("bot").some((row) => row.approvalId === item.approvalId)).toBe(true);
			await first.decide(item.approvalId, "allow_once");
			await waiting;
		}
		await first.forgetConversation("session-a");
		expect(await first.decisions("session-a")).toEqual([]);
		expect(await first.decisions("session-b")).toMatchObject([{ approvalId: kept.approvalId, conversationId: "session-b" }]);
		const second = await restart();
		expect(await second.decisions("session-a")).toEqual([]);
		expect(await second.decisions("session-b")).toMatchObject([{ approvalId: kept.approvalId, conversationId: "session-b" }]);
		expect(await second.request(bare, live())).toBe("allow_once");
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
