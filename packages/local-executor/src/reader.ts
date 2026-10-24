import { lstatSync, opendirSync, realpathSync } from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { READER_LIMITS as L, type FileListing, type ReaderFile } from "@openbot/protocol";
import { bytesAt, imageSize, selectedPath } from "./artifacts.ts";
import { webpSize } from "./avatars.ts";
const TEXT: Record<string, string> = {
	".md": "text/markdown",
	".markdown": "text/markdown",
	".html": "text/html",
	".htm": "text/html",
	".csv": "text/csv",
};
const CODE = new Set([
	".txt",
	".log",
	".json",
	".jsonl",
	".yaml",
	".yml",
	".xml",
	".js",
	".jsx",
	".ts",
	".tsx",
	".py",
	".rs",
	".go",
	".java",
	".c",
	".cpp",
	".h",
	".css",
	".scss",
	".sh",
	".zsh",
	".sql",
	".toml",
	".ini",
	".conf",
	".env",
]);
function workspacePath(root: string, path: string): string {
	if (isAbsolute(path) || path.includes("\0") || path.split(/[\\/]/).includes("..") || path.length > 4096)
		throw Error("Choose a file inside the workspace");
	const base = realpathSync(root),
		candidate = resolve(base, path),
		inside = relative(base, candidate);
	if (inside.startsWith(`..${sep}`) || inside === ".." || isAbsolute(inside)) throw Error("Choose a file inside the workspace");
	return selectedPath(candidate);
}
export function listReaderFiles(root: string, path: string): FileListing {
	const directory = opendirSync(workspacePath(root, path));
	const entries: FileListing["entries"][number][] = [];
	let limited = false;
	try {
		for (;;) {
			const entry = directory.readSync();
			if (!entry) break;
			if (entries.length === L.entries) {
				limited = true;
				break;
			}
			entries.push({
				name: entry.name,
				path: path ? `${path}/${entry.name}` : entry.name,
				kind: entry.isSymbolicLink() ? "unsupported" : entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "unsupported",
			});
		}
	} finally {
		directory.closeSync();
	}
	entries.sort((a, b) => (a.kind === "directory" ? 0 : 1) - (b.kind === "directory" ? 0 : 1) || a.name.localeCompare(b.name));
	return { path, entries, limited };
}
export function readWorkspaceFile(root: string, path: string): ReaderFile {
	return readSelectedFile(workspacePath(root, path));
}
export function readSelectedFile(path: string): ReaderFile {
	const safe = selectedPath(path),
		ext = extname(safe).toLowerCase(),
		name = basename(safe);
	if (!lstatSync(safe).isFile()) throw Error("Choose a regular file");
	const textType = TEXT[ext] ?? (CODE.has(ext) || !ext ? "text/plain" : undefined);
	const mediaType =
		textType ??
		(
			{
				".pdf": "application/pdf",
				".png": "image/png",
				".jpg": "image/jpeg",
				".jpeg": "image/jpeg",
				".webp": "image/webp",
				".gif": "image/gif",
			} as Record<string, string>
		)[ext];
	if (!mediaType) throw Error("Preview is not available for this file type");
	const bytes = bytesAt(safe, textType ? L.textBytes : L.bytes);
	const ref = { name, mediaType, bytes: bytes.length };
	if (textType) {
		if (bytes.includes(0)) throw Error("This file is not valid UTF-8 text");
		try {
			return { ...ref, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
		} catch {
			throw Error("This file is not valid UTF-8 text");
		}
	}
	if (mediaType === "application/pdf") {
		if (bytes.toString("ascii", 0, 5) !== "%PDF-") throw Error("This file is not a valid PDF");
	} else {
		let size: [number, number];
		if (mediaType === "image/webp") size = webpSize(bytes);
		else if (mediaType === "image/gif") {
			if (bytes.length < 10 || !["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))) throw Error("This file is not a valid image");
			size = [bytes.readUInt16LE(6), bytes.readUInt16LE(8)];
		} else size = imageSize(bytes, mediaType);
		if (!size[0] || !size[1] || size[0] > L.imageSide || size[1] > L.imageSide || size[0] * size[1] > L.imagePixels)
			throw Error("Image dimensions exceed the preview limit");
	}
	return { ...ref, base64: bytes.toString("base64") };
}
