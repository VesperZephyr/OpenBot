/** Bounded immutable files; this executor-owned store is separate from Pi and disposable output spills. */
import { createHash, randomUUID } from "node:crypto";
import {
	chmodSync,
	closeSync,
	constants,
	existsSync,
	fstatSync,
	fsyncSync,
	linkSync,
	lstatSync,
	mkdirSync,
	openSync,
	readSync,
	readdirSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ARTIFACT_LIMITS as LIMITS, type ArtifactRef, type ArtifactContent } from "@openbot/protocol";
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const fail = (message: string): never => {
	throw new Error(message);
};
const idValid = (id: string) => /^artifact_[a-f0-9]{32}$/.test(id);
type StoredRef = Omit<ArtifactRef, "availability">;
type Operation = { id: string; digest: string; intent: string | null; result: string | null };
const TEXT: Record<string, string> = {
	".txt": "text/plain",
	".md": "text/markdown",
	".csv": "text/csv",
	".html": "text/html",
	".htm": "text/html",
};

/** Reject lexical traversal and symlink components before opening a native-selected file. */
export function selectedPath(path: string): string {
	if (!isAbsolute(path) || path.includes("\0") || path.split(sep).includes("..")) fail("Choose a regular file without symbolic links");
	const absolute = resolve(path);
	let current: string = sep;
	for (const part of absolute.split(sep).filter(Boolean)) {
		current = join(current, part);
		if (lstatSync(current).isSymbolicLink()) fail("Symbolic links are not supported for attachments");
	}
	return absolute;
}
export function bytesAt(path: string, max: number): Buffer {
	const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		const before = fstatSync(fd);
		if (!before.isFile()) fail("Attachments must be regular files");
		if (before.size > max) fail("Attachment exceeds the file size limit");
		const buffer = Buffer.alloc(before.size + 1);
		let count = 0;
		while (count < buffer.length) {
			const n = readSync(fd, buffer, count, buffer.length - count, null);
			if (!n) break;
			count += n;
		}
		const after = fstatSync(fd);
		if (count !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs)
			fail("The file changed while it was being imported");
		return buffer.subarray(0, count);
	} finally {
		closeSync(fd);
	}
}
export function imageSize(bytes: Buffer, type: string): [number, number] {
	if (type === "image/png") {
		if (bytes.length < 33 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || bytes.toString("ascii", 12, 16) !== "IHDR")
			fail("Unsupported or invalid image");
		return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
	}
	if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) fail("Unsupported or invalid image");
	let pos = 2;
	while (pos + 4 <= bytes.length) {
		if (bytes[pos++] !== 0xff) fail("Unsupported or invalid image");
		while (bytes[pos] === 0xff) pos++;
		const marker = bytes[pos++];
		if (marker === undefined || marker === 0xda || marker === 0xd9) break;
		const size = bytes.readUInt16BE(pos);
		if (size < 2 || pos + size > bytes.length) break;
		if ([0xc0, 0xc1, 0xc2].includes(marker)) {
			if (size < 7) break;
			return [bytes.readUInt16BE(pos + 5), bytes.readUInt16BE(pos + 3)];
		}
		pos += size;
	}
	return fail("Unsupported or invalid image");
}
function format(name: string, bytes: Buffer, source: ArtifactRef["source"]): string {
	const ext = extname(name).toLowerCase();
	if (source === "result" && ext === ".pdf") {
		if (bytes.toString("ascii", 0, 5) !== "%PDF-") fail("Invalid PDF result");
		return "application/pdf";
	}
	const text = TEXT[ext];
	if (text) {
		if (source === "input" && (text === "text/html" || bytes.length > LIMITS.textBytes)) fail("Unsupported input format or text size");
		if (bytes.includes(0)) fail("Text attachments must be UTF-8 without NUL characters");
		try {
			new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		} catch {
			fail("Text attachments must be UTF-8 without NUL characters");
		}
		return text;
	}
	const type = ext === ".png" ? "image/png" : [".jpg", ".jpeg"].includes(ext) ? "image/jpeg" : undefined;
	if (!type) fail("Unsupported attachment format");
	if (bytes.length > LIMITS.imageBytes) fail("Image exceeds the file size limit");
	const [width, height] = imageSize(bytes, type!);
	if (!width || !height || width > LIMITS.imageSide || height > LIMITS.imageSide || width * height > LIMITS.imagePixels)
		fail("Image dimensions exceed the limit");
	return type!;
}
function displayName(name: string): string {
	const clean = basename(name).replace(/[\u0000-\u001f\u007f]/g, "");
	if (!clean || Array.from(clean).length > 180) fail("Attachment name is too long or empty");
	return clean;
}

export class ArtifactStore {
	readonly directory: string;
	readonly #db: DatabaseSync;
	readonly #storageLimit: number;
	constructor(directory: string, options: { storageBytes?: number } = {}) {
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		this.directory = realpathSync(directory);
		chmodSync(this.directory, 0o700);
		this.#storageLimit = options.storageBytes ?? LIMITS.storageBytes;
		this.#db = new DatabaseSync(join(this.directory, "metadata.sqlite"));
		this.#db.exec(`pragma journal_mode=wal; pragma synchronous=full;
   create table if not exists artifacts(id text primary key, ref text not null, removed integer not null default 0);
   create table if not exists operations(id text primary key,digest text not null,intent text,result text);`);
		for (const name of ["metadata.sqlite", "metadata.sqlite-wal", "metadata.sqlite-shm"])
			if (existsSync(join(this.directory, name))) chmodSync(join(this.directory, name), 0o600);
		for (const name of readdirSync(this.directory)) if (name.endsWith(".tmp")) rmSync(join(this.directory, name), { force: true });
		for (const row of this.#db.prepare("select * from operations where result is null").all() as unknown as Operation[])
			this.#reconcile(row);
	}
	close() {
		this.#db.close();
	}
	published(invocationId: string): ArtifactRef | undefined {
		const row = this.#db.prepare("select * from operations where id=?").get(`capture:result:${invocationId}`) as Operation | undefined;
		if (!row) return;
		this.#reconcile(row);
		const complete = this.#db.prepare("select result from operations where id=?").get(row.id) as { result: string | null };
		if (!complete.result) return;
		return this.get((JSON.parse(complete.result) as ArtifactRef).artifactId);
	}
	#path(id: string): string {
		if (!idValid(id)) fail("Unknown attachment");
		return join(this.directory, id);
	}
	#row(id: string): { ref: string; removed: number } {
		this.#path(id);
		const row = this.#db.prepare("select ref,removed from artifacts where id=?").get(id) as { ref: string; removed: number } | undefined;
		if (!row) fail("Unknown attachment");
		return row!;
	}
	get(id: string): ArtifactRef {
		const row = this.#row(id);
		const ref = JSON.parse(row.ref) as StoredRef;
		if (row.removed) return { ...ref, availability: "removed" };
		try {
			const bytes = bytesAt(this.#path(id), LIMITS.resultBytes);
			return { ...ref, availability: bytes.length === ref.bytes && digest(bytes) === ref.sha256 ? "available" : "corrupt" };
		} catch {
			return { ...ref, availability: existsSync(this.#path(id)) ? "corrupt" : "missing" };
		}
	}
	list(offset: number, query: string): import("@openbot/protocol").ArtifactListing {
		const rows = this.#db.prepare("select ref from artifacts where removed=0 order by rowid desc").all() as { ref: string }[];
		const matches = rows
			.map((row) => JSON.parse(row.ref) as StoredRef)
			.filter((ref) => ref.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
		const items = matches.slice(offset, offset + 200).map((ref) => ({ ...ref, availability: "available" as const }));
		return { items, ...(offset + items.length < matches.length ? { nextOffset: offset + items.length } : {}) };
	}
	content(id: string, preview = false): ArtifactContent {
		const artifact = this.get(id);
		if (artifact.availability !== "available") return { artifact, truncated: false };
		const bytes = bytesAt(this.#path(id), LIMITS.resultBytes);
		if (digest(bytes) !== artifact.sha256) fail("Attachment content is unavailable");
		if (artifact.mediaType.startsWith("image/") || artifact.mediaType === "application/pdf")
			return { artifact, base64: bytes.toString("base64"), truncated: false };
		const truncated = preview && bytes.length > LIMITS.previewBytes;
		const text = (truncated ? bytes.subarray(0, LIMITS.previewBytes) : bytes).toString("utf8").replace(/\ufffd$/u, "");
		return { artifact, text, truncated };
	}
	capture(requestId: string, path: string, source: ArtifactRef["source"] = "input", name?: string): ArtifactRef {
		const operationId = `capture:${source}:${requestId}`,
			args = digest(JSON.stringify([path, name ?? null]));
		const previous = this.#operation(operationId, args);
		if (previous?.result) {
			const ref = JSON.parse(previous.result) as ArtifactRef;
			return this.get(ref.artifactId);
		}
		if (previous) {
			this.#reconcile(previous);
			const resolved = this.#operation(operationId, args);
			if (resolved?.result) return this.get((JSON.parse(resolved.result) as ArtifactRef).artifactId);
		}
		const safe = selectedPath(path),
			label = displayName(name ?? basename(safe));
		const bytes = bytesAt(safe, source === "input" ? LIMITS.imageBytes : LIMITS.resultBytes);
		const mediaType = format(label, bytes, source);
		const usage = this.#db.prepare("select ref,removed from artifacts").all() as { ref: string; removed: number }[];
		const used = readdirSync(this.directory)
			.filter(idValid)
			.reduce((sum, name) => sum + lstatSync(join(this.directory, name)).size, 0);
		if (usage.length >= LIMITS.records || used + bytes.length > this.#storageLimit)
			fail("Attachment storage is full. Remove a local copy before importing another file.");
		const staged = previous?.intent ? (JSON.parse(previous.intent) as { ref?: StoredRef }).ref : undefined;
		if (staged && staged.sha256 !== digest(bytes)) fail("The original attachment changed before import completed");
		const ref: StoredRef = staged ?? {
			artifactId: `artifact_${digest(operationId).slice(0, 32)}`,
			name: label,
			mediaType,
			bytes: bytes.length,
			sha256: digest(bytes),
			createdAt: Date.now(),
			source,
		};
		this.#intent(operationId, args, { action: "capture", ref });
		const target = this.#path(ref.artifactId);
		if (!existsSync(target)) this.#publish(target, bytes);
		if (digest(bytesAt(target, LIMITS.resultBytes)) !== ref.sha256) fail("Attachment recovery needs attention");
		this.#commitCapture(operationId, ref);
		return { ...ref, availability: "available" };
	}
	remove(requestId: string, id: string): null {
		const op = `remove:${requestId}`,
			args = digest(id),
			prior = this.#operation(op, args);
		if (prior?.result) return null;
		if (this.#row(id).removed) return null;
		this.#intent(op, args, { action: "remove", artifactId: id });
		rmSync(this.#path(id), { force: true });
		this.#db.prepare("update artifacts set removed=1 where id=?").run(id);
		this.#finish(op, null);
		return null;
	}
	export(requestId: string, id: string, path: string): null {
		const op = `export:${requestId}`,
			args = digest(JSON.stringify([id, path])),
			prior = this.#operation(op, args);
		if (prior?.result) return null;
		if (prior) {
			this.#reconcile(prior);
			if (this.#operation(op, args)?.result) return null;
		}
		const artifact = this.get(id);
		if (artifact.availability !== "available") fail("Attachment content is unavailable");
		if (!isAbsolute(path) || path.split(sep).includes("..") || path.includes("\0")) fail("Choose a new export filename");
		const parent = selectedPath(dirname(path));
		const target = join(parent, basename(path));
		if (existsSync(target)) fail("Export destination already exists. Choose a new filename.");
		const bytes = bytesAt(this.#path(id), LIMITS.resultBytes);
		if (digest(bytes) !== artifact.sha256) fail("Attachment content is unavailable");
		this.#intent(op, args, { action: "export", path: target, sha256: artifact.sha256 });
		this.#publish(target, bytes);
		this.#finish(op, null);
		return null;
	}
	#publish(target: string, bytes: Buffer) {
		const temporary = join(dirname(target), `.openbot-${randomUUID()}.tmp`);
		try {
			writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 });
			const fd = openSync(temporary, "r");
			try {
				fsyncSync(fd);
			} finally {
				closeSync(fd);
			}
			linkSync(temporary, target);
		} finally {
			rmSync(temporary, { force: true });
		}
	}
	#operation(id: string, args: string): Operation | undefined {
		const row = this.#db.prepare("select * from operations where id=?").get(id) as Operation | undefined;
		if (row && row.digest !== args) fail("This artifact request ID was already used for different arguments");
		return row;
	}
	#intent(id: string, args: string, intent: unknown) {
		const count = (this.#db.prepare("select count(*) as n from operations").get() as { n: number }).n;
		if (count >= 16384 && !id.startsWith("remove:") && !this.#operation(id, args)) fail("Attachment operation history is full");
		this.#db
			.prepare("insert into operations(id,digest,intent) values(?,?,?) on conflict(id) do update set intent=excluded.intent")
			.run(id, args, JSON.stringify(intent));
	}
	#finish(id: string, result: unknown) {
		this.#db.prepare("update operations set result=? where id=?").run(JSON.stringify(result), id);
	}
	#commitCapture(id: string, ref: StoredRef) {
		this.#db.exec("begin immediate");
		try {
			this.#db.prepare("insert or ignore into artifacts(id,ref) values(?,?)").run(ref.artifactId, JSON.stringify(ref));
			this.#finish(id, { ...ref, availability: "available" });
			this.#db.exec("commit");
		} catch (error) {
			this.#db.exec("rollback");
			throw error;
		}
	}
	#reconcile(row: Operation) {
		if (!row.intent) return;
		const intent = JSON.parse(row.intent) as { action: string; ref?: StoredRef; path?: string; sha256?: string; artifactId?: string };
		try {
			if (
				intent.action === "capture" &&
				intent.ref &&
				digest(bytesAt(this.#path(intent.ref.artifactId), LIMITS.resultBytes)) === intent.ref.sha256
			)
				this.#commitCapture(row.id, intent.ref);
			else if (
				intent.action === "export" &&
				intent.path &&
				digest(bytesAt(selectedPath(intent.path), LIMITS.resultBytes)) === intent.sha256
			)
				this.#finish(row.id, null);
			else if (intent.action === "remove" && intent.artifactId) {
				rmSync(this.#path(intent.artifactId), { force: true });
				this.#db.prepare("update artifacts set removed=1 where id=?").run(intent.artifactId);
				this.#finish(row.id, null);
			}
		} catch {
			/* An unresolved intent remains available for explicit reconciliation; never claim a missing effect succeeded. */
		}
	}
}
