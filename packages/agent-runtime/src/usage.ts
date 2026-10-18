import { defineDoc, UsageDoc, type Tx, type ConversationId, type EntryId, type UsageState } from "@earendil-works/pi-durable";
import type { UsageCounters, UsageSummary, UsageBucket } from "@openbot/protocol";
import type { StoredRun } from "./runs.ts";

type Models = UsageState["models"];
export type PriceStamp = { epoch: string; modelKey: string; source: UsageBucket["source"]; priced: boolean };
type Interval = {
	conversationId: number;
	baseline: Models;
	startEntry: number;
	endEntry?: number;
	stamp: PriceStamp;
	settled?: UsageSummary;
};
type Account = { counters: UsageCounters; usd: number; complete: boolean };
type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
export const UsageEvidenceDoc = defineDoc<Mutable<{ intervals: Record<string, Interval>; bots: Record<string, Account> }>>({
	kind: "openbot.usage-evidence",
	version: 1,
	scope: "session",
	initial: () => ({ intervals: {}, bots: {} }),
});
export type UsageCapture = { conversationId: number; stamp: PriceStamp };
export const zero = (): UsageCounters => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 });
const counters = ["input", "output", "cacheRead", "cacheWrite", "totalTokens", "reasoning", "cacheWrite1h"] as const;
const safe = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0);
export function addCounters(a: UsageCounters, b: UsageCounters): UsageCounters {
	const result = { ...a };
	for (const key of counters)
		if (a[key] !== undefined || b[key] !== undefined) Object.assign(result, { [key]: safe(a[key]) + safe(b[key]) });
	return result;
}
export function sameCounters(a: UsageCounters, b: UsageCounters): boolean {
	return counters.every((key) => safe(a[key]) === safe(b[key]));
}
export function usageSummary(models: Models, baseline: Models = {}, stamp?: PriceStamp, currentEpoch?: string): UsageSummary {
	let total = zero();
	let usd = 0;
	let complete = true;
	const rows: UsageBucket[] = [];
	for (const [modelKey, usage] of Object.entries(models)) {
		const before = Object.hasOwn(baseline, modelKey) ? baseline[modelKey] : undefined;
		const delta = Object.fromEntries(
			counters
				.filter((key) => usage[key] !== undefined || before?.[key] !== undefined)
				.map((key) => [key, Math.max(0, safe(usage[key]) - safe(before?.[key]))]),
		) as UsageCounters;
		if (!counters.some((key) => safe(delta[key]) > 0)) continue;
		const matches = stamp?.modelKey === modelKey;
		const cost = usage.cost.total - (before?.cost.total ?? 0);
		const priced = matches && stamp.priced && stamp.epoch === currentEpoch && Number.isFinite(cost) && cost >= 0;
		total = addCounters(total, delta);
		if (priced) usd += cost;
		else complete = false;
		rows.push({ ...delta, modelKey, source: matches ? stamp.source : "unknown", ...(priced ? { estimatedUsd: cost } : {}) });
	}
	return {
		...total,
		available: rows.length > 0,
		...(complete && rows.length ? { estimatedUsd: usd } : {}),
		models: rows.slice(0, 100),
		truncated: rows.length > 100,
	};
}
/** Transactional snapshots of Pi's own counters, never a second model/tool ledger. */
export async function captureUsage(tx: Tx, run: StoredRun, previous: StoredRun | undefined, capture: UsageCapture | undefined) {
	if (!capture) return;
	const doc = await tx.doc(UsageEvidenceDoc);
	const id = capture.conversationId as ConversationId;
	const current = (await tx.doc(UsageDoc, id)).models;
	const tail = (await tx.scanEntries({ conversationId: id }, 1)).items[0]?.id ?? 0;
	if (run.state === "running" && (!previous || previous.state === "queued") && !doc.intervals[run.runId]) {
		doc.intervals[run.runId] = {
			conversationId: id,
			baseline: JSON.parse(JSON.stringify(current)),
			startEntry: tail,
			stamp: capture.stamp,
		};
	}
	const interval = doc.intervals[run.runId];
	if (!interval || interval.settled || run.state === "running" || run.state === "queued") return;
	const summary = usageSummary(current, interval.baseline, interval.stamp, capture.stamp.epoch);
	interval.settled = JSON.parse(JSON.stringify(summary));
	interval.endEntry = tail;
	const account = doc.bots[run.botId] ?? { counters: zero(), usd: 0, complete: true };
	doc.bots[run.botId] = {
		counters: addCounters(account.counters, summary),
		usd: account.usd + (summary.estimatedUsd ?? 0),
		complete: account.complete && summary.estimatedUsd !== undefined,
	};
}
export async function pruneUsage(tx: Tx, retained: ReadonlySet<string>) {
	const doc = await tx.doc(UsageEvidenceDoc);
	for (const id of Object.keys(doc.intervals)) if (!retained.has(id) && doc.intervals[id]?.settled) delete doc.intervals[id];
}
export function entryBounds(interval: Interval): { minEntryId: EntryId; maxEntryId?: EntryId } {
	return {
		minEntryId: (interval.startEntry + 1) as EntryId,
		...(interval.endEntry === undefined ? {} : { maxEntryId: interval.endEntry as EntryId }),
	};
}
