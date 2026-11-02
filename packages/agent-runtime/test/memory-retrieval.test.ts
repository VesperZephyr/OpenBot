import { expect, it } from "vitest";
import { type MemoryNote, type MemoryState, validMemoryRead, validMemorySearch } from "@openbot/protocol";
import { eligibleMemory, retrieveMemory } from "../src/memory-retrieval.ts";
import { memoryState, newNote, renderNotes } from "../src/memory.ts";
import { notes, queries } from "./fixtures/memory-retrieval.ts";

const state = (notes: readonly MemoryNote[], revision = 1): MemoryState => memoryState({ notes, content: renderNotes(notes), revision });
const local = state(notes.filter(n => n.scope === "bot")), shared = state(notes.filter(n => n.scope === "shared"));
const snapshot = { botId: "a", conversationId: "1", local, shared, observedAt: 123 };
const search = (query: string, current = snapshot) => {
	const result = retrieveMemory(current, "memory_search", { query });
	if (!result.ok || !("hits" in result)) throw new Error(JSON.stringify(result));
	return result;
};

it.each(queries)("keeps literal retrieval limits explicit: %s (%s)", (query, category, expected) => {
	const ids = search(query).hits.map(h => h.ref.noteId);
	expect(ids).toEqual(/literal|absent|suppressed/.test(category) ? expected : []);
});

it("filters scope before ranking and preserves shared suppression across placement and forgetting", () => {
	expect(eligibleMemory(local, shared).map(n => n.note.id)).not.toContain("address-local");
	const group = retrieveMemory({ ...snapshot, shared: undefined }, "memory_search", { query: "Warehouse Cedar" });
	expect(group).toMatchObject({ ok: true, revisions: { local: 1 }, hits: [{ ref: { scope: "bot", noteId: "address-local", revisions: { local: 1 } } }] });
	expect(JSON.stringify(group)).not.toContain('"shared"');
	expect(search("LANTERN-61").hits).toHaveLength(0);
});

it("bounds hits, Unicode, JSON escaping and long headings without skipping higher ranked hits", () => {
	expect(search("Workshop")).toMatchObject({ truncated: true });
	expect(search("Workshop").hits).toHaveLength(5);
	const huge = state([newNote("Topic ".repeat(400), "\u0001".repeat(2400) + "😀".repeat(600), { kind: "user", at: 1 })]);
	const current = { ...snapshot, local: huge };
	const found = search("topic", current);
	expect([...found.hits[0]!.heading]).toHaveLength(120);
	expect(found.hits[0]!.headingTruncated).toBe(true);
	let offset = 0, text = "";
	for (;;) {
		const result = retrieveMemory(current, "memory_read", { ref: found.hits[0]!.ref, offset });
		if (!result.ok || !("text" in result)) throw Error("Read failed");
		expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(2048);
		expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(8192);
		text += result.text;
		if (result.complete) break;
		expect(result.nextOffset).toBeGreaterThan(offset); offset = result.nextOffset!;
	}
	expect(text).toBe(huge.notes[0]!.content);
	expect(retrieveMemory(current, "memory_read", { ref: found.hits[0]!.ref, offset: [...text].length })).toMatchObject({ text: "", complete: true, nextOffset: null });
	expect(retrieveMemory(current, "memory_read", { ref: found.hits[0]!.ref, offset: [...text].length + 1 })).toMatchObject({ error: { code: "invalid_arguments" } });
	const crowded = state(Array.from({ length: 20 }, (_, i) => newNote(`same ${i}`, "\u0001".repeat(256), { kind: "user", at: 1 })));
	const bounded = search("same", { ...snapshot, local: crowded });
	expect(bounded.truncated).toBe(true); expect(bounded.hits.length).toBeLessThan(5);
	expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThanOrEqual(4096);
});

it("validates strict refs without depending on field order and rejects stale or foreign references", () => {
	const ref = search("香港").hits[0]!.ref;
	const reordered = { revisions: { shared: 1, local: 1 }, noteId: ref.noteId, scope: ref.scope, conversationId: "1", botId: "a", version: 1 };
	expect(retrieveMemory(snapshot, "memory_read", { ref: reordered })).toMatchObject({ ok: true, text: expect.stringContaining("香港") });
	for (const extra of [{ botId: "b" }, { conversationId: "2" }, { scope: "shared" }])
		expect(retrieveMemory(snapshot, "memory_read", { ref: { ...ref, ...extra } })).toMatchObject({ error: { code: "unavailable" } });
	expect(retrieveMemory({ ...snapshot, shared: { ...shared, revision: 2 } }, "memory_read", { ref })).toMatchObject({ error: { code: "stale" } });
	expect(retrieveMemory({ ...snapshot, shared: undefined }, "memory_read", { ref })).toMatchObject({ error: { code: "unavailable" } });
	for (const args of [{ ref, extra: 1 }, { ref: { ...ref, extra: true } }, { ref: { ...ref, version: 2 } }, { ref, offset: -1 }, { ref, offset: 0.5 }]) expect(validMemoryRead(args)).toBe(false);
	for (const query of ["", " ", "x".repeat(257), "\ud800"]) expect(validMemorySearch({ query })).toBe(false);
	expect(validMemorySearch({ query: "😀".repeat(256) })).toBe(true);
	expect(validMemorySearch({ query: "coffee", botId: "b" })).toBe(false);
});

it("invalidates later chunks after either scope changes and fails corrupt canonical metadata", () => {
 const found = search("Archive labels");
 const ref = found.hits[0]!.ref;
 const first = retrieveMemory(snapshot, "memory_read", { ref });
 expect(first).toMatchObject({ complete: false, nextOffset: 2048 });
 expect(retrieveMemory({ ...snapshot, local: { ...local, revision: 2 } }, "memory_read", { ref, offset: 2048 })).toMatchObject({ error: { code: "stale" } });
 expect(retrieveMemory({ ...snapshot, shared: { ...shared, revision: 2 } }, "memory_read", { ref, offset: 2048 })).toMatchObject({ error: { code: "stale" } });
 expect(retrieveMemory({ ...snapshot, observedAt: -1 }, "memory_search", { query: "coffee" })).toMatchObject({ error: { code: "internal_error" } });
 const bad = state([newNote("Coffee", "No coffee", { kind: "user", at: Number.NaN })]);
 expect(retrieveMemory({ ...snapshot, local: bad }, "memory_search", { query: "coffee" })).toMatchObject({ error: { code: "internal_error" } });
});
