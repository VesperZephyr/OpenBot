import { createHash } from "node:crypto";
import type { Context } from "@earendil-works/chord/context";
import type { Harness } from "@earendil-works/pi-durable";
import {
	MEMORY_HISTORY_LIMIT, MEMORY_LIMIT_BYTES, SHARED_MEMORY_LIMIT_BYTES, ProtocolError,
	type MemoryNote, type MemoryNoteChange, type MemoryProvenance, type MemoryScope, type MemorySourceEvidence, type MemoryState,
} from "@openbot/protocol";
import { BotsDoc } from "./bots.ts";
import { RunsDoc } from "./runs.ts";
import {
	MemoryDoc, MemoryReceiptDoc, SharedMemoryDoc, checkMemorySize, checkNotes, memoryState, modelNotes, newNote, ownerNotes, renderNotes, topicKey,
	type MemoryCallContext, type MemoryDocument, type MemoryEdit, type StoredMemory,
} from "./memory.ts";

const copy = <T>(value: T): StoredMemory<T> => JSON.parse(JSON.stringify(value)) as StoredMemory<T>;
const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const conflict = (): never => { throw new ProtocolError("request_conflict", "Memory changed. Reload before saving your draft."); };

function commitNotes(doc: MemoryDocument, state: MemoryState, notes: readonly MemoryNote[], source: MemoryProvenance, scope: MemoryScope, restoredFrom?: number): void {
	checkNotes(notes, scope === "shared" ? SHARED_MEMORY_LIMIT_BYTES : MEMORY_LIMIT_BYTES);
	const { history, ...previous } = state;
	doc.history = copy([...history, previous].slice(-MEMORY_HISTORY_LIMIT));
	doc.notes = copy([...notes]);
	doc.content = renderNotes(notes);
	doc.revision = state.revision + 1;
	doc.source = source.kind;
	doc.updatedAt = source.at;
	delete doc.restoredFrom;
	if (restoredFrom !== undefined) doc.restoredFrom = restoredFrom;
}

/** All note, scope and receipt changes share the Host's Pi transaction. */
export class MemoryBook {
	readonly harness: Harness;
	readonly context: Context;
	constructor(harness: Harness, context: Context) { this.harness = harness; this.context = context; }

	async get(botId?: string): Promise<MemoryState> {
		if (botId !== undefined && !(await this.harness.snapshot(BotsDoc, this.context))?.bots[botId])
			throw new ProtocolError("not_found", "Unknown Bot");
		return memoryState(botId === undefined ? await this.harness.snapshot(SharedMemoryDoc, this.context) : await this.harness.snapshot(MemoryDoc, botId, this.context));
	}

	async set(botId: string | undefined, expectedRevision: number, content?: string, restoreRevision?: number): Promise<MemoryState> {
		return this.harness.commit(async tx => {
			if (botId !== undefined) {
				const bot = (await tx.doc(BotsDoc)).bots[botId];
				if (!bot || bot.status === "deleted") throw new ProtocolError("not_found", "Unknown or deleted Bot");
			}
			const doc = botId === undefined ? await tx.doc(SharedMemoryDoc) : await tx.doc(MemoryDoc, botId, null);
			const state = memoryState(doc);
			if (state.revision !== expectedRevision) conflict();
			if (restoreRevision !== undefined) {
				const previous = state.history.find(item => item.revision === restoreRevision);
				if (!previous) throw new ProtocolError("not_found", "Memory version is no longer available");
				content = previous.content;
			}
			const source: MemoryProvenance = { kind: restoreRevision === undefined ? "user" : "restore", at: Date.now(), ...(botId ? { botId } : {}) };
			checkMemorySize(content ?? "", botId === undefined ? SHARED_MEMORY_LIMIT_BYTES : MEMORY_LIMIT_BYTES);
			commitNotes(doc, state, ownerNotes(state, content ?? "", source), source, botId === undefined ? "shared" : "bot", restoreRevision);
			return copy(memoryState(doc));
		}, this.context);
	}

	async editModel(botId: string, edit: MemoryEdit, invocationId: string, call: MemoryCallContext): Promise<number> {
		// Retain the pre-B27a digest so already-committed invocations remain replayable.
		const fingerprint = digest([botId, edit.action, edit.section, edit.content, edit.expectedRevision]);
		const binding = digest([botId, call.runId, call.conversationId]);
		return this.harness.commit(async tx => {
			const receipt = await tx.doc(MemoryReceiptDoc, invocationId, null);
			if (receipt.fingerprint) {
				if (receipt.fingerprint !== fingerprint || (receipt.binding && receipt.binding !== binding))
					throw new ProtocolError("request_conflict", "Memory invocation arguments changed");
				return receipt.revision!;
			}
			const bot = (await tx.doc(BotsDoc)).bots[botId];
			if (!bot || bot.status === "deleted") throw new ProtocolError("not_found", "Unknown or deleted Bot");
			const run = (await tx.doc(RunsDoc)).runs[call.runId];
			if (!run || run.botId !== botId || run.origin !== "user" || (run.channelId && run.channelId !== "direct") ||
				run.state !== "running" || run.interruption || String(bot.conversationId) !== call.conversationId)
				throw new ProtocolError("invalid_request", "Memory learning requires an active direct user request");
			const doc = await tx.doc(MemoryDoc, botId, null), state = memoryState(doc);
			if (state.revision !== edit.expectedRevision) conflict();
			const source: MemoryProvenance = {
				kind: "model", at: Date.now(), botId, runId: run.runId, conversationId: call.conversationId, invocationId,
				requestIds: run.inputs.map(input => input.requestId).slice(-8),
			};
			commitNotes(doc, state, modelNotes(state, edit, source, memoryState(await tx.doc(SharedMemoryDoc))), source, "bot");
			receipt.fingerprint = fingerprint;
			receipt.binding = binding;
			receipt.revision = doc.revision!;
			return doc.revision!;
		}, this.context);
	}

	async change(input: MemoryNoteChange): Promise<{ local: MemoryState; shared: MemoryState }> {
		const { botId, scope, action } = input;
		const fingerprint = digest(input);
		return this.harness.commit(async tx => {
			const bot = (await tx.doc(BotsDoc)).bots[botId];
			if (!bot || bot.status === "deleted") throw new ProtocolError("not_found", "Unknown or deleted Bot");
			const localDoc = await tx.doc(MemoryDoc, botId, null), sharedDoc = await tx.doc(SharedMemoryDoc);
			const result = () => copy({ local: memoryState(localDoc), shared: memoryState(sharedDoc) });
			const receipt = await tx.doc(MemoryReceiptDoc, `owner:${input.requestId}`, null);
			if (receipt.fingerprint) {
				if (receipt.fingerprint !== fingerprint) throw new ProtocolError("request_conflict", "Memory request arguments changed");
				return result();
			}
			const doc = scope === "bot" ? localDoc : sharedDoc, state = memoryState(doc);
			if (state.revision !== input.expectedRevision) conflict();
			const source: MemoryProvenance = { kind: "user", at: Date.now(), botId };
			let notes = [...state.notes];
			if (action === "add") {
				const heading = input.heading.trim().replace(/^#+\s*/, "");
				if (!heading || heading.length > 120 || /[\r\n]/.test(heading) || !input.content.trim()) throw new ProtocolError("invalid_request", "Enter a topic and memory content");
				const existing = notes.find(n => n.key === topicKey(heading));
				if (existing?.status === "active") throw new ProtocolError("request_conflict", "This memory topic already exists. Edit the existing note.");
				const next = { ...newNote(heading, input.content.trim(), source), ...(existing ? { id: existing.id, original: existing.original } : {}) };
				notes = existing ? notes.map(n => n.id === existing.id ? next : n) : [...notes, next];
			} else {
				const note = notes.find(n => n.id === input.noteId && n.status === "active");
				if (!note) throw new ProtocolError("not_found", "Memory note is no longer active");
				if (action === "edit") {
					if (!input.content.trim()) throw new ProtocolError("invalid_request", "Enter memory content or use Forget");
					notes = notes.map(n => n.id === note.id ? { ...n, content: input.content.trim(), protected: true, changed: source } : n);
				} else {
					if (action === "share" || action === "unshare") {
						if ((action === "share") !== (scope === "bot")) throw new ProtocolError("invalid_request", "Memory scope changed. Reload the note.");
						const otherDoc = scope === "bot" ? sharedDoc : localDoc, other = memoryState(otherDoc);
						if (other.revision !== input.otherRevision) conflict();
						const existing = other.notes.find(n => n.key === note.key);
						if (existing?.status === "active") throw new ProtocolError("request_conflict", "The destination already has this memory topic. Review it before sharing.");
						const moved = { ...note, id: existing?.id ?? note.id, protected: true, changed: source };
						const next = existing ? other.notes.map(n => n.id === existing.id ? moved : n) : [...other.notes, moved];
						commitNotes(otherDoc, other, next, source, scope === "bot" ? "shared" : "bot");
					}
					notes = notes.map(n => n.id === note.id ? { ...n, content: "", status: action === "forget" ? "forgotten" : "shared", protected: true, changed: source } : n);
				}
			}
			commitNotes(doc, state, notes, source, scope);
			receipt.fingerprint = fingerprint;
			receipt.revision = doc.revision!;
			return result();
		}, this.context);
	}

	async evidence(botId: string, scope: MemoryScope, noteId: string, which: "original" | "changed"): Promise<MemorySourceEvidence> {
		await this.get(botId);
		const note = (await this.get(scope === "bot" ? botId : undefined)).notes.find(n => n.id === noteId);
		if (!note) throw new ProtocolError("not_found", "Unknown memory note");
		const source = note[which], unavailable = { source, available: false, requests: [], truncated: false };
		if (!source.runId || !source.botId || !source.requestIds) return unavailable;
		const run = (await this.harness.snapshot(RunsDoc, this.context))?.runs[source.runId];
		if (!run || run.botId !== source.botId || run.origin !== "user" || (run.channelId && run.channelId !== "direct")) return unavailable;
		const inputs = run.inputs.filter(i => source.requestIds!.includes(i.requestId));
		return {
			source, available: inputs.length > 0,
			requests: inputs.slice(-3).map(i => ({ requestId: i.requestId, text: i.text.slice(0, 2000) })),
			truncated: inputs.length > 3 || inputs.some(i => i.text.length > 2000),
		};
	}
}
