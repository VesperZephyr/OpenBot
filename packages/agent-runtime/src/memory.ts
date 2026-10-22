/**
 * Bot memory: Markdown of at most `MEMORY_LIMIT_BYTES`, one value per Bot, split into `## ` sections that
 * `memory_update` edits one at a time.
 */
import { createHash } from "node:crypto";
import { defineDoc, defineDocFamily } from "@earendil-works/pi-durable";
import { MEMORY_LIMIT_BYTES, MEMORY_NOTE_LIMIT, type MemoryNote, type MemoryProvenance, type MemorySnapshot, type MemoryState, ProtocolError } from "@openbot/protocol";

export type StoredMemory<T> = T extends readonly (infer U)[] ? StoredMemory<U>[] : T extends object ? { -readonly [K in keyof T]: StoredMemory<T[K]> } : T;
export type MemoryDocument = StoredMemory<{
	content: string;
	revision?: number;
	source?: MemorySnapshot["source"];
	updatedAt?: number | null;
	restoredFrom?: number;
	history?: MemorySnapshot[];
	notes?: MemoryNote[];
}>;

/**
 * Session-scoped and keyed by `botId`: memory belongs to the Bot, not to one conversation, so any conversation the
 * Bot works in reads the same value, and a reset or fork of its conversation leaves it alone.
 */
export const MemoryDoc = defineDocFamily<MemoryDocument, null>({
	kind: "openbot.memory",
	version: 1,
	family: true,
	scope: "session",
	initial: () => ({ content: "" }),
});

export const SharedMemoryDoc = defineDoc<MemoryDocument>({
	kind: "openbot.shared-memory",
	version: 1,
	scope: "session",
	initial: () => ({ content: "" }),
});

/** Additive migration: content-only records remain readable without rewriting user data. */
export function memoryState(doc?: {
	content: string;
	revision?: number;
	source?: MemorySnapshot["source"];
	updatedAt?: number | null;
	restoredFrom?: number;
	history?: readonly MemorySnapshot[];
	notes?: readonly MemoryNote[];
}): MemoryState {
	return {
		content: doc?.content ?? "",
		revision: doc?.revision ?? 0,
		source: doc?.source ?? "legacy",
		updatedAt: doc?.updatedAt ?? null,
		...(doc?.restoredFrom === undefined ? {} : { restoredFrom: doc.restoredFrom }),
		history: doc?.history ?? [],
		notes: doc?.notes ?? importNotes(doc?.content ?? "", { kind: doc?.source ?? "legacy", at: doc?.updatedAt ?? null }),
	};
}

/** Hash-bound receipts survive history eviction; no memory contents are duplicated here. */
export const MemoryReceiptDoc = defineDocFamily<{ fingerprint?: string; revision?: number; binding?: string }, null>({
	kind: "openbot.memory-receipt",
	version: 1,
	family: true,
	scope: "session",
	initial: () => ({}),
});

export type MemoryCallContext = { readonly runId: string; readonly conversationId: string };

export function topicKey(heading: string): string {
	return heading.normalize("NFKC").trim().toLowerCase();
}

export function newNote(heading: string, content: string, source: MemoryProvenance): MemoryNote {
	const key = topicKey(heading);
	return {
		id: `note_${createHash("sha256").update(key).digest("hex").slice(0, 24)}`,
		key, heading, content, status: "active", protected: source.kind === "user" || source.kind === "restore",
		original: source, changed: source,
	};
}

/** Legacy sections retain snapshot attribution only; no inferred source messages or sharing. */
export function importNotes(content: string, source: MemoryProvenance): MemoryNote[] {
	if (!content.trim()) return [];
	const { preamble, sections } = parse(content);
	const notes = [...(preamble ? [newNote("", preamble, source)] : []), ...sections.map(s => newNote(s.heading, s.body, source))];
	if (notes.length > MEMORY_NOTE_LIMIT || new Set(notes.map(n => n.key)).size !== notes.length || notes.some(n => n.heading.length > 120))
		return [newNote("", content, source)];
	return notes;
}

export function renderNotes(notes: readonly MemoryNote[]): string {
	return notes.filter(n => n.status === "active").map(n => n.heading ? `## ${n.heading}${n.content ? `\n${n.content}` : ""}` : n.content).join("\n\n");
}

export function checkNotes(notes: readonly MemoryNote[], limit = MEMORY_LIMIT_BYTES): void {
	if (notes.length > MEMORY_NOTE_LIMIT) throw new ProtocolError("invalid_request", "Memory note limit reached. Retained corrections cannot be evicted automatically.");
	checkMemorySize(renderNotes(notes), limit);
}

/** An owner can intentionally restore a protected topic; model callers cannot. */
export function ownerNotes(state: MemoryState, content: string, source: MemoryProvenance): MemoryNote[] {
	const replacements = importNotes(content, source);
	const keys = new Set(replacements.map(n => n.key));
	const next = replacements.map(note => {
		const previous = state.notes.find(n => n.key === note.key);
		if (!previous) return note;
		if (previous.status === "active" && previous.content === note.content && previous.heading === note.heading && source.kind !== "restore") return previous;
		return { ...previous, content: note.content, heading: note.heading, status: "active" as const, protected: true, changed: source };
	});
	for (const previous of state.notes) if (!keys.has(previous.key))
		next.push(previous.status === "active" ? { ...previous, content: "", status: "forgotten", protected: true, changed: source } : previous);
	return next;
}

export function modelNotes(state: MemoryState, edit: MemoryEdit, source: MemoryProvenance, shared: MemoryState): MemoryNote[] {
	const heading = edit.section.trim().replace(/^#+\s*/, "");
	if (!heading || heading.length > 120 || /[\r\n]/.test(heading)) throw new ProtocolError("invalid_request", "Use a specific memory topic of at most 120 characters");
	const key = topicKey(heading), previous = state.notes.find(n => n.key === key);
	if (previous?.protected || shared.notes.some(n => n.key === key))
		throw new ProtocolError("invalid_request", "This memory topic is protected by an owner correction or shared scope. The owner can edit it in Memory; do not recreate it under another topic.");
	const content = edit.content.trim();
	if (edit.action === "append" && !content) throw new ProtocolError("invalid_request", "Nothing to append");
	const nextContent = edit.action === "append" && previous?.status === "active"
		? previous.content.includes(content) ? previous.content : `${previous.content}\n${content}` : content;
	const next = { ...(previous ?? newNote(heading, nextContent, source)), content: nextContent, changed: source, status: nextContent ? "active" as const : "forgotten" as const };
	return previous ? state.notes.map(n => n.id === previous.id ? next : n) : [...state.notes, next];
}

export type MemoryEdit = {
	readonly expectedRevision: number;
	readonly action: "replace" | "append";
	/** Heading text without the `## ` prefix. */
	readonly section: string;
	readonly content: string;
};

type Section = { readonly heading: string; body: string };

/**
 * Apply one section edit. `append` adds the content as a line unless the section already holds it, so replaying the
 * same call changes nothing; `replace` sets the body, and empty content removes the section. A missing section is
 * added at the end. Text before the first heading is kept.
 */
export function applyMemoryEdit(memory: string, edit: Omit<MemoryEdit, "expectedRevision">): string {
	const heading = edit.section.trim().replace(/^#+\s*/, "");
	if (heading === "") throw new ProtocolError("invalid_request", "Name the memory section to change");
	const content = edit.content.trim();
	const { preamble, sections } = parse(memory);
	const key = heading.toLowerCase();
	const index = sections.findIndex((section) => section.heading.toLowerCase() === key);
	if (edit.action === "replace") {
		if (content === "") {
			if (index >= 0) sections.splice(index, 1);
		} else if (index >= 0) {
			sections[index]!.body = content;
		} else {
			sections.push({ heading, body: content });
		}
	} else {
		if (content === "") throw new ProtocolError("invalid_request", "Nothing to append");
		const section = index >= 0 ? sections[index]! : sections[sections.push({ heading, body: "" }) - 1]!;
		if (!section.body.includes(content)) section.body = section.body === "" ? content : `${section.body}\n${content}`;
	}
	return render(preamble, sections);
}

/** Reject memory above the limit with a message the model or the user can act on. */
export function checkMemorySize(content: string, limit = MEMORY_LIMIT_BYTES): void {
	const bytes = new TextEncoder().encode(content).length;
	if (bytes > limit) {
		throw new ProtocolError(
			"invalid_request",
			`Memory is limited to ${limit / 1024} KB; this change would make it ${bytes} bytes. Shorten or remove older notes first.`,
		);
	}
}

function parse(memory: string): { preamble: string; sections: Section[] } {
	const sections: Section[] = [];
	const preamble: string[] = [];
	let current: { heading: string; lines: string[] } | undefined;
	const flush = (): void => {
		if (current !== undefined) sections.push({ heading: current.heading, body: current.lines.join("\n").trim() });
	};
	for (const line of memory.split("\n")) {
		const match = /^##\s+(.+?)\s*$/.exec(line);
		if (match !== null) {
			flush();
			current = { heading: match[1]!, lines: [] };
		} else if (current === undefined) {
			preamble.push(line);
		} else {
			current.lines.push(line);
		}
	}
	flush();
	return { preamble: preamble.join("\n").trim(), sections };
}

function render(preamble: string, sections: readonly Section[]): string {
	const blocks = sections.map((section) => (section.body === "" ? `## ${section.heading}` : `## ${section.heading}\n${section.body}`));
	return (preamble === "" ? blocks : [preamble, ...blocks]).join("\n\n");
}
