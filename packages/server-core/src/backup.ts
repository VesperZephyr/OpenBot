/** Offline, local snapshot storage. The composition layer holds exclusive Host ownership. */
import { createHash, randomUUID } from "node:crypto";
import {
	closeSync,
	constants,
	existsSync,
	fstatSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	readdirSync,
	readSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { BackupResult } from "@openbot/protocol";

const ROOTS = ["openbot.sqlite", "executor", "attachments", "skills"] as const;
const MAX_FILES = 20_000,
	MAX_TOTAL = 2 * 1024 ** 3,
	MAX_FILE = 256 * 1024 ** 2;
const JOURNAL = ".restore-journal.json";
type FileRecord = { path: string; bytes: number; sha256: string };
type Manifest = {
	format: "openbot-backup";
	version: 1;
	machine: string;
	createdAt: string;
	producer: { application: string; protocol: number; runtime: string };
	roots: string[];
	files: FileRecord[];
};
type Journal = { version: 1; id: string; committed: boolean; original: string[] };
export type BackupOptions = {
	dataDirectory: string;
	machine: string;
	producer: Manifest["producer"];
	/** Storage owners validate their schemas and reject live process identities without starting adapters. */
	validatePayload?: (directory: string) => void;
	/** Writes a conservative lifecycle gate using the OpenBot runtime adapter, without resuming Pi. */
	pauseRestored: (database: string) => Promise<void>;
	/** Deterministic crash injection for transaction invariant tests. */
	afterReplace?: (index: number) => void;
};
function fail(message: string): never {
	throw new Error(message);
}
function safeDirectory(path: string): string {
	if (!isAbsolute(path)) fail("Choose an absolute local folder");
	const value = resolve(path);
	let at: string = sep;
	for (const part of value.split(sep).filter(Boolean)) {
		at = join(at, part);
		const stat = lstatSync(at);
		if (!stat.isDirectory() || stat.isSymbolicLink()) fail("Backup folders must not contain symbolic links");
	}
	return value;
}
function safePath(path: string): boolean {
	return (
		typeof path === "string" &&
		path.length <= 1024 &&
		!/[\\\0:]/.test(path) &&
		!isAbsolute(path) &&
		path.split("/").every((p) => p && p !== "." && p !== "..") &&
		ROOTS.includes(path.split("/")[0] as (typeof ROOTS)[number]) &&
		!/(?:-wal|-shm)$/.test(path)
	);
}
function durableJson(path: string, value: unknown): void {
	const tmp = `${path}.tmp`;
	const fd = openSync(tmp, "w", 0o600);
	try {
		writeFileSync(fd, JSON.stringify(value));
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
	renameSync(tmp, path);
	syncDirectory(dirname(path));
}
function syncDirectory(path: string): void {
	const fd = openSync(path, "r");
	try {
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}
function bytesAt(path: string): Buffer {
	const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		const before = fstatSync(fd);
		if (!before.isFile() || before.size > MAX_FILE) fail("Backup contains an unsupported or oversized file");
		const bytes = Buffer.alloc(before.size + 1);
		let n = 0;
		while (n < bytes.length) {
			const got = readSync(fd, bytes, n, bytes.length - n, null);
			if (!got) break;
			n += got;
		}
		const after = fstatSync(fd);
		if (n !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs) fail("Backup file changed while being read");
		return bytes.subarray(0, n);
	} finally {
		closeSync(fd);
	}
}
function syncTree(path: string): void {
	for (const name of readdirSync(path)) {
		const p = join(path, name);
		if (lstatSync(p).isDirectory()) syncTree(p);
		else {
			const fd = openSync(p, constants.O_RDONLY | constants.O_NOFOLLOW);
			try {
				fsyncSync(fd);
			} finally {
				closeSync(fd);
			}
		}
	}
	syncDirectory(path);
}
function sha(bytes: Buffer): string {
	return createHash("sha256").update(bytes).digest("hex");
}
function filesIn(base: string, roots: readonly string[], checkpoint = false): FileRecord[] {
	const files: FileRecord[] = [];
	const names = new Set<string>();
	let total = 0;
	let entries = 0;
	function visit(path: string): void {
		if (++entries > MAX_FILES * 2 || path.length > 1024) fail("Backup exceeds the directory limit");
		const full = join(base, path),
			stat = lstatSync(full);
		if (stat.isSymbolicLink()) fail("Symbolic links are not supported in backups");
		if (stat.isDirectory()) {
			for (const name of readdirSync(full).sort()) visit(`${path}/${name}`);
			return;
		}
		if (checkpoint && /(?:-wal|-shm)$/.test(path)) return;
		if (!safePath(path) || !stat.isFile()) fail("Backup contains an unsupported path");
		const key = path.normalize("NFC").toLowerCase();
		if (names.has(key)) fail("Backup contains colliding paths");
		names.add(key);
		const bytes = bytesAt(full);
		total += bytes.length;
		if (files.length >= MAX_FILES || total > MAX_TOTAL) fail("Backup exceeds the file or storage limit");
		files.push({ path, bytes: bytes.length, sha256: sha(bytes) });
	}
	for (const root of roots) visit(root);
	return files;
}
function databases(base: string, files: readonly FileRecord[], checkpoint = false, normalize = false): void {
	for (const file of files.filter((f) => f.path.endsWith(".sqlite"))) {
		const db = new DatabaseSync(join(base, file.path), { readOnly: !checkpoint });
		try {
			if (checkpoint) {
				const result = db.prepare("pragma wal_checkpoint(truncate)").get() as { busy: number };
				if (result.busy) fail("Database is still in use");
			}
			// Portable snapshots must not create WAL/SHM sidecars when subsequently opened read-only.
			if (normalize) db.exec("pragma journal_mode=delete");
			const checks = db.prepare("pragma quick_check").all();
			if (checks.length !== 1 || Object.values(checks[0]!)[0] !== "ok") fail("Backup database failed integrity validation");
		} finally {
			db.close();
		}
	}
}
function disjoint(a: string, b: string): boolean {
	const within = (p: string, q: string) => {
		const r = relative(p, q);
		return !r || (!r.startsWith(`..${sep}`) && r !== ".." && !isAbsolute(r));
	};
	return !within(a, b) && !within(b, a);
}

export class LocalBackups {
	readonly data: string;
	readonly options: BackupOptions;
	constructor(options: BackupOptions) {
		this.options = options;
		this.data = safeDirectory(options.dataDirectory);
	}
	#manifest(directory: string): Manifest {
		const raw = bytesAt(join(directory, "manifest.json"));
		if (raw.length > 4 * 1024 ** 2) fail("Backup manifest is too large");
		const m = JSON.parse(raw.toString()) as Manifest;
		if (m.format !== "openbot-backup" || m.version !== 1 || m.machine !== this.options.machine)
			fail("Backup format or Mac/account is incompatible");
		if (
			!m.producer ||
			m.producer.protocol !== this.options.producer.protocol ||
			m.producer.runtime !== this.options.producer.runtime ||
			typeof m.producer.application !== "string"
		)
			fail("Backup runtime is incompatible");
		if (
			!Array.isArray(m.roots) ||
			!m.roots.includes("openbot.sqlite") ||
			new Set(m.roots).size !== m.roots.length ||
			m.roots.some((r) => !ROOTS.includes(r as (typeof ROOTS)[number]))
		)
			fail("Invalid backup scope");
		if (
			!Array.isArray(m.files) ||
			m.files.length > MAX_FILES ||
			m.files.some(
				(f) =>
					!f ||
					!safePath(f.path) ||
					!Number.isSafeInteger(f.bytes) ||
					f.bytes < 0 ||
					f.bytes > MAX_FILE ||
					!/^[a-f0-9]{64}$/.test(f.sha256),
			)
		)
			fail("Invalid backup file manifest");
		if (!m.files.some((f) => f.path === "openbot.sqlite") || m.files.reduce((n, f) => n + f.bytes, 0) > MAX_TOTAL)
			fail("Invalid backup size or database");
		return m;
	}
	validate(directory: string): { manifest: Manifest; directory: string } {
		const dir = safeDirectory(directory),
			manifest = this.#manifest(dir),
			payload = safeDirectory(join(dir, "data"));
		const roots = readdirSync(payload).sort();
		if (JSON.stringify(roots) !== JSON.stringify([...manifest.roots].sort())) fail("Backup scope changed");
		const actual = filesIn(payload, roots),
			expected = [...manifest.files].sort((a, b) => a.path.localeCompare(b.path));
		actual.sort((a, b) => a.path.localeCompare(b.path));
		if (JSON.stringify(actual) !== JSON.stringify(expected)) fail("Backup contents do not match the manifest");
		databases(payload, actual);
		this.options.validatePayload?.(payload);
		return { manifest, directory: dir };
	}
	export(directory: string): BackupResult {
		const parent = safeDirectory(directory);
		if (!disjoint(this.data, parent)) fail("Choose a backup folder outside application data");
		return this.#exportTo(join(parent, `OpenBot-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.openbot-backup`));
	}
	#exportTo(destination: string): BackupResult {
		const roots = ROOTS.filter((r) => existsSync(join(this.data, r)));
		if (!roots.includes("openbot.sqlite")) fail("No OpenBot database to back up");
		// The exclusive owner has stopped both processes; checkpoint before deriving the manifest.
		databases(this.data, filesIn(this.data, roots, true), true);
		const files = filesIn(this.data, roots, true);
		mkdirSync(destination, { mode: 0o700 });
		try {
			const payload = join(destination, "data");
			mkdirSync(payload, { mode: 0o700 });
			for (const root of roots) if (lstatSync(join(this.data, root)).isDirectory()) mkdirSync(join(payload, root), { mode: 0o700 });
			for (const f of files) {
				const bytes = bytesAt(join(this.data, f.path));
				if (sha(bytes) !== f.sha256) fail("Application data changed during backup");
				const to = join(payload, f.path);
				mkdirSync(dirname(to), { recursive: true, mode: 0o700 });
				const fd = openSync(to, "wx", 0o600);
				try {
					writeFileSync(fd, bytes);
					fsyncSync(fd);
				} finally {
					closeSync(fd);
				}
			}
			databases(payload, files, true, true);
			const snapshotFiles = filesIn(payload, roots);
			durableJson(join(destination, "manifest.json"), {
				format: "openbot-backup",
				version: 1,
				machine: this.options.machine,
				createdAt: new Date().toISOString(),
				producer: this.options.producer,
				roots,
				files: snapshotFiles,
			} satisfies Manifest);
			syncTree(destination);
			syncDirectory(dirname(destination));
			this.validate(destination);
			return { action: "export", path: destination, files: snapshotFiles.length, bytes: snapshotFiles.reduce((n, f) => n + f.bytes, 0) };
		} catch (error) {
			rmSync(destination, { recursive: true, force: true });
			throw error;
		}
	}
	async restore(directory: string): Promise<BackupResult> {
		if (!disjoint(this.data, resolve(directory))) fail("Choose a backup outside application data");
		this.recover();
		const { manifest, directory: source } = this.validate(directory);
		const id = randomUUID(),
			transaction = join(this.data, `.restore-${id}`),
			staged = join(transaction, "staged"),
			old = join(transaction, "old");
		mkdirSync(staged, { recursive: true, mode: 0o700 });
		mkdirSync(old, { mode: 0o700 });
		let journalWritten = false;
		try {
			for (const root of manifest.roots)
				if (lstatSync(join(source, "data", root)).isDirectory()) mkdirSync(join(staged, root), { mode: 0o700 });
			for (const f of manifest.files) {
				const from = join(source, "data", f.path);
				safeDirectory(dirname(from));
				const bytes = bytesAt(from);
				if (bytes.length !== f.bytes || sha(bytes) !== f.sha256) fail("Selected backup changed");
				const to = join(staged, f.path);
				mkdirSync(dirname(to), { recursive: true, mode: 0o700 });
				writeFileSync(to, bytes, { mode: 0o600, flag: "wx" });
			}
			databases(staged, manifest.files);
			await this.options.pauseRestored(join(staged, "openbot.sqlite"));
			databases(staged, filesIn(staged, manifest.roots, true), true, true);
			syncTree(staged);
			syncDirectory(transaction);
			const original = ROOTS.filter((r) => existsSync(join(this.data, r)));
			let rollbackPath: string | undefined;
			if (original.includes("openbot.sqlite")) {
				const parent = join(dirname(this.data), "OpenBot recovery backups");
				mkdirSync(parent, { recursive: true, mode: 0o700 });
				safeDirectory(parent);
				syncDirectory(dirname(parent));
				rollbackPath = this.#exportTo(join(parent, `before-restore-${id}.openbot-backup`)).path;
			}
			const journal: Journal = { version: 1, id, committed: false, original };
			durableJson(join(this.data, JOURNAL), journal);
			journalWritten = true;
			for (const [index, root] of ROOTS.entries()) {
				if (existsSync(join(this.data, root))) renameSync(join(this.data, root), join(old, root));
				if (existsSync(join(staged, root))) renameSync(join(staged, root), join(this.data, root));
				syncDirectory(this.data);
				syncDirectory(old);
				syncDirectory(staged);
				this.options.afterReplace?.(index);
			}
			durableJson(join(this.data, JOURNAL), { ...journal, committed: true });
			this.recover();
			return {
				action: "restore",
				path: source,
				...(rollbackPath ? { rollbackPath } : {}),
				files: manifest.files.length,
				bytes: manifest.files.reduce((n, f) => n + f.bytes, 0),
			};
		} catch (error) {
			if (journalWritten) this.recover();
			else rmSync(transaction, { recursive: true, force: true });
			throw error;
		}
	}
	recover(): BackupResult {
		const path = join(this.data, JOURNAL);
		if (!existsSync(path)) return { action: "recover", files: 0, bytes: 0 };
		const j = JSON.parse(bytesAt(path).toString()) as Journal;
		if (
			j.version !== 1 ||
			!/^[a-f0-9-]{36}$/.test(j.id) ||
			typeof j.committed !== "boolean" ||
			!Array.isArray(j.original) ||
			j.original.some((r) => !ROOTS.includes(r as (typeof ROOTS)[number]))
		)
			fail("Restore journal is invalid; keep the application stopped");
		const transaction = safeDirectory(join(this.data, `.restore-${j.id}`)),
			old = safeDirectory(join(transaction, "old"));
		if (!j.committed)
			for (const root of ROOTS) {
				const previous = join(old, root),
					current = join(this.data, root);
				if (existsSync(previous)) {
					rmSync(current, { recursive: true, force: true });
					renameSync(previous, current);
				} else if (!j.original.includes(root)) rmSync(current, { recursive: true, force: true });
			}
		syncDirectory(this.data);
		rmSync(path);
		syncDirectory(this.data);
		rmSync(transaction, { recursive: true, force: true });
		return { action: "recover", files: 0, bytes: 0 };
	}
}
