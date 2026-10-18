import { afterEach, describe, expect, it, vi } from "vitest";
import type { ObservationCursor, ObservationUpdate } from "@openbot/protocol";
import { LatestRead, observe } from "../src/shared/observation";
afterEach(() => vi.useRealTimers());
const tick = async () => {
	for (let i = 0; i < 8; i++) await Promise.resolve();
};
describe("latest snapshot read", () => {
	it("coalesces a burst and refuses a superseded snapshot", async () => {
		const first = Promise.withResolvers<string>(),
			second = Promise.withResolvers<string>();
		const read = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
			apply = vi.fn();
		const gate = new LatestRead(read, apply);
		const result = gate.request();
		for (let i = 0; i < 10000; i++) gate.request();
		expect(read).toHaveBeenCalledTimes(1);
		first.resolve("old");
		await tick();
		expect(apply).not.toHaveBeenCalled();
		expect(read).toHaveBeenCalledTimes(2);
		second.resolve("current");
		await result;
		expect(apply.mock.calls).toEqual([["current"]]);
	});
	it("drops results from a disconnected Host and permits a new generation", async () => {
		const old = Promise.withResolvers<string>();
		const apply = vi.fn();
		const read = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue("new");
		const gate = new LatestRead(read, apply);
		const result = gate.request();
		gate.reset();
		gate.request();
		old.reject(new Error("old Host disconnected"));
		await result;
		expect(apply.mock.calls).toEqual([["new"]]);
		const late = Promise.withResolvers<string>();
		read.mockReturnValue(late.promise);
		const final = gate.request();
		gate.reset();
		late.resolve("obsolete");
		await final;
		expect(apply).toHaveBeenCalledTimes(1);
	});
	it("propagates current failures and can retry", async () => {
		const apply = vi.fn(),
			read = vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue("recovered");
		const gate = new LatestRead(read, apply);
		await expect(gate.request()).rejects.toThrow("unavailable");
		await gate.request();
		expect(apply).toHaveBeenCalledWith("recovered");
	});
});
describe("desktop observation loop", () => {
	it("waits for snapshot application before granting another credit and stops cleanly", async () => {
		vi.useFakeTimers();
		const applied = Promise.withResolvers<void>(),
			next = Promise.withResolvers<ObservationUpdate>();
		const wait = vi.fn().mockResolvedValueOnce({ streamId: "one", seq: 2, changes: 15 }).mockReturnValue(next.promise);
		const changed = vi.fn().mockReturnValue(applied.promise),
			error = vi.fn();
		const stop = observe({ wait, changed, error });
		await tick();
		await vi.advanceTimersByTimeAsync(5000);
		expect(wait).toHaveBeenCalledTimes(1);
		applied.resolve();
		await tick();
		await vi.advanceTimersByTimeAsync(100);
		expect(wait.mock.calls[1]).toEqual([{ streamId: "one", seq: 2 }]);
		stop();
		next.resolve({ streamId: "one", seq: 3, changes: 1 });
		await tick();
		expect(changed).toHaveBeenCalledTimes(1);
		expect(error).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});
	it("recovers after regressed sequence or changed Host, without duplicate heartbeat refreshes", async () => {
		vi.useFakeTimers();
		const updates = [
			{ streamId: "one", seq: 3, changes: 15 },
			{ streamId: "one", seq: 3, changes: 0 },
			{ streamId: "one", seq: 2, changes: 1 },
			{ streamId: "two", seq: 0, changes: 15 },
		];
		const wait = vi.fn((_cursor?: ObservationCursor) => Promise.resolve(updates.shift() ?? { streamId: "two", seq: 0, changes: 0 }));
		const changed = vi.fn(async () => {});
		const stop = observe({ wait, changed, error: vi.fn() });
		await tick();
		await vi.advanceTimersByTimeAsync(200);
		expect(changed.mock.calls).toEqual([
			[true, 15],
			[true, 15],
		]);
		expect(wait.mock.calls[3]).toEqual([undefined]);
		stop();
		expect(vi.getTimerCount()).toBe(0);
	});
	it("backs off failures and stops a sleeping loop", async () => {
		vi.useFakeTimers();
		const error = vi.fn(),
			wait = vi.fn().mockRejectedValue(new Error("offline"));
		const stop = observe({ wait, changed: async () => {}, error });
		await tick();
		expect(error).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(999);
		expect(wait).toHaveBeenCalledTimes(1);
		stop();
		await vi.advanceTimersByTimeAsync(1000);
		expect(wait).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});
});
