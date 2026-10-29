/** Fail if production observers, application reads or desktop controls return to full snapshots. */
import { BotRuntime } from "../../packages/agent-runtime/src/index.ts";
import { HistoryClient } from "../../packages/agent-runtime/src/history-client.ts";
import { createRequire } from "node:module";
const { Harness } = await import(
	createRequire(new URL("../../packages/agent-runtime/package.json", import.meta.url)).resolve("@earendil-works/pi-durable")
);
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const snapshot = BotRuntime.prototype.snapshot;
BotRuntime.prototype.snapshot = function (botId, channel, history) {
	if (history !== "omit") throw Error("Production full history read");
	return snapshot.call(this, botId, channel, history);
};
BotRuntime.prototype.observe = async () => {
	throw Error("Production full history observer");
};
const call = HistoryClient.prototype.call;
const counters = {
	entryReads: 0,
	maxPiBatch: 0,
	windowEntryReads: [] as number[],
	rss: 0,
	calls: {} as Record<string, number>,
	maxBatchBytes: 0,
	maxBatchRecords: 0,
	maxInFlightWrites: 0,
	writes: 0,
};
const open = Harness.open;
Harness.open = async function (...args) {
	const harness = await open.apply(this, args);
	const conversation = harness.conversation;
	harness.conversation = async function (...args) {
		const value = await conversation.apply(this, args);
		if (!value) return value;
		return new Proxy(value, {
			get(target, key) {
				const member = Reflect.get(target, key);
				if (key === "entries")
					return (...params: any[]) => {
						counters.entryReads++;
						counters.maxPiBatch = Math.max(counters.maxPiBatch, params[1] ?? 0);
						return member.apply(target, params);
					};
				return typeof member === "function" ? member.bind(target) : member;
			},
		});
	};
	return harness;
};
HistoryClient.prototype.call = async function (command, signal) {
	counters.rss = Math.max(counters.rss, process.memoryUsage().rss);
	counters.calls[command.method] = (counters.calls[command.method] ?? 0) + 1;
	if (command.method === "apply") {
		counters.maxBatchBytes = Math.max(counters.maxBatchBytes, Buffer.byteLength(JSON.stringify(command)));
		counters.maxBatchRecords = Math.max(counters.maxBatchRecords, command.batch.rows.length + command.batch.messages.length);
		counters.writes++;
		counters.maxInFlightWrites = Math.max(counters.maxInFlightWrites, counters.writes);
	}
	try {
		const result = await call.call(this, command, signal);
		if (command.method === "window") {
			counters.windowEntryReads.push(counters.entryReads);
			if (process.env.OPENBOT_DATA_DIR)
				writeFileSync(join(process.env.OPENBOT_DATA_DIR, "../worker-metrics.json"), JSON.stringify(counters));
		}
		return result as never;
	} finally {
		if (command.method === "apply") counters.writes--;
	}
};
const close = BotRuntime.prototype.close;
BotRuntime.prototype.close = async function () {
	await close.call(this);
	if (process.env.OPENBOT_DATA_DIR) writeFileSync(join(process.env.OPENBOT_DATA_DIR, "../worker-metrics.json"), JSON.stringify(counters));
};
await import("../../apps/local-server/src/main.ts");
