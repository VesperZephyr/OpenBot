import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { READER_LIMITS } from "@openbot/protocol";
import { listReaderFiles, readSelectedFile, readWorkspaceFile } from "../src/reader.ts";
let root: string;
beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "openbot-reader-")));
	mkdirSync(join(root, "workspace"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const file = (name: string, body: string | Buffer) => {
	const path = join(root, "workspace", name);
	writeFileSync(path, body);
	return path;
};
it("reads complete UTF-8 documents without copying or modifying their source", () => {
	const body = "# 竞品雷达\n" + "Evidence\n".repeat(12000),
		path = file("report.md", body);
	expect(readWorkspaceFile(join(root, "workspace"), "report.md")).toEqual({
		name: "report.md",
		mediaType: "text/markdown",
		bytes: Buffer.byteLength(body),
		text: body,
	});
	expect(readFileSync(path, "utf8")).toBe(body);
	expect(readSelectedFile(file("empty.txt", ""))).toMatchObject({ text: "", bytes: 0 });
});
it("rejects traversal, absolute paths, symlinks, binary text, unknown formats and oversize files", () => {
	const workspace = join(root, "workspace");
	file("okay.txt", "hello");
	writeFileSync(join(root, "outside.txt"), "private");
	symlinkSync(root, join(workspace, "link"));
	for (const path of ["../outside.txt", "link/outside.txt", join(root, "outside.txt"), "a/../../outside.txt", "..\\outside.txt"])
		expect(() => readWorkspaceFile(workspace, path)).toThrow();
	expect(() => listReaderFiles(workspace, "link")).toThrow();
	expect(() => readSelectedFile(file("binary.txt", Buffer.from([0xff])))).toThrow("UTF-8");
	expect(() => readSelectedFile(file("nul.txt", "a\0b"))).toThrow("UTF-8");
	expect(() => readSelectedFile(file("installer.exe", "MZ"))).toThrow("file type");
	expect(() => readSelectedFile(file("large.md", Buffer.alloc(READER_LIMITS.textBytes + 1, 97)))).toThrow("size limit");
	expect(() => readSelectedFile(file("fake.pdf", "not a PDF"))).toThrow("valid PDF");
	expect(() => readSelectedFile(file("large.pdf", Buffer.alloc(READER_LIMITS.bytes + 1)))).toThrow("size limit");
});
it("bounds directory enumeration and exposes symlinks without following them", () => {
	const workspace = join(root, "workspace");
	mkdirSync(join(workspace, "folder"));
	file("note.md", "text");
	symlinkSync(root, join(workspace, "shortcut"));
	expect(listReaderFiles(workspace, "").entries).toEqual([
		{ name: "folder", path: "folder", kind: "directory" },
		{ name: "note.md", path: "note.md", kind: "file" },
		{ name: "shortcut", path: "shortcut", kind: "unsupported" },
	]);
	for (let i = 0; i < 501; i++) file(`item-${i}.txt`, "");
	expect(listReaderFiles(workspace, "")).toMatchObject({ limited: true, entries: expect.any(Array) });
	expect(listReaderFiles(workspace, "").entries).toHaveLength(500);
});
it("rejects misleading image extensions and oversized raster dimensions", () => {
	const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/2cAAAAASUVORK5CYII=", "base64");
	expect(readSelectedFile(file("pixel.png", png))).toMatchObject({ mediaType: "image/png", base64: png.toString("base64") });
	expect(() => readSelectedFile(file("fake.png", "bad"))).toThrow("image");
	png.writeUInt32BE(8193, 16);
	expect(() => readSelectedFile(file("huge.png", png))).toThrow("dimensions");
});
