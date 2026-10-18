/** Rebuildable local search corpus. Durable transcripts remain the only source of truth. */
import { APP_MAX_RESULT_BYTES, ProtocolError, type ConversationKey, type ConversationPreview, type ConversationSearchHit, type ConversationSearchResult } from "@openbot/protocol";

type Message = ConversationPreview & { conversationKey: ConversationKey; searchText: string };
type Cursor = { fingerprint: string; at: number; conversationKey: string; messageId: string };
const compare = (a: { at: number; conversationKey: string; messageId: string }, b: { at: number; conversationKey: string; messageId: string }) =>
	b.at - a.at || lexical(a.conversationKey, b.conversationKey) || lexical(a.messageId, b.messageId);
const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export const normalizeQuery = (query: string) => query.replace(/\s+/gu, " ").trim();
const invalidCursor = () => new ProtocolError("invalid_request", "Invalid search cursor");
function decode(value: string | undefined, fingerprint: string): Cursor | undefined {
	if (!value) return;
	try {
		if (value.length > 4096) throw invalidCursor();
		const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Cursor;
		if (!cursor || Object.keys(cursor).sort().join() !== "at,conversationKey,fingerprint,messageId" || cursor.fingerprint !== fingerprint ||
			!Number.isFinite(cursor.at) || typeof cursor.conversationKey !== "string" || typeof cursor.messageId !== "string") throw invalidCursor();
		return cursor;
	} catch { throw invalidCursor(); }
}
function excerpt(message: Message, start: number, length: number): ConversationSearchHit {
	const points = Array.from(message.text);
	const matchPoint = Array.from(message.text.slice(0, start)).length;
	const first = Math.max(0, matchPoint - 48);
	const body = points.slice(first, first + 176).join("");
	const prefix = first > 0 ? "…" : "";
	const snippet = prefix + body + (first + 176 < points.length ? "…" : "");
	const matchStart = prefix.length + start - points.slice(0, first).join("").length;
	return {
		conversationKey: message.conversationKey, messageId: message.id, senderId: message.senderId, at: message.at,
		snippet, matchStart, matchEnd: Math.min(prefix.length + body.length, matchStart + length),
	};
}
export class ConversationSearchIndex {
	readonly #messages = new Map<ConversationKey, readonly Message[]>();
	/** Immutable source history only grows. Older snapshots and token-only projections are no-ops. */
	project(key: ConversationKey, messages: readonly ConversationPreview[]): void {
		const old = this.#messages.get(key) ?? [];
		if (messages.length <= old.length) return;
		this.#messages.set(key, [...old, ...messages.slice(old.length).map((m) => ({
			...m, conversationKey: key, searchText: m.text.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/gu, " ").trim(),
		}))]);
	}
	read(key: ConversationKey): readonly ConversationPreview[] {
		return (this.#messages.get(key) ?? []).map(({conversationKey: _key, searchText: _searchText, ...message}) => ({...message}));
	}
	search(query: string, eligible: ReadonlySet<string>, fingerprint: string, cursor?: string): ConversationSearchResult {
		const after = decode(cursor, fingerprint);
		if (!query) return { items: [] };
		const literal = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu");
		const candidates: ConversationSearchHit[] = [];
		for (const [key, messages] of this.#messages) {
			if (!eligible.has(key)) continue;
			for (const message of messages) {
				const order = { at: message.at, conversationKey: key, messageId: message.id };
				if (after && compare(order, after) <= 0) continue;
				if (candidates.length === 31 && compare(order, candidates[30]!) >= 0) continue;
				const match = literal.exec(message.searchText);
				if (!match) continue;
				candidates.push(excerpt({...message, text:message.searchText}, match.index, match[0].length));
				candidates.sort(compare);
				if (candidates.length > 31) candidates.pop();
			}
		}
		const items = candidates.slice(0, 30);
		const token = () => {
			const last = items.at(-1)!;
			return Buffer.from(JSON.stringify({fingerprint, at: last.at, conversationKey: last.conversationKey, messageId: last.messageId})).toString("base64url");
		};
		let nextCursor = candidates.length > items.length && items.length ? token() : undefined;
		while (Buffer.byteLength(JSON.stringify({ok:true, value:{items, ...(nextCursor ? {nextCursor} : {})}})) > APP_MAX_RESULT_BYTES) {
			items.pop();
			if (!items.length) throw new ProtocolError("invalid_request", "Search result exceeds the size limit");
			nextCursor = token();
		}
		return { items, ...(nextCursor ? {nextCursor} : {}) };
	}
}
