/**
 * The one output limiter every executor tool uses. The model sees at most `OUTPUT_LIMITS` of a result: a head and a
 * tail cut at line ends, with a marker between them. Output beyond the display limits is saved, within the spill quotas, to
 * `<data>/artifacts/<invocationId>.txt` (mode 0600), and the marker names that file and the line to continue from with
 * `local_read offset`. The artifacts directory is an implicit read grant for `local_read` only.
 *
 * An `OutputLog` is also a command's capture buffer. It keeps everything in memory until the output outgrows the
 * limits or the command moves to the background; later chunks append until the disk quota is reached, and only
 * roughly the last `MEMORY_TAIL_BYTES` stay in memory, older ranges are read back from the file.
 */
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readSync, rmSync, statSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";

/** What one result shows the model. */
export const OUTPUT_LIMITS = { lines: 500, bytes: 24 * 1024 } as const;
/** Recent output a running command keeps in memory once its full output goes to the artifact file. */
const MEMORY_TAIL_BYTES = 1024 * 1024;
export const SPILL_LIMITS = { fileBytes: 10 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, files: 4096 } as const;
type Budget = { bytes: number; files: number };
const budgets = new Map<string, Budget>();
function budget(directory: string): Budget {
	let value = budgets.get(directory);
	if (!value) {
		const files = existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith(".txt")) : [];
		value = { bytes: files.reduce((sum, name) => sum + statSync(join(directory, name)).size, 0), files: files.length };
		budgets.set(directory, value);
	}
	return value;
}
/** Share of the limits given to the head; the tail gets the rest, because errors usually come last. */
const HEAD_SHARE = 0.4;
/** Artifacts older than this are deleted when the executor starts. */
const ARTIFACT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const NEWLINE = 0x0a;

/** A position in a log: byte offset and the 1-based line that byte is on, numbered as `local_read` numbers lines. */
export type LogPosition = { readonly byte: number; readonly line: number };

export const LOG_START: LogPosition = { byte: 0, line: 1 };

/** Where an invocation's full output is saved. Call IDs come from model providers, so the name is sanitized. */
export function artifactPath(artifactsDirectory: string, invocationId: string): string {
	return join(artifactsDirectory, `${invocationId.replace(/[^A-Za-z0-9._-]/g, "_")}.txt`);
}

export class OutputLog {
	readonly path: string;
	/** Retained chunks: everything before the spill, the recent tail starting at byte `#tailStart` after it. */
	readonly #tail: Buffer[] = [];
	#tailBytes = 0;
	#tailStart = 0;
	#total = 0;
	#newlines = 0;
	#lastByte: number | undefined;
	#fd: number | undefined;
	#spilled = false;
	#written = 0;
	#writeError: string | undefined;

	constructor(path: string) {
		this.path = path;
	}

	/** The end of the output so far. */
	get position(): LogPosition {
		return { byte: this.#total, line: this.#newlines + 1 };
	}

	append(chunk: Buffer): void {
		if (chunk.length === 0) return;
		this.#tail.push(chunk);
		this.#tailBytes += chunk.length;
		this.#total += chunk.length;
		this.#newlines += countNewlines(chunk);
		this.#lastByte = chunk[chunk.length - 1];
		if (!this.#spilled) {
			// Past the display limits, retain bounded output on disk.
			if (this.#total > OUTPUT_LIMITS.bytes || this.#newlines >= OUTPUT_LIMITS.lines) {
				this.spill();
				this.#trim();
			}
			return;
		}
		this.#write(chunk);
		this.#trim();
	}

	#trim(): void {
		while (this.#tailBytes > MEMORY_TAIL_BYTES) {
			const first = this.#tail[0]!,
				drop = Math.min(first.length, this.#tailBytes - MEMORY_TAIL_BYTES);
			if (drop === first.length) this.#tail.shift();
			else this.#tail[0] = Buffer.from(first.subarray(drop));
			this.#tailBytes -= drop;
			this.#tailStart += drop;
		}
	}

	/** Start saving: write everything so far to the artifact file, and every later chunk as it arrives. */
	spill(): void {
		if (this.#spilled) return;
		this.#spilled = true;
		try {
			mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
			const quota = budget(dirname(this.path)),
				old = existsSync(this.path) ? statSync(this.path).size : undefined;
			if (quota.bytes >= SPILL_LIMITS.totalBytes || (old === undefined && quota.files >= SPILL_LIMITS.files))
				throw new Error("Output storage limit reached; full output was not saved");
			this.#fd = openSync(this.path, "w", 0o600);
			quota.bytes -= old ?? 0;
			if (old === undefined) quota.files++;
		} catch (error) {
			this.#writeError = errorText(error);
			return;
		}
		for (const chunk of this.#tail) this.#write(chunk);
	}

	close(): void {
		if (this.#fd === undefined) return;
		closeSync(this.#fd);
		this.#fd = undefined;
	}

	/**
	 * The output from `from` to the end, bounded by `OUTPUT_LIMITS`. When it does not fit, the log is spilled and the
	 * text is a head and a tail with a marker naming the artifact file and the first omitted line.
	 */
	render(from: LogPosition = LOG_START): { readonly text: string; readonly truncated: boolean } {
		const end = this.#total;
		if (from.byte >= end) return { text: "", truncated: false };
		const lines = this.#newlines - (from.line - 1) + (this.#lastByte === NEWLINE ? 0 : 1);
		if (end - from.byte <= OUTPUT_LIMITS.bytes && lines <= OUTPUT_LIMITS.lines) {
			return { text: decode(this.#bytes(from.byte, end)), truncated: false };
		}
		this.spill();

		const headBudget = Math.floor(OUTPUT_LIMITS.bytes * HEAD_SHARE);
		const headLines = Math.floor(OUTPUT_LIMITS.lines * HEAD_SHARE);
		const head = keepFirstLines(this.#bytes(from.byte, Math.min(end, from.byte + headBudget)), headLines);
		const headEnd = from.byte + head.length;
		const tailFrom = end - Math.min(OUTPUT_LIMITS.bytes - headBudget, end - headEnd);
		const tail = keepLastLines(this.#bytes(tailFrom, end), OUTPUT_LIMITS.lines - headLines, tailFrom > headEnd);
		const tailStart = end - tail.length;

		const omittedFrom = from.line + countNewlines(head);
		const omittedLines = this.#newlines + 1 - countNewlines(tail) - omittedFrom;
		const where =
			this.#writeError === undefined
				? `Full output: ${this.path}. Read the omitted part with local_read path="${this.path}" offset=${omittedFrom}.`
				: `The full output could not be saved: ${this.#writeError}.`;
		const marker = `[... ${Math.max(omittedLines, 1)} lines (${tailStart - headEnd} bytes) omitted. ${where}]`;
		const headText = decode(head);
		const separator = headText === "" || headText.endsWith("\n") ? "" : "\n";
		return { text: `${headText}${separator}${marker}\n${decode(tail)}`, truncated: true };
	}

	/** Bytes `[from, to)`: from memory, or read back from the artifact file once they left the in-memory tail. */
	#bytes(from: number, to: number): Buffer {
		if (from >= this.#tailStart) {
			const tail = this.#tail.length === 1 ? this.#tail[0]! : Buffer.concat(this.#tail);
			return tail.subarray(from - this.#tailStart, to - this.#tailStart);
		}
		const buffer = Buffer.alloc(to - from);
		try {
			const fd = openSync(this.path, "r");
			try {
				return buffer.subarray(0, readSync(fd, buffer, 0, buffer.length, from));
			} finally {
				closeSync(fd);
			}
		} catch {
			// The file could not be written or was removed; the marker reports a write error when there was one.
			return Buffer.alloc(0);
		}
	}

	#write(chunk: Buffer): void {
		if (this.#fd === undefined) return;
		try {
			const quota = budget(dirname(this.path));
			const allowed = Math.max(0, Math.min(chunk.length, SPILL_LIMITS.fileBytes - this.#written, SPILL_LIMITS.totalBytes - quota.bytes));
			let written = 0;
			while (written < allowed) {
				const n = writeSync(this.#fd, chunk, written, allowed - written);
				if (n === 0) throw new Error("Could not save full output");
				written += n;
				this.#written += n;
				quota.bytes += n;
			}
			if (allowed < chunk.length) this.#writeError = "Output storage limit reached; full output was not saved";
		} catch (error) {
			// A full disk must not take the executor down; the marker says the file is incomplete.
			this.#writeError = errorText(error);
			closeSync(this.#fd);
			this.#fd = undefined;
		}
	}
}

/** Bound a finished tool result: unchanged when it fits, otherwise saved to `path` and cut to a head and a tail. */
export function limitText(text: string, path: string): { readonly text: string; readonly truncated: boolean } {
	const log = new OutputLog(path);
	log.append(Buffer.from(text));
	const rendered = log.render();
	log.close();
	return rendered;
}

/** Longest prefix of `text` that fits `maxBytes` in UTF-8, cut at a line end when one is near. */
export function headWithin(text: string, maxBytes: number): { readonly text: string; readonly truncated: boolean } {
	if (Buffer.byteLength(text) <= maxBytes) return { text, truncated: false };
	const cut = decode(Buffer.from(text).subarray(0, maxBytes));
	const lastLine = cut.lastIndexOf("\n");
	return { text: lastLine > maxBytes / 2 ? cut.slice(0, lastLine + 1) : cut, truncated: true };
}

/** Delete artifacts older than the retention period; the executor runs this when it starts. */
export function pruneArtifacts(artifactsDirectory: string, now: number = Date.now()): void {
	budgets.delete(artifactsDirectory);
	let names: string[];
	try {
		names = readdirSync(artifactsDirectory);
	} catch {
		return;
	}
	for (const name of names) {
		const path = join(artifactsDirectory, name);
		try {
			if (now - statSync(path).mtimeMs > ARTIFACT_RETENTION_MS) rmSync(path, { force: true });
		} catch {
			// Gone meanwhile.
		}
	}
}

function countNewlines(buffer: Buffer): number {
	let count = 0;
	for (let index = buffer.indexOf(NEWLINE); index >= 0; index = buffer.indexOf(NEWLINE, index + 1)) count += 1;
	return count;
}

/** At most `maxLines` lines from the start, ending at a line end; a single overlong line is kept as cut. */
function keepFirstLines(buffer: Buffer, maxLines: number): Buffer {
	let end = 0;
	let lines = 0;
	for (let index = buffer.indexOf(NEWLINE); index >= 0 && lines < maxLines; index = buffer.indexOf(NEWLINE, index + 1)) {
		end = index + 1;
		lines += 1;
	}
	return end === 0 ? buffer : buffer.subarray(0, end);
}

/** At most `maxLines` lines from the end; `cut` says something precedes, so a leading partial line is dropped. */
function keepLastLines(buffer: Buffer, maxLines: number, cut: boolean): Buffer {
	const first = cut ? buffer.indexOf(NEWLINE) : -1;
	const start = first >= 0 && first < buffer.length - 1 ? first + 1 : 0;
	// `end` is just past the line being counted; a final newline ends the last line rather than starting one.
	let end = buffer[buffer.length - 1] === NEWLINE ? buffer.length - 1 : buffer.length;
	for (let lines = 1; end > start; lines += 1) {
		const newline = buffer.lastIndexOf(NEWLINE, end - 1);
		if (newline < start) break;
		if (lines === maxLines) return buffer.subarray(newline + 1);
		end = newline;
	}
	return buffer.subarray(start);
}

/** UTF-8 text of a cut buffer, without the replacement characters a cut through a character leaves at its ends. */
function decode(buffer: Buffer): string {
	return buffer
		.toString("utf8")
		.replace(/^\uFFFD/, "")
		.replace(/\uFFFD$/, "");
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
