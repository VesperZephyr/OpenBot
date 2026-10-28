import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export type CapturedFetch = { tool: string; status: string; args: Record<string, unknown>; output?: string };
export type Document = { url: string; mode: string; body: string };
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

/** Audit model-visible B4a receipts offline; never fetch missing content on the model's behalf. */
export function reconstruct(items: readonly CapturedFetch[]): Document[] {
	const chains = new Map<string, { url: string; mode: string; hash: string; total: number; end: number; body: string }>();
	for (const item of items) {
		if (item.tool !== "web_fetch") continue;
		const url = String(item.args.url);
		if (!url.startsWith("https://zcode.z.ai/_next/changelog") && !url.startsWith("https://www.trae.cn/api/changelog")) continue;
		assert.equal(item.status, "succeeded", `Failed source: ${url}`);
		const output = item.output ?? "";
		assert(Buffer.byteLength(output) <= 48 * 1024 && output.split("\n").length <= 1900, "Output boundary exceeded");
		const range = /Characters (\d+)–(\d+) of (\d+)/.exec(output);
		const digest = /content_hash: ([a-f0-9]{64})/.exec(output)?.[1];
		assert(range && digest, "Missing B4a output coverage metadata");
		const [start, end, total] = range.slice(1).map(Number) as [number, number, number];
		assert(start >= 0 && end > start && end <= total, "Invalid output range");
		const mode = String(item.args.mode ?? "article"), key = `${url}\n${mode}`;
		const chain = chains.get(key) ?? { url, mode, hash: digest, total, end: 0, body: "" };
		assert.equal(chain.hash, digest, "Document changed between output pages");
		assert.equal(chain.total, total, "Document length changed");
		assert.equal(start, chain.end, "Missing or repeated output page");
		assert.equal(item.args.offset ?? 0, start, "Requested offset differs from delivered range");
		if (start) assert.equal(item.args.contentHash, digest, "Continuation was not content-bound");
		assert(output.includes(`document_status: ${end === total ? "end_of_extracted_document" : "partial"}`));
		assert(output.includes(`next_offset: ${end === total ? "none" : end}`));
		const separator = output.indexOf("\n\n");
		assert(separator >= 0);
		const body = output.slice(separator + 2);
		assert.equal(body.length, end - start, "Body was truncated after pagination");
		chain.end = end; chain.body += body; chains.set(key, chain);
	}
	assert(chains.size > 0, "No configured source receipts found");
	return [...chains.values()].map(c => {
		assert.equal(c.end, c.total, `Unfinished output: ${c.url}`);
		assert.equal(hash(c.body), c.hash, "Reconstructed content hash mismatch");
		return { url: c.url, mode: c.mode, body: c.body };
	});
}

export function auditZcode(documents: readonly Document[]) {
	const pages = documents.filter(d => new URL(d.url).hostname === "zcode.z.ai")
		.map(d => ({ ...d, page: Number(new URL(d.url).searchParams.get("page")) })).sort((a, b) => a.page - b.page);
	assert(pages.length > 0 && pages.length <= 8, "Missing or excessive ZCode pages");
	let previous = new Map<string, string>();
	const records: { version: string; date: string }[] = [];
	for (const [index, page] of pages.entries()) {
		assert.equal(page.page, index + 1, "Missing or repeated ZCode page");
		assert.equal(page.mode, "page", "ZCode terminal marker requires page mode");
		const terminal = page.body.includes("You've reached the end of the release history.");
		assert.equal(terminal, index === pages.length - 1, "Missing or early ZCode terminal marker");
		if (!terminal) assert(page.body.includes("Scroll to load more releases."), "Missing ZCode continuation marker");
		const content = page.body.split(/Scroll to load more releases\.|You've reached the end of the release history\./)[0]!;
		const headings = [...content.matchAll(/^(\d+\.\d+\.\d+)\s*Released ([^\n]+)\n/gm)];
		assert(headings.length > 0, "Missing ZCode version/date context");
		const current = new Map<string, string>();
		for (const [i, h] of headings.entries()) {
			const version = h[1]!, record = content.slice(h.index, headings[i + 1]?.index ?? content.length).trim();
			assert(!current.has(version), "Duplicate ZCode version");
			if (previous.has(version)) assert.equal(record, previous.get(version), "Conflicting cumulative ZCode entry");
			else records.push({ version, date: h[2]! });
			current.set(version, record);
		}
		for (const version of previous.keys()) assert(current.has(version), "Cumulative ZCode page lost an entry");
		if (index) assert(current.size > previous.size, "ZCode pagination made no progress");
		previous = current;
	}
	return { pages: pages.length, entries: records.length, terminal: true, records };
}

type Block = { block_id: string; block_type: number; parent_id?: string; children?: string[]; [key: string]: unknown };
type ApiPage = { code: number; document_id: string; page: number; page_size: number; total_pages: number; total_entries: number; total_blocks: number; has_more: boolean; blocks: Block[] };
export function auditTrae(documents: readonly Document[]) {
	const pages = documents.filter(d => new URL(d.url).hostname === "www.trae.cn" && new URL(d.url).pathname === "/api/changelog")
		.map(d => ({ url: new URL(d.url), data: JSON.parse(d.body) as ApiPage })).sort((a, b) => a.data.page - b.data.page);
	assert(pages.length > 0 && pages.length <= 16, "Missing or excessive TRAE pages");
	const first = pages[0]!.data;
	assert(typeof first.document_id === "string" && first.document_id.length > 0, "Missing document identity");
	assert.equal(Math.ceil(first.total_entries / 10), first.total_pages, "TRAE page count mismatch");
	assert.equal(pages.length, first.total_pages, "Incomplete TRAE catalogue");
	const blocks = new Map<string, Block>();
	for (const [index, { url, data }] of pages.entries()) {
		assert.equal(data.code, 0, "TRAE API error");
		assert.equal(data.page, index + 1, "Missing or repeated TRAE page");
		assert.equal(Number(url.searchParams.get("page")), data.page);
		assert.equal(Number(url.searchParams.get("page_size")), 10);
		assert.equal(data.page_size, 10);
		for (const key of ["document_id", "total_pages", "total_entries", "total_blocks"] as const) assert.equal(data[key], first[key], `TRAE ${key} changed`);
		assert.equal(data.has_more, index < pages.length - 1, "TRAE terminal metadata contradicts pagination");
		assert(Array.isArray(data.blocks) && data.blocks.length > 0);
		for (const b of data.blocks) { assert(b.block_id && !blocks.has(b.block_id), "Duplicate TRAE block ID"); blocks.set(b.block_id, b); }
	}
	// The official block count includes the document root, which these pages do not return.
	assert.equal(blocks.size + 1, first.total_blocks, "TRAE block count mismatch (including document root)");
	for (const b of blocks.values()) {
		assert(b.parent_id === first.document_id || blocks.has(b.parent_id!), "Missing TRAE parent");
		for (const id of b.children ?? []) assert(blocks.has(id), "Missing TRAE child");
	}
	function text(id: string, seen = new Set<string>()): string {
		assert(!seen.has(id), "Cyclic TRAE blocks"); seen.add(id);
		const b = blocks.get(id); assert(b, "Missing TRAE table cell");
		const value = Object.values(b).flatMap(v => v && typeof v === "object" && "elements" in v ? (v as { elements: { text_run?: { content?: string } }[] }).elements.map(e => e.text_run?.content ?? "") : []).join("");
		return value || (b.children ?? []).map(c => text(c, new Set(seen))).join("");
	}
	const records: { heading: string; date: string; version: string; product: string | null }[] = [];
	let heading: string | undefined, matched = false;
	for (const b of blocks.values()) {
		if (b.block_type === 3) { assert(heading === undefined || matched, "Release without metadata table"); heading = text(b.block_id); matched = false; }
		if (b.block_type !== 31) continue;
		assert(heading && !matched, "Unexpected TRAE metadata table");
		const table = b.table as { cells: string[]; property: { column_size: number; row_size: number } };
		const n = table.property.column_size; assert([2, 3].includes(n) && table.property.row_size === 2 && table.cells.length === n * 2, "TRAE table shape changed");
		const cells = table.cells.map(c => text(c));
		assert.deepEqual(cells.slice(0, n), n === 3 ? ["date", "version", "tag"] : ["date", "version"]);
		assert(/^\d{4}-\d{2}-\d{2}$/.test(cells[n]!), "Unexpected date precision; review explicitly");
		records.push({ heading, date: cells[n]!, version: cells[n + 1]!, product: n === 3 ? cells[n + 2]! : null }); matched = true;
	}
	assert(matched && records.length === first.total_entries, "TRAE release count mismatch");
	return { pages: pages.length, entries: records.length, contentBlocks: blocks.size, declaredBlocks: first.total_blocks, documentRootExcluded: true, terminal: true, records };
}
