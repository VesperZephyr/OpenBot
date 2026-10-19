/** Executor-owned version store and verified SKILL.md projection; never executes skill contents. */
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
	readFileSync,
	realpathSync,
	renameSync,
	unlinkSync,
	writeFileSync,
	chmodSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
	SKILL_LIMITS,
	renderSkill,
	validSkillOperation,
	type SkillChange,
	type SkillDetail,
	type SkillSummary,
	type SkillVersion,
} from "@openbot/protocol";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const canonical = (value: unknown): string =>
	value && typeof value === "object" && !Array.isArray(value)
		? `{${Object.entries(value)
				.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
				.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
				.join(",")}}`
		: JSON.stringify(value);
type Receipt = { id: string; digest: string; previous: string | null; planned: string; result: string | null };
export class SkillStore {
	readonly directory: string;
	readonly #db: DatabaseSync;
	constructor(directory: string) {
		if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) throw new Error("Skill library cannot be a symbolic link");
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		this.directory = realpathSync(directory);
		chmodSync(this.directory, 0o700);
		const database = join(this.directory, "metadata.sqlite");
		for (const suffix of ["", "-wal", "-shm"])
			if (existsSync(database + suffix) && !lstatSync(database + suffix).isFile()) throw new Error("Invalid skill metadata storage");
		this.#db = new DatabaseSync(database);
		this.#db.exec(`pragma journal_mode=wal; pragma synchronous=full;
   create table if not exists versions(name text not null,revision integer not null,value text not null,primary key(name,revision));
   create table if not exists mutations(id text primary key,digest text not null,previous text,planned text not null,result text);`);
		for (const suffix of ["", "-wal", "-shm"]) if (existsSync(database + suffix)) chmodSync(database + suffix, 0o600);
		for (const row of this.#db.prepare("select * from mutations where result is null").all() as unknown as Receipt[])
			try {
				this.#finish(row);
			} catch {
				/* Preserve unknown projections for explicit repair, never overwrite them. */
			}
	}
	close() {
		this.#db.close();
	}
	#latest(name: string): SkillVersion | undefined {
		const row = this.#db.prepare("select value from versions where name=? order by revision desc limit 1").get(name) as
			| { value: string }
			| undefined;
		return row ? JSON.parse(row.value) : undefined;
	}
	#pending(name: string): boolean {
		return (this.#db.prepare("select planned from mutations where result is null").all() as unknown as { planned: string }[]).some(
			(row) => (JSON.parse(row.planned) as SkillVersion).name === name,
		);
	}
	#bytes(name: string): string | null {
		const dir = join(this.directory, name);
		if (!existsSync(dir)) return null;
		if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink()) throw new Error("Skill directory is unavailable");
		const path = join(dir, "SKILL.md");
		let fd: number;
		try {
			fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw new Error("Skill file is unavailable");
		}
		try {
			const stat = fstatSync(fd);
			if (!stat.isFile() || stat.size > SKILL_LIMITS.bytes) throw new Error("Skill file is unavailable");
			const bytes = readFileSync(fd);
			if (bytes.length > SKILL_LIMITS.bytes) throw new Error("Skill file is unavailable");
			return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		} finally {
			closeSync(fd);
		}
	}
	#available(version: SkillVersion): boolean {
		try {
			return !this.#pending(version.name) && this.#bytes(version.name) === (version.deleted ? null : version.markdown);
		} catch {
			return false;
		}
	}
	#summary(v: SkillVersion): SkillSummary {
		return {
			name: v.name,
			revision: v.revision,
			sha256: v.sha256,
			description: v.description,
			updatedAt: v.updatedAt,
			deleted: v.deleted,
			available: v.available,
		};
	}
	list(): SkillSummary[] {
		const rows = this.#db
			.prepare("select value from versions v where revision=(select max(revision) from versions where name=v.name) order by name")
			.all() as unknown as { value: string }[];
		return rows.map((row) => {
			const v = JSON.parse(row.value) as SkillVersion;
			return this.#summary({ ...v, available: this.#available(v) });
		});
	}
	get(name: string, revision?: number): SkillDetail {
		if (!validSkillOperation({ action: "get", name, ...(revision === undefined ? {} : { revision }) }))
			throw new Error("Invalid skill reference");
		const latest = this.#latest(name);
		if (!latest) throw new Error("Skill does not exist");
		const row =
			revision === undefined
				? latest
				: (this.#db.prepare("select value from versions where name=? and revision=?").get(name, revision) as { value: string } | undefined);
		if (!row) throw new Error("Skill revision does not exist");
		const v = "value" in row ? (JSON.parse(row.value) as SkillVersion) : row;
		const history = (
			this.#db
				.prepare("select value from versions where name=? order by revision desc limit ?")
				.all(name, SKILL_LIMITS.history) as unknown as { value: string }[]
		).map((row) => this.#summary(JSON.parse(row.value)));
		return { current: { ...v, available: this.#available(latest) && !latest.deleted }, history };
	}
	pendingRequest(id: string): boolean {
		return !!this.#db.prepare("select id from mutations where id=? and result is null").get(id);
	}
	receipt(id: string, change: SkillChange): SkillVersion | undefined {
		const row = this.#db.prepare("select * from mutations where id=?").get(id) as Receipt | undefined;
		if (!row) return;
		if (row.digest !== hash(canonical(change))) throw new Error("Skill request identity conflicts with an earlier request");
		this.#finish(row);
		const done = this.#db.prepare("select result from mutations where id=?").get(id) as { result: string };
		return JSON.parse(done.result);
	}
	change(id: string, change: SkillChange): SkillVersion {
		if (typeof id !== "string" || !id || id.length > 2048 || !validSkillOperation(change)) throw new Error("Invalid skill change");
		const prior = this.receipt(id, change);
		if (prior) return prior;
		if (this.#pending(change.name)) throw new Error("An earlier skill change needs reconciliation");
		const previous = this.#latest(change.name);
		if ((previous?.revision ?? 0) !== change.expectedRevision) throw new Error("Skill changed; reload and review the current revision");
		if (change.action === "delete" && (!previous || previous.deleted)) throw new Error("Skill is already deleted or unavailable");
		if (previous && !this.#available(previous))
			throw new Error("Skill file changed outside OpenBot; restore the reviewed file before editing");
		if (!previous && this.#bytes(change.name) !== null) throw new Error("An unreviewed skill file already exists");
		const count = (table: string) => Number((this.#db.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n);
		if (count("versions") >= SKILL_LIMITS.revisions || count("mutations") >= SKILL_LIMITS.receipts)
			throw new Error("Skill history capacity reached; export and review library maintenance before saving");
		if (change.action === "save" && (!previous || previous.deleted) && this.list().filter((s) => !s.deleted).length >= SKILL_LIMITS.active)
			throw new Error("Skill library is full; delete an unused skill first");
		const document = change.action === "save" ? change.document : previous!.document,
			markdown = renderSkill(document);
		const planned: SkillVersion = {
			name: change.name,
			revision: change.expectedRevision + 1,
			sha256: hash(markdown),
			description: document.description,
			document,
			markdown,
			updatedAt: Date.now(),
			deleted: change.action === "delete",
			available: true,
		};
		const row: Receipt = {
			id,
			digest: hash(canonical(change)),
			previous: previous ? JSON.stringify(previous) : null,
			planned: JSON.stringify(planned),
			result: null,
		};
		this.#db.prepare("insert into mutations values(?,?,?,?,null)").run(id, row.digest, row.previous, row.planned);
		this.#finish(row);
		return planned;
	}
	#finish(row: Receipt): void {
		if (row.result) return;
		const planned = JSON.parse(row.planned) as SkillVersion,
			previous = row.previous ? (JSON.parse(row.previous) as SkillVersion) : undefined;
		const old = previous && !previous.deleted ? previous.markdown : null,
			next = planned.deleted ? null : planned.markdown,
			current = this.#bytes(planned.name);
		if (current !== old && current !== next) throw new Error("Skill projection changed; reconciliation needs attention");
		if (current !== next) {
			const dir = join(this.directory, planned.name);
			mkdirSync(dir, { recursive: true, mode: 0o700 });
			if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink()) throw new Error("Skill directory is unavailable");
			const path = join(dir, "SKILL.md");
			if (next === null) unlinkSync(path);
			else {
				const temp = join(dir, `.skill-${randomUUID()}.tmp`),
					fd = openSync(temp, "wx", 0o600);
				try {
					writeFileSync(fd, next);
					fsyncSync(fd);
				} finally {
					closeSync(fd);
				}
				if (this.#bytes(planned.name) !== current) {
					unlinkSync(temp);
					throw new Error("Skill changed during save");
				}
				renameSync(temp, path);
			}
			const fd = openSync(dir, constants.O_RDONLY);
			try {
				fsyncSync(fd);
			} finally {
				closeSync(fd);
			}
		}
		this.#db.exec("begin immediate");
		try {
			this.#db.prepare("insert or ignore into versions values(?,?,?)").run(planned.name, planned.revision, row.planned);
			this.#db.prepare("update mutations set result=? where id=?").run(row.planned, row.id);
			this.#db.exec("commit");
		} catch (error) {
			this.#db.exec("rollback");
			throw error;
		}
	}
}
