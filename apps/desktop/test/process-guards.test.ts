import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ignoreDetachedConsole, watchForOrphaning } from "../src/main/process-guards";

const failure = (code: string) => Object.assign(new Error(`write ${code}`), { code });

describe("ignoreDetachedConsole", () => {
	it.each(["EPIPE", "EIO"])("keeps main alive when a console stream reports %s", (code) => {
		const stdout = new EventEmitter(),
			stderr = new EventEmitter();
		ignoreDetachedConsole([stdout, stderr]);
		expect(() => stdout.emit("error", failure(code))).not.toThrow();
		expect(() => stderr.emit("error", failure(code))).not.toThrow();
	});

	it("leaves every other stream error uncaught", () => {
		const stderr = new EventEmitter();
		ignoreDetachedConsole([stderr]);
		expect(() => stderr.emit("error", failure("ENOSPC"))).toThrow("write ENOSPC");
		expect(() => stderr.emit("error", new Error("no code"))).toThrow("no code");
	});
});

describe("watchForOrphaning", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("reports once after the launcher exits and the process is re-parented", () => {
		vi.useFakeTimers();
		let parent = 4242;
		const onOrphaned = vi.fn();
		watchForOrphaning({ parentPid: () => parent, onOrphaned, intervalMs: 100 });

		vi.advanceTimersByTime(1_000);
		expect(onOrphaned).not.toHaveBeenCalled();
		parent = 1;
		vi.advanceTimersByTime(100);
		expect(onOrphaned).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(1_000);
		expect(onOrphaned).toHaveBeenCalledTimes(1);
	});

	it("stops watching when cancelled", () => {
		vi.useFakeTimers();
		let parent = 4242;
		const onOrphaned = vi.fn();
		const stop = watchForOrphaning({ parentPid: () => parent, onOrphaned, intervalMs: 100 });
		stop();
		parent = 1;
		vi.advanceTimersByTime(1_000);
		expect(onOrphaned).not.toHaveBeenCalled();
	});
});
