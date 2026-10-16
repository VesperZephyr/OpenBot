import type { ConversationSnapshot } from "@openbot/protocol";
import { describe, expect, it } from "vitest";
import { Coalescer, ConversationFeed, type Timers } from "../src/index.ts";

/** Timers that fire only when the test advances the clock. */
function manualTimers(): Timers & { advance(ms: number): void; readonly pending: () => number } {
	let now = 0;
	let nextId = 0;
	const scheduled = new Map<number, { at: number; callback: () => void }>();
	return {
		setTimeout: (callback, ms) => {
			const id = ++nextId;
			scheduled.set(id, { at: now + ms, callback });
			return id;
		},
		clearTimeout: (handle) => {
			if (typeof handle === "number") scheduled.delete(handle);
		},
		advance(ms) {
			const until = now + ms;
			for (;;) {
				const due = [...scheduled].filter(([, timer]) => timer.at <= until).sort(([, a], [, b]) => a.at - b.at)[0];
				if (due === undefined) break;
				scheduled.delete(due[0]);
				now = due[1].at;
				due[1].callback();
			}
			now = until;
		},
		pending: () => scheduled.size,
	};
}

const snapshot = (botId: string, text: string): ConversationSnapshot => ({
	botId,
	items: [{ kind: "user", id: text, parts: [{ type: "text", text }] }],
	approvals: [],
});

describe("Coalescer", () => {
	it("sends the first value at once, then at most one per window, ending on the latest", () => {
		const timers = manualTimers();
		const sent: string[] = [];
		const coalescer = new Coalescer<string, string>((key, value) => sent.push(`${key}:${value}`), { windowMs: 50, timers });

		coalescer.push("a", "1");
		expect(sent).toEqual(["a:1"]);
		coalescer.push("a", "2");
		coalescer.push("a", "3");
		timers.advance(49);
		expect(sent).toEqual(["a:1"]);
		timers.advance(1);
		expect(sent).toEqual(["a:1", "a:3"]);

		// The trailing send opened a new window: a value inside it waits for that window to close.
		coalescer.push("a", "4");
		expect(sent).toEqual(["a:1", "a:3"]);
		timers.advance(50);
		expect(sent).toEqual(["a:1", "a:3", "a:4"]);

		// A window without new values closes silently; the next value after it goes out at once.
		timers.advance(50);
		expect(timers.pending()).toBe(0);
		coalescer.push("a", "5");
		expect(sent).toEqual(["a:1", "a:3", "a:4", "a:5"]);
	});

	it("keeps a separate window per key", () => {
		const timers = manualTimers();
		const sent: string[] = [];
		const coalescer = new Coalescer<string, string>((key, value) => sent.push(`${key}:${value}`), { windowMs: 50, timers });
		coalescer.push("a", "1");
		coalescer.push("b", "1");
		coalescer.push("a", "2");
		timers.advance(50);
		expect(sent).toEqual(["a:1", "b:1", "a:2"]);
	});

	it("drops a cancelled key's pending value", () => {
		const timers = manualTimers();
		const sent: string[] = [];
		const coalescer = new Coalescer<string, string>((key, value) => sent.push(`${key}:${value}`), { windowMs: 50, timers });
		coalescer.push("a", "1");
		coalescer.push("a", "2");
		coalescer.cancel("a");
		timers.advance(100);
		expect(sent).toEqual(["a:1"]);
		coalescer.push("a", "3");
		expect(sent).toEqual(["a:1", "a:3"]);
	});
});

describe("ConversationFeed", () => {
	it("delivers only the subscribed Bot's snapshots", () => {
		const timers = manualTimers();
		const delivered: string[] = [];
		const feed = new ConversationFeed({ deliver: (s) => delivered.push(`${s.botId}:${s.items[0]?.id}`), windowMs: 50, timers });

		feed.publish(snapshot("a", "1"));
		expect(delivered).toEqual([]);

		feed.subscribe("a");
		feed.publish(snapshot("a", "2"));
		feed.publish(snapshot("b", "1"));
		timers.advance(100);
		expect(delivered).toEqual(["a:2"]);

		feed.subscribe(null);
		feed.publish(snapshot("a", "3"));
		timers.advance(100);
		expect(delivered).toEqual(["a:2"]);
	});

	it("never sends a held snapshot of the previous Bot after switching", () => {
		const timers = manualTimers();
		const delivered: string[] = [];
		const feed = new ConversationFeed({ deliver: (s) => delivered.push(`${s.botId}:${s.items[0]?.id}`), windowMs: 50, timers });
		feed.subscribe("a");
		feed.publish(snapshot("a", "1"));
		feed.publish(snapshot("a", "2"));
		feed.subscribe("b");
		feed.publish(snapshot("b", "1"));
		timers.advance(100);
		expect(delivered).toEqual(["a:1", "b:1"]);

		// Switching back starts a fresh window for the Bot.
		feed.subscribe("a");
		feed.publish(snapshot("a", "3"));
		expect(delivered).toEqual(["a:1", "b:1", "a:3"]);
	});
});
