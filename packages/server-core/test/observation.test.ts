import { afterEach, describe, expect, it, vi } from "vitest";
import { Observation } from "../src/observation.ts";

afterEach(() => vi.useRealTimers());
describe("bounded observation credit", () => {
	it("coalesces ten thousand changes and returns only changed topics", async () => {
		const observation = new Observation();
		const first = observation.cursor;
		for (let i = 0; i < 10000; i++) observation.changed(i % 2 ? 1 : 4);
		const update = await observation.wait(first);
		expect(update).toMatchObject({ seq: 10000, changes: 5 });
		expect(Buffer.byteLength(JSON.stringify(update))).toBeLessThan(192);
		expect(Object.keys(update).sort()).toEqual(["changes", "seq", "streamId"]);
		expect(await observation.wait(update, 0)).toMatchObject({ seq: 10000, changes: 0 });
		observation.changed(2);
		expect(await observation.wait(update)).toMatchObject({ seq: 10001, changes: 2 });
	});
	it("requires snapshots for missing, old-stream and ahead cursors", async () => {
		const observation = new Observation();
		for (const cursor of [undefined, { streamId: "previous", seq: 0 }, { ...observation.cursor, seq: 1 }])
			expect(await observation.wait(cursor)).toMatchObject({ seq: 0, changes: 15 });
	});
	it("caps pending waits, releases credit, and cancels all timers on shutdown", async () => {
		vi.useFakeTimers();
		const observation = new Observation();
		const waits = Array.from({ length: 4 }, () => observation.wait(observation.cursor));
		await expect(observation.wait(observation.cursor)).rejects.toMatchObject({ code: "invalid_request" });
		expect(vi.getTimerCount()).toBe(4);
		observation.changed(8);
		expect((await Promise.all(waits)).map((update) => update.changes)).toEqual([8, 8, 8, 8]);
		expect(vi.getTimerCount()).toBe(0);
		const last = observation.wait(observation.cursor);
		observation.close();
		expect((await last).changes).toBe(0);
		expect(vi.getTimerCount()).toBe(0);
		observation.changed();
		expect((await observation.wait(observation.cursor)).seq).toBe(1);
	});
	it("times out with a heartbeat and accepts the next credit", async () => {
		vi.useFakeTimers();
		const observation = new Observation();
		const wait = observation.wait(observation.cursor, 100);
		await vi.advanceTimersByTimeAsync(100);
		expect((await wait).changes).toBe(0);
		const next = observation.wait(observation.cursor);
		observation.changed(1);
		expect((await next).changes).toBe(1);
		expect(vi.getTimerCount()).toBe(0);
	});
});
