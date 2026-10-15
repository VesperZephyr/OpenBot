/**
 * File tools. Every path is canonicalized and checked against the invocation's grants before it is opened; reads
 * refuse devices and binary files before reading them; writes go to a temporary file and are renamed into place.
 * Reads and edits report the file's SHA-256, which `local_edit` takes back as `expected_sha256` to refuse an edit of a
 * file that changed since the model last saw it.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { grantedPath } from "./paths.ts";
import { headWithin, OUTPUT_LIMITS } from "./output.ts";

const MAX_READ_FILE_BYTES = 10 * 1024 * 1024;
const MAX_LIST_ENTRIES = 500;
const SNIFF_BYTES = 4096;

export type FileContext = { readonly workspace: string; readonly grants: readonly string[] };

export async function readText(
	args: { path: string; offset?: number; limit?: number },
	context: FileContext,
): Promise<{ readonly output: string; readonly truncated: boolean }> {
	const path = await grantedPath(args.path, context.workspace, context.grants);
	const info = await stat(path);
	if (info.isDirectory()) throw new Error(`${path} is a directory; use local_list`);
	// Devices, FIFOs, and sockets can block forever or never end.
	if (!info.isFile()) throw new Error(`${path} is not a regular file`);
	if (info.size > MAX_READ_FILE_BYTES) throw new Error(`${path} is ${info.size} bytes; files over 10 MB are not read`);
	if (await looksBinary(path)) throw new Error(`${path} looks like a binary file`);

	const content = await readFile(path);
	const lines = content.toString("utf8").split("\n");
	const first = Math.max(1, args.offset ?? 1);
	const last = Math.min(lines.length, first - 1 + Math.min(args.limit ?? OUTPUT_LIMITS.lines, OUTPUT_LIMITS.lines));
	const numbered = lines
		.slice(first - 1, last)
		.map((line, index) => `${String(first + index).padStart(6)}\t${line}`)
		.join("\n");
	const bounded = headWithin(numbered, OUTPUT_LIMITS.bytes);
	const shownLast = bounded.truncated ? first - 1 + bounded.text.split("\n").filter((line) => line !== "").length : last;
	const more =
		shownLast < lines.length
			? `\n[showing lines ${first}-${shownLast} of ${lines.length}; continue with offset=${shownLast + 1}]`
			: "";
	return { output: `${bounded.text}${more}\n[sha256: ${sha256(content)}]`, truncated: bounded.truncated || more !== "" };
}

export async function listDirectory(args: { path: string }, context: FileContext): Promise<string> {
	const path = await grantedPath(args.path, context.workspace, context.grants);
	const entries = await readdir(path, { withFileTypes: true });
	const names = entries
		.map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
		.sort((a, b) => a.localeCompare(b));
	const shown = names.slice(0, MAX_LIST_ENTRIES).join("\n");
	const more = names.length > MAX_LIST_ENTRIES ? `\n[${names.length - MAX_LIST_ENTRIES} more entries not shown]` : "";
	return names.length === 0 ? `${path} is empty` : `${path}\n${shown}${more}`;
}

export async function writeText(args: { path: string; content: string }, context: FileContext): Promise<string> {
	const path = await grantedPath(args.path, context.workspace, context.grants);
	await mkdir(dirname(path), { recursive: true });
	const existed = await exists(path);
	await atomicWrite(path, args.content);
	return `${existed ? "Overwrote" : "Created"} ${path} (${Buffer.byteLength(args.content)} bytes)\n[sha256: ${sha256(Buffer.from(args.content))}]`;
}

export async function editText(
	args: { path: string; old_text: string; new_text: string; replace_all?: boolean; expected_sha256?: string },
	context: FileContext,
): Promise<string> {
	const path = await grantedPath(args.path, context.workspace, context.grants);
	if (args.old_text === "") throw new Error("old_text is empty");
	const content = await readFile(path);
	const current = sha256(content);
	if (args.expected_sha256 !== undefined && args.expected_sha256.trim().toLowerCase() !== current) {
		throw new Error(
			`${path} changed since you read it (expected sha256 ${args.expected_sha256}, now ${current}); read it again and redo the edit`,
		);
	}
	const original = content.toString("utf8");
	const matches = matchLines(original, args.old_text);
	if (matches.length === 0) throw new Error(`old_text was not found in ${path}; read the file and copy the text exactly`);
	if (matches.length > 1 && args.replace_all !== true) {
		throw new Error(
			`old_text appears ${matches.length} times in ${path}, starting on lines ${matches.join(", ")}; add surrounding lines to make it unique or set replace_all`,
		);
	}
	const updated = args.replace_all === true ? original.split(args.old_text).join(args.new_text) : original.replace(args.old_text, () => args.new_text);
	await atomicWrite(path, updated);
	const replaced = args.replace_all === true ? matches.length : 1;
	return `Edited ${path}: replaced ${replaced} occurrence${replaced === 1 ? "" : "s"}\n[sha256: ${sha256(Buffer.from(updated))}]`;
}

function sha256(content: Buffer): string {
	return createHash("sha256").update(content).digest("hex");
}

async function atomicWrite(path: string, content: string): Promise<void> {
	const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
	try {
		await writeFile(temporary, content, { flag: "wx" });
		await rename(temporary, path);
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
}

async function looksBinary(path: string): Promise<boolean> {
	const handle = await open(path, "r");
	try {
		const buffer = Buffer.alloc(SNIFF_BYTES);
		const { bytesRead } = await handle.read(buffer, 0, SNIFF_BYTES, 0);
		return buffer.subarray(0, bytesRead).includes(0);
	} finally {
		await handle.close();
	}
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

/** The 1-based line each non-overlapping occurrence of `search` starts on. */
function matchLines(text: string, search: string): number[] {
	const lines: number[] = [];
	let line = 1;
	let counted = 0;
	for (let index = text.indexOf(search); index >= 0; index = text.indexOf(search, index + search.length)) {
		for (let at = text.indexOf("\n", counted); at >= 0 && at < index; at = text.indexOf("\n", at + 1)) line += 1;
		counted = index;
		lines.push(line);
	}
	return lines;
}
