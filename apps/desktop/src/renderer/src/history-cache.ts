import { historyPartition, type TimelinePosition, type TimelineWindow, type WindowInput } from "@openbot/protocol";

export type HistoryAnchor = { id?: string; offset: number; following: boolean };
export const historyAnchors = new Map<string, HistoryAnchor>();
const entries = new Map<string, TimelineWindow[]>();
let epoch = 0;
export const historyEpoch = () => epoch;
export const historyKey = (input: Pick<WindowInput, "conversationKey" | "deliveryId" | "occurrenceId">) => historyPartition(input);
export function saveAnchor(key: string, value: HistoryAnchor) {
	historyAnchors.delete(key);
	historyAnchors.set(key, value);
	while (historyAnchors.size > 100) historyAnchors.delete(historyAnchors.keys().next().value!);
}
export function resetHistory() {
	epoch++;
	entries.clear();
	historyAnchors.clear();
	window.dispatchEvent(new Event("openbot:history-reset"));
}
export function cachedHistory(key: string) {
	const value = entries.get(key);
	if (value) {
		entries.delete(key);
		entries.set(key, value);
	}
	return value ?? [];
}
export function cacheHistory(key: string, window: TimelineWindow, position: TimelinePosition): TimelineWindow[] {
	let pages = cachedHistory(key);
	if (position.kind !== "cursor" || pages.some((p) => p.generation !== window.generation || p.revision !== window.revision))
		pages = [window];
	else {
		pages = [...pages.filter((p) => !p.rows.some((r) => window.rows.some((n) => n.id === r.id))), window].sort(
			(a, b) => (a.rows[0]?.ordinal ?? 0) - (b.rows[0]?.ordinal ?? 0),
		);
		while (pages.length > 3) pages.splice(window === pages[0] ? pages.length - 1 : 0, 1);
	}
	entries.delete(key);
	entries.set(key, pages);
	const bytes = () => [...entries.values()].reduce((sum, p) => sum + new TextEncoder().encode(JSON.stringify(p)).byteLength, 0);
	while (entries.size > 3 || bytes() > 8 * 1024 * 1024) entries.delete(entries.keys().next().value!);
	return entries.get(key) ?? [];
}

export function historyCacheMetrics() {
	return {
		conversations: entries.size,
		windows: Math.max(0, ...[...entries.values()].map((p) => p.length)),
		rows: Math.max(0, ...[...entries.values()].map((p) => p.reduce((n, w) => n + w.rows.length, 0))),
		bytes: [...entries.values()].reduce((n, p) => n + new TextEncoder().encode(JSON.stringify(p)).byteLength, 0),
		anchors: historyAnchors.size,
	};
}
