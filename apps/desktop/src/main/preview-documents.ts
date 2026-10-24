import { randomUUID } from "node:crypto";
/** In-memory, window-owned HTML. URLs carry no filesystem authority. */
export const PREVIEW_CSP =
	"default-src https: http: data: blob:; script-src https: http: 'unsafe-inline' 'unsafe-eval'; style-src https: http: 'unsafe-inline'; img-src https: http: data: blob:; font-src https: http: data:; connect-src https: http:; frame-src https: http:; object-src 'none'; base-uri https: http:; form-action https: http:";
export class PreviewDocuments {
	readonly #documents = new Map<string, { owner: number; html: string }>();
	create(owner: number, html: unknown): string {
		if (typeof html !== "string" || Buffer.byteLength(html, "utf8") > 2 * 1024 * 1024) throw Error("HTML exceeds the preview limit");
		const owned = [...this.#documents].filter(([, value]) => value.owner === owner);
		if (owned.length >= 12) throw Error("Close a tab before opening another (12 tabs maximum).");
		const url = `preview://document/${randomUUID()}`;
		this.#documents.set(url, { owner, html });
		return url;
	}
	read(url: string, owner?: number): string | undefined {
		const parsed = URL.parse(url);
		if (!parsed || parsed.search) return;
		parsed.hash = "";
		const document = this.#documents.get(parsed.href);
		return document && (owner === undefined || document.owner === owner) ? document.html : undefined;
	}
	revoke(owner: number, url: unknown): void {
		if (typeof url === "string" && this.#documents.get(url)?.owner === owner) this.#documents.delete(url);
	}
	clear(owner: number): void {
		for (const [url, value] of this.#documents) if (value.owner === owner) this.#documents.delete(url);
	}
}
export const previewDocuments = new PreviewDocuments();
