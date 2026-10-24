import { expect, it } from "vitest";
import { PreviewDocuments, PREVIEW_CSP } from "../src/main/preview-documents";
it("uses opaque expiring URLs and only lets an owner revoke its previews", () => {
	const documents = new PreviewDocuments(),
		url = documents.create(1, "<h1>Private file</h1>");
	expect(url).toMatch(/^preview:\/\/document\/[a-f0-9-]{36}$/);
	expect(documents.read(url + "#heading")).toBe("<h1>Private file</h1>");
	expect(documents.read(url + "?path=/private")).toBeUndefined();
	documents.revoke(2, url);
	expect(documents.read(url)).toBeDefined();
	documents.revoke(1, url);
	expect(documents.read(url)).toBeUndefined();
});
it("bounds document bytes and retained documents per window, including navigation cleanup", () => {
	const documents = new PreviewDocuments(),
		first = documents.create(1, "first"),
		other = documents.create(2, "other");
	for (let i = 0; i < 4; i++) documents.create(1, String(i));
	expect(documents.read(first)).toBeUndefined();
	expect(documents.read(other)).toBe("other");
	expect(() => documents.create(1, "文".repeat(700000))).toThrow("limit");
	expect(() => documents.create(1, {})).toThrow();
	documents.clear(2);
	expect(documents.read(other)).toBeUndefined();
});
it("allows normal web resources while withholding privileged resource schemes", () => {
	expect(PREVIEW_CSP).toContain("script-src https: http:");
	expect(PREVIEW_CSP).toContain("connect-src https: http:");
	expect(PREVIEW_CSP).toContain("object-src 'none'");
	expect(PREVIEW_CSP).not.toContain("file:");
	expect(PREVIEW_CSP).not.toContain("app:");
	const documents = new PreviewDocuments(),
		url = documents.create(1, "one");
	expect(documents.read(url, 2)).toBeUndefined();
	expect(documents.read(url, 1)).toBe("one");
});
