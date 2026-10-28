import { describe, expect, it } from "vitest";
import { auditTrae, auditZcode, reconstruct } from "../acceptance/lib/changelog-pagination.ts";
import { receipt, traeDocs, zcodeDocs } from "./changelog-fixtures.ts";

describe("official catalogue receipt audit", () => {
	it("reconstructs response offsets separately from remote page numbers", () => {
		const docs = [...zcodeDocs(), ...traeDocs()];
		const items = docs.flatMap(d => { const split = Math.floor(d.body.length / 2); return [receipt(d, 0, split), receipt(d, split)]; });
		expect(reconstruct(items)).toEqual(docs);
		expect(auditZcode(docs)).toMatchObject({ pages: 2, entries: 2, terminal: true });
		const result = auditTrae(docs);
		expect(result).toMatchObject({ pages: 2, entries: 11, contentBlocks: 86, declaredBlocks: 87, documentRootExcluded: true });
		expect(result.records[0]).toMatchObject({ date: "2026-10-26", version: "1.0", product: "TRAE" });
		expect(result.records[1]?.product).toBe("TRAE APP");
		expect(result.records.at(-1)?.product).toBeNull();
	});
	it("rejects missing/repeated offsets, changed content and dropped body bytes", () => {
		const d = traeDocs()[0]!;
		expect(() => reconstruct([receipt(d, 0, 100)])).toThrow("Unfinished output");
		expect(() => reconstruct([receipt(d, 0, 100), receipt(d, 101)])).toThrow("Missing or repeated");
		expect(() => reconstruct([receipt(d), receipt(d)])).toThrow("Missing or repeated");
		expect(() => reconstruct([receipt(d, 0, 100), receipt({ ...d, body: d.body + " " }, 100)])).toThrow("Document changed");
		const cut = receipt(d); cut.output = cut.output!.slice(0, -1);
		expect(() => reconstruct([cut])).toThrow("Body was truncated");
	});
	it("does not confuse an extracted response end with a catalogue end", () => {
		expect(() => auditTrae(traeDocs().slice(0, 1))).toThrow("Incomplete TRAE");
		expect(() => auditZcode(zcodeDocs().slice(0, 1))).toThrow("terminal marker");
	});
	it.each(["page", "totals", "has_more", "duplicate", "child", "count", "date"])("rejects invalid TRAE %s evidence", failure => {
		const docs = traeDocs(), last = JSON.parse(docs[1]!.body);
		if (failure === "page") last.page = 1;
		if (failure === "totals") last.total_entries++;
		if (failure === "has_more") last.has_more = true;
		if (failure === "duplicate") last.blocks[1].block_id = last.blocks[0].block_id;
		if (failure === "child") last.blocks[1].children.push("missing");
		if (failure === "count") last.blocks.pop();
		if (failure === "date") last.blocks.find((b: any) => b.text?.elements[0]?.text_run?.content === "2026-10-26").text.elements[0].text_run.content = "yesterday";
		docs[1]!.body = JSON.stringify(last);
		expect(() => auditTrae(docs)).toThrow();
	});
	it("rejects a cumulative ZCode page that changes or repeats earlier content", () => {
		const docs = zcodeDocs();
		docs[1]!.body = docs[1]!.body.replace("Release body", "Changed body");
		expect(() => auditZcode(docs)).toThrow("Conflicting cumulative");
		docs[1]!.body = docs[0]!.body.replace("Scroll to load more releases.", "You've reached the end of the release history.");
		expect(() => auditZcode(docs)).toThrow("no progress");
	});
});
