import { createHash } from "node:crypto";
import type { CapturedFetch, Document } from "../acceptance/lib/changelog-pagination.ts";
export function traePage(page: number) {
	const blocks: any[] = [];
	const entries = page === 1 ? 10 : 1;
	for (let i = 0; i < entries; i++) {
		const id = `p${page}e${i}`;
		blocks.push({ block_id: id, block_type: 3, parent_id: "root", heading1: { elements: [{ text_run: { content: `v${page}.${i}` } }] } });
		const values = page === 2 ? ["date", "version", "2026-10-26", `${page}.${i}`] : ["date", "version", "tag", "2026-10-26", `${page}.${i}`, i % 2 ? "TRAE APP" : "TRAE"];
		const cells = values.map((_, n) => `${id}c${n}`);
		blocks.push({ block_id: `${id}table`, block_type: 31, parent_id: "root", children: cells, table: { cells, property: { row_size: 2, column_size: values.length / 2 } } });
		for (const [n, value] of values.entries()) blocks.push({ block_id: cells[n], block_type: 2, parent_id: `${id}table`, text: { elements: [{ text_run: { content: value } }] } });
	}
	return { code: 0, document_id: "root", page, page_size: 10, total_pages: 2, total_entries: 11, total_blocks: 87, has_more: page === 1, blocks };
}
export const traeDocs = (): Document[] => [1, 2].map(page => ({ url: `https://www.trae.cn/api/changelog?page=${page}&page_size=10`, mode: "article", body: JSON.stringify(traePage(page)) }));
const release = (v: string) => `${v}Released Oct 26, 2026\n\n## Release v${v}\n\nRelease body 😀\n\n`;
export const zcodeDocs = (): Document[] => [1, 2].map(page => ({ url: `https://zcode.z.ai/_next/changelog?page=${page}`, mode: "page", body: release("2.0.0") + (page === 2 ? release("1.0.0") + "You've reached the end of the release history." : "Scroll to load more releases.") }));
export function receipt(document: Document, start = 0, end = document.body.length): CapturedFetch {
	const digest = createHash("sha256").update(document.body).digest("hex"), more = end < document.body.length;
	return { tool: "web_fetch", status: "succeeded", args: { url: document.url, mode: document.mode, offset: start, ...(start ? { contentHash: digest } : {}) }, output: `URL: ${document.url}\ncontent_hash: ${digest}\nCharacters ${start}–${end} of ${document.body.length}\ndocument_status: ${more ? "partial" : "end_of_extracted_document"}\nnext_offset: ${more ? end : "none"}\n\n${document.body.slice(start, end)}` };
}
