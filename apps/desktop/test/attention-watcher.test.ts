import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BotSummary } from "@openbot/protocol";
import type { HostProcess } from "../src/main/host";

const native = vi.hoisted(() => ({ badge: vi.fn(), start: vi.fn(() => 1), stop: vi.fn(), notification: vi.fn(), show: vi.fn() }));
vi.mock("electron", () => ({
	app: { dock: { setBadge: native.badge } },
	powerSaveBlocker: { start: native.start, stop: native.stop },
	Notification: class {
		static isSupported() { return true; }
		constructor(options: unknown) { native.notification(options); }
		on() { return this; }
		show() { native.show(); }
	},
}));
import { AttentionWatcher } from "../src/main/attention-watcher";

beforeEach(() => vi.clearAllMocks());

describe("native attention effects", () => {
	it.each([false, true])("suppresses native effects only when disabled=%s", async (disabled) => {
		const bot: BotSummary = { kind: "specialist", revision: 1, botId: "a", name: "Scout", role: "", instructions: "", pinned: false, status: "active", createdAt: 0, activity: "idle", pendingApprovals: 0 };
		const call = vi.fn().mockResolvedValue([bot]);
		const watcher = new AttentionWatcher({ host: { call } as unknown as HostProcess, focused: () => false, openBot: vi.fn(), ...(disabled ? { nativeEffects: false } : {}) });
		watcher.onHostState({ status: "ready" });
		await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1));
		await new Promise((resolve) => setImmediate(resolve));
		call.mockResolvedValue([{ ...bot, pendingApprovals: 1, activity: "working", lastRun: { runId: "r", state: "running" } }]);
		watcher.onEvent({ type: "bots.changed", payload: {} });
		await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(2));
		await new Promise((resolve) => setImmediate(resolve));
		call.mockResolvedValue([{ ...bot, lastRun: { runId: "r", state: "completed" } }]);
		watcher.onEvent({ type: "bots.changed", payload: {} });
		await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(3));
		await new Promise((resolve) => setImmediate(resolve));
		watcher.stop();
		if (disabled) {
			for (const effect of Object.values(native)) expect(effect).not.toHaveBeenCalled();
		} else {
			expect(native.show).toHaveBeenCalledTimes(2);
			expect(native.badge).toHaveBeenCalledWith("1");
			expect(native.start).toHaveBeenCalledTimes(1);
			expect(native.stop).toHaveBeenCalledTimes(1);
		}
	});
 it("ignores a roster returned after Host loss", async () => {
  const pending = Promise.withResolvers<BotSummary[]>();
  const watcher = new AttentionWatcher({host:{call:()=>pending.promise} as unknown as HostProcess,focused:()=>false,openBot:vi.fn()});
  watcher.onHostState({status:"ready"});
  watcher.onHostState({status:"stopped"});
  native.badge.mockClear();
  pending.resolve([{kind:"core",revision:1,botId:"core",name:"OpenBot",role:"",instructions:"",pinned:true,status:"active",createdAt:0,activity:"working",pendingApprovals:1}]);
  await new Promise(resolve=>setImmediate(resolve));
  expect(native.badge).not.toHaveBeenCalled();
  expect(native.start).not.toHaveBeenCalled();
  expect(native.show).not.toHaveBeenCalled();
 });

});
