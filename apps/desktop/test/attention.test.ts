import type { BotSummary } from "@openbot/protocol";
import { describe, expect, it } from "vitest";
import { attention } from "../src/main/attention";

const bot = (botId: string, change: Partial<BotSummary> = {}): BotSummary => ({
	kind: "specialist", revision: 1,
	botId,
	name: botId.toUpperCase(),
	role: "",
	instructions: "",
	pinned: false,
	status: "active",
	createdAt: 0,
	activity: "idle",
	pendingApprovals: 0,
	...change,
});

describe("attention", () => {
	it("sets a baseline on the first roster after a (re)connect without notifying", () => {
		const result = attention(undefined, [
			bot("a", { pendingApprovals: 2, activity: "needs_attention", lastRun: { runId: "r1", state: "completed" } }),
		]);
		expect(result).toEqual({ badge: 2, keepAwake: false, notices: [] });
	});

	it("notifies once per new approval and once per finished Run", () => {
		const before = [bot("a", { activity: "working", lastRun: { runId: "r1", state: "running" } }), bot("b")];
		const next = [
			bot("a", { activity: "needs_attention", pendingApprovals: 1, lastRun: { runId: "r1", state: "running" } }),
			bot("b", { lastRun: { runId: "r2", state: "failed", error: "rate limited" } }),
		];
		const result = attention(before, next);
		expect(result.badge).toBe(1);
		expect(result.notices).toEqual([
			{ botId: "a", title: "A", body: "Needs your approval to continue" },
			{ botId: "b", title: "B", body: "Could not finish" },
		]);
		// The same roster again announces nothing.
		expect(attention(next, next).notices).toEqual([]);
		// Cancelled Runs were the user's own doing.
		expect(attention(before, [bot("a", { lastRun: { runId: "r1", state: "cancelled" } })]).notices).toEqual([]);
	});

	it("keeps the Mac awake while any Bot works or waits for a slot", () => {
		expect(attention(undefined, [bot("a"), bot("b", { activity: "queued" })]).keepAwake).toBe(true);
		expect(attention(undefined, [bot("a", { activity: "working" })]).keepAwake).toBe(true);
		expect(attention(undefined, [bot("a", { activity: "needs_attention" }), bot("b", { activity: "unread" })]).keepAwake).toBe(false);
	});
});
it("task work and approvals count once without duplicating direct completion",()=>{
 const direct={runId:"direct",state:"completed" as const};const idle=bot("core",{kind:"core",lastRun:direct});
 const working={...idle,activity:"working" as const,pendingApprovals:1};
 const admitted=attention([idle],[working]);expect(admitted.keepAwake).toBe(true);expect(admitted.badge).toBe(1);expect(admitted.notices).toHaveLength(1);expect(admitted.notices[0]?.body).toBe("Needs your approval to continue");
 const completed=attention([working],[idle]);expect(completed).toEqual({keepAwake:false,badge:0,notices:[]});
});
