import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApprovalStore } from "@openbot/agent-runtime";
import type { ApprovalRecord, PendingApproval } from "@openbot/protocol";
import { ApprovalBook } from "../src/approvals.ts";
const base: PendingApproval = {
	approvalId: "a",
	botId: "bot",
	conversationId: "1",
	callId: "call",
	tool: "local_exec",
	args: { command: "echo hi" },
	target: { kind: "local", targetId: "mac" },
	createdAt: 1000,
	reason: "ask",
	binding: { runId: "run", origin: "unattended", revision: 1, argsDigest: "digest" },
};
function fixture() {
	const rows = new Map<string, ApprovalRecord>();
	const store: ApprovalStore = {
		get: async (id) => rows.get(id),
		put: async (record) => {
			rows.set(record.approvalId, structuredClone(record));
		},
		pending: async () => [...rows.values()].filter((r) => r.state === "pending"),
		prune: async () => {},
	};
	return { rows, store };
}
const live = () => new AbortController().signal;
afterEach(() => vi.useRealTimers());
describe("approval authority", () => {
	it("expires at ten minutes, persists across restart, and never resets the original deadline", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(1000);
		const f = fixture(),
			first = new ApprovalBook(() => {});
		await first.start(f.store);
		const controller = new AbortController();
		const waiting = first.request(base, controller.signal).catch((e) => e.message);
		await vi.advanceTimersByTimeAsync(0);
		expect(f.rows.get("a")?.deadline).toBe(601000);
		first.close();
		controller.abort(new Error("restart"));
		await waiting;
		await vi.advanceTimersByTimeAsync(599999);
		const next = new ApprovalBook(() => {});
		await next.start(f.store);
		const replay = next.request({ ...base, createdAt: 600999 }, live()).catch((e) => e.message);
		await vi.advanceTimersByTimeAsync(1);
		expect(await replay).toBe("approval_expired");
		expect(f.rows.get("a")?.state).toBe("expired");
		expect(await next.decide("a", "allow_once")).toBe(false);
		await expect(next.request({ ...base, createdAt: Date.now() }, live())).rejects.toThrow("approval_expired");
		next.close();
	});
	it("keeps attended waits indefinite and respects an earlier parent deadline", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(1000);
		const f = fixture(),
			book = new ApprovalBook(() => {});
		await book.start(f.store);
		const attended = { ...base, binding: { ...base.binding!, origin: "attended" as const } };
		const waiting = book.request(attended, live());
		await vi.advanceTimersByTimeAsync(700000);
		expect(f.rows.get("a")?.deadline).toBeUndefined();
		await book.decide("a", "allow_once");
		expect(await waiting).toBe("allow_once");
		const parent = book
			.request({ ...base, approvalId: "b", createdAt: Date.now(), deadline: Date.now() + 500 }, live())
			.catch((e) => e.message);
		await vi.advanceTimersByTimeAsync(500);
		expect(await parent).toBe("approval_expired");
		book.close();
	});
	it("rejects changed arguments, target, Run and authority; denies remain terminal", async () => {
		const f = fixture(),
			book = new ApprovalBook(
				() => {},
				() => 1000,
			);
		await book.start(f.store);
		const pending = book.request(base, live());
		await expect.poll(() => book.forBot("bot").length).toBe(1);
		for (const changed of [
			{ ...base, args: { command: "different" } },
			{ ...base, target: { kind: "local" as const, targetId: "foreign" } },
			{ ...base, binding: { ...base.binding!, runId: "other" } },
		])
			await expect(book.request(changed, live())).rejects.toThrow("identity");
		expect(await book.decide("a", "allow_once")).toBe(true);
		await pending;
		expect(await book.decide("a", "deny")).toBe(false);
		expect(await book.authorized(base)).toBe(true);
		expect(await book.authorized({ ...base, binding: { ...base.binding!, revision: 2 } })).toBe(false);
		await expect(book.request({ ...base, binding: { ...base.binding!, revision: 2 } }, live())).rejects.toThrow("permission_revoked");
		const denied = book.request({ ...base, approvalId: "deny" }, live());
		await expect.poll(() => book.forBot("bot").length).toBe(1);
		await book.decide("deny", "deny");
		await denied;
		expect(await book.request({ ...base, approvalId: "deny", binding: { ...base.binding!, revision: 9 } }, live())).toBe("deny");
		book.close();
	});
	it("a withdrawn invocation cannot be resurrected with a fresh deadline", async () => {
		const f = fixture(),
			book = new ApprovalBook(
				() => {},
				() => 1000,
			);
		await book.start(f.store);
		const controller = new AbortController();
		const waiting = book.request(base, controller.signal).catch(() => {});
		await expect.poll(() => book.forBot("bot").length).toBe(1);
		controller.abort();
		await waiting;
		await expect.poll(() => f.rows.get("a")?.state).toBe("withdrawn");
		await expect(book.request({ ...base, createdAt: 900000 }, live())).rejects.toThrow("withdrawn");
		book.close();
	});
});
