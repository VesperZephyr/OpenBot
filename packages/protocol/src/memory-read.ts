import type { MemoryProvenance, MemoryScope } from "./memory.ts";

export type MemoryRevisions = { readonly local: number; readonly shared?: number };
export type MemoryRef = {
	readonly version: 1; readonly botId: string; readonly conversationId: string;
	readonly scope: MemoryScope; readonly noteId: string; readonly revisions: MemoryRevisions;
};
export type MemorySearchInput = { readonly query: string };
export type MemoryReadInput = { readonly ref: MemoryRef; readonly offset?: number };
export type MemorySearchResult = {
	readonly ok: true; readonly revisions: MemoryRevisions; readonly observedAt: number;
	readonly hits: readonly { readonly ref: MemoryRef; readonly heading: string; readonly headingTruncated: boolean;
		readonly snippet: string; readonly partial: boolean; readonly source: Pick<MemoryProvenance, "kind" | "at"> }[];
	readonly truncated: boolean;
};
export type MemoryReadResult = {
	readonly ok: true; readonly ref: MemoryRef; readonly observedAt: number; readonly text: string;
	readonly complete: boolean; readonly nextOffset: number | null;
};
export type MemoryReadError = "invalid_arguments" | "unavailable" | "stale" | "cancelled" | "internal_error";
export type MemoryReadFailure = { readonly ok: false; readonly error: { readonly code: MemoryReadError; readonly message: string } };
export type MemoryReadResponse = MemorySearchResult | MemoryReadResult | MemoryReadFailure;
export const MEMORY_READ_NAMES = ["memory_search", "memory_read"] as const;
const integer = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
const id = (maxLength: number) => ({ type: "string", minLength: 1, maxLength });
export const MEMORY_REF_SCHEMA = object({ version: { const: 1 }, botId: id(256), conversationId: id(2048), scope: { enum: ["bot", "shared"] }, noteId: id(256), revisions: object({ local: integer, shared: integer }, ["local"]) });
export const MEMORY_SEARCH_SCHEMA = object({ query: { type: "string", minLength: 1, maxLength: 256 } });
export const MEMORY_READ_SCHEMA = object({ ref: MEMORY_REF_SCHEMA, offset: integer }, ["ref"]);

const record = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);
const keys = (x: Record<string, unknown>, allowed: readonly string[]) => Object.keys(x).every(k => allowed.includes(k));
const whole = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;
const string = (x: unknown, max: number): x is string => typeof x === "string" && !/[\uD800-\uDFFF]/u.test(x) && [...x].length > 0 && [...x].length <= max;
export const normalizeMemoryQuery = (x: string) => x.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
export function validMemoryRef(x: unknown): x is MemoryRef {
	return record(x) && keys(x, ["version", "botId", "conversationId", "scope", "noteId", "revisions"]) && x.version === 1 &&
		string(x.botId, 256) && string(x.conversationId, 2048) && string(x.noteId, 256) && (x.scope === "bot" || x.scope === "shared") &&
		record(x.revisions) && keys(x.revisions, ["local", "shared"]) && whole(x.revisions.local) && (!Object.hasOwn(x.revisions, "shared") || whole(x.revisions.shared)) &&
		new TextEncoder().encode(JSON.stringify(x)).length <= 4096;
}
export function validMemorySearch(x: unknown): x is MemorySearchInput {
	return record(x) && keys(x, ["query"]) && string(x.query, 256) && normalizeMemoryQuery(x.query).length > 0;
}
export function validMemoryRead(x: unknown): x is MemoryReadInput {
	return record(x) && keys(x, ["ref", "offset"]) && validMemoryRef(x.ref) && (!Object.hasOwn(x, "offset") || whole(x.offset));
}
export function memoryReadFailure(code: MemoryReadError): MemoryReadFailure {
	const messages = { invalid_arguments: "Invalid memory read arguments", unavailable: "Memory is unavailable in this context", stale: "Memory changed. Search again before reading", cancelled: "Memory read cancelled", internal_error: "Memory read could not be completed" };
	return { ok: false, error: { code, message: messages[code] } };
}
