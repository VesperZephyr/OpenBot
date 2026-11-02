import { memoryReadFailure, normalizeMemoryQuery, validMemoryRead, validMemoryRef, validMemorySearch, type MemoryNote, type MemoryState, type MemoryRef, type MemoryRevisions, type MemoryReadResponse, type MemorySearchResult } from "@openbot/protocol";

export function eligibleMemory(local: MemoryState, shared?: MemoryState): { scope: "bot" | "shared"; note: MemoryNote }[] {
	const suppressed = new Set(shared?.notes.filter(n => n.status !== "shared").map(n => n.key));
	return [
		...local.notes.filter(n => n.status === "active" && !suppressed.has(n.key)).map(note => ({ scope: "bot" as const, note })),
		...(shared?.notes.filter(n => n.status === "active").map(note => ({ scope: "shared" as const, note })) ?? []),
	];
}
export const selectiveMemory = (local: MemoryState, shared?: MemoryState) => eligibleMemory(local, shared).some(n => n.note.placement === "on-demand");
const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
type Snapshot = { botId: string; conversationId: string; local: MemoryState; shared?: MemoryState | undefined; observedAt: number };
export function retrieveMemory(snapshot: Snapshot, tool: "memory_search" | "memory_read", args: unknown): MemoryReadResponse {
	if (tool === "memory_search" ? !validMemorySearch(args) : !validMemoryRead(args)) return memoryReadFailure("invalid_arguments");
	const { local, shared, botId, conversationId, observedAt } = snapshot;
	const revisions: MemoryRevisions = { local: local.revision, ...(shared ? { shared: shared.revision } : {}) };
	if (![local.revision, ...(shared ? [shared.revision] : []), observedAt].every(n => Number.isSafeInteger(n) && n >= 0)) return memoryReadFailure("internal_error");
	const corpus = eligibleMemory(local, shared);
	const ref = (item: typeof corpus[number]): MemoryRef => ({ version: 1, botId, conversationId, scope: item.scope, noteId: item.note.id, revisions });
	if (tool === "memory_search" && validMemorySearch(args)) {
		const query = normalizeMemoryQuery(args.query);
		const matches = corpus.map(item => {
			const heading = normalizeMemoryQuery(item.note.heading);
			return { ...item, rank: heading === query ? 0 : heading.includes(query) ? 1 : normalizeMemoryQuery(item.note.content).includes(query) ? 2 : 3 };
		}).filter(item => item.rank < 3).sort((a, b) => a.rank - b.rank || (a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : a.note.id < b.note.id ? -1 : a.note.id > b.note.id ? 1 : 0));
		const hits: MemorySearchResult["hits"][number][] = [];
		const result = (truncated: boolean): MemorySearchResult => ({ ok: true, revisions, observedAt, hits, truncated });
		for (const item of matches.slice(0, 5)) {
			const reference = ref(item);
			if (!validMemoryRef(reference) || !["user", "model", "legacy", "restore"].includes(item.note.changed.kind) || (item.note.changed.at !== null && (!Number.isSafeInteger(item.note.changed.at) || item.note.changed.at < 0))) return memoryReadFailure("internal_error");
			const heading = [...item.note.heading], body = [...item.note.content];
			hits.push({ ref: reference, heading: heading.slice(0, 120).join(""), headingTruncated: heading.length > 120, snippet: body.slice(0, 256).join(""), partial: body.length > 256, source: { kind: item.note.changed.kind, at: item.note.changed.at } });
			if (size(result(false)) > 4096) { hits.pop(); break; }
		}
		return result(hits.length < matches.length);
	}
	if (!validMemoryRead(args)) return memoryReadFailure("invalid_arguments");
	const reference = args.ref;
	if (reference.botId !== botId || reference.conversationId !== conversationId ||
		(!shared && (reference.scope !== "bot" || reference.revisions.shared !== undefined)) ||
		(shared && reference.revisions.shared === undefined)) return memoryReadFailure("unavailable");
	if (reference.revisions.local !== revisions.local || reference.revisions.shared !== revisions.shared) return memoryReadFailure("stale");
	const item = corpus.find(item => item.scope === reference.scope && item.note.id === reference.noteId);
	if (!item) return memoryReadFailure("unavailable");
	const body = [...item.note.content], offset = args.offset ?? 0;
	if (offset > body.length) return memoryReadFailure("invalid_arguments");
	let end = offset, bytes = 0;
	while (end < body.length && bytes + Buffer.byteLength(body[end]!, "utf8") <= 2048) bytes += Buffer.byteLength(body[end++]!, "utf8");
	const result = () => ({ ok: true as const, ref: ref(item), observedAt, text: body.slice(offset, end).join(""), complete: end === body.length, nextOffset: end === body.length ? null : end });
	while (size(result()) > 8192 && end > offset) end--;
	if (size(result()) > 8192 || (end === offset && offset < body.length)) return memoryReadFailure("internal_error");
	return result();
}
