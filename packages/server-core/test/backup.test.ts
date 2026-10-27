import { afterEach, expect, it } from "vitest";
import { realpathSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, existsSync, truncateSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { LocalBackups } from "../src/backup.ts";
const dirs: string[] = [];
const producer = { application: "test", protocol: 1, runtime: "test-runtime/1" };
function fixture() {
	const root = mkdtempSync(join(realpathSync(tmpdir()), "openbot-backup-test-"));
	dirs.push(root);
	const data = join(root, "data"),
		out = join(root, "backups");
	mkdirSync(data);
	mkdirSync(out);
	const db = new DatabaseSync(join(data, "openbot.sqlite"));
	db.exec("create table facts(value text);insert into facts values ('original');");
	db.close();
	mkdirSync(join(data, "attachments"));
	writeFileSync(join(data, "attachments", "report.md"), "# 原始报告");
	writeFileSync(join(data, "credentials.json"), '["DO_NOT_EXPORT"]');
	mkdirSync(join(data, "artifacts"));
	writeFileSync(join(data, "artifacts", "spill.txt"), "temporary");
	const options = {
		dataDirectory: data,
		machine: "this-mac",
		producer,
		pauseRestored: async (path: string) => {
			const db = new DatabaseSync(path);
			db.exec("create table lifecycle(paused integer);insert into lifecycle values(1)");
			db.close();
		},
	};
	return { root, data, out, options, service: new LocalBackups(options) };
}
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
it("restores content after deletion, preserves excluded local data and retains a verified rollback", async () => {
	const f = fixture(),
		archive = f.service.export(f.out).path!;
	expect(existsSync(join(archive, "data/credentials.json"))).toBe(false);
	expect(existsSync(join(archive, "data/artifacts"))).toBe(false);
	rmSync(join(f.data, "attachments"), { recursive: true });
	const db = new DatabaseSync(join(f.data, "openbot.sqlite"));
	db.exec("update facts set value='changed'");
	db.close();
	const result = await f.service.restore(archive);
	expect(readFileSync(join(f.data, "attachments/report.md"), "utf8")).toBe("# 原始报告");
	const restored = new DatabaseSync(join(f.data, "openbot.sqlite"));
	expect(restored.prepare("select * from lifecycle").get()).toMatchObject({ paused: 1 });
	expect(restored.prepare("select * from facts").get()).toMatchObject({ value: "original" });
	restored.close();
	f.service.validate(result.rollbackPath!);
	expect(readFileSync(join(f.data, "credentials.json"), "utf8")).toContain("DO_NOT_EXPORT");
	const previous = new DatabaseSync(join(result.rollbackPath!, "data/openbot.sqlite"));
	expect(previous.prepare("select * from facts").get()).toMatchObject({ value: "changed" });
	previous.close();
});
it.each(["corrupt", "extra", "missing", "version", "machine", "runtime", "traversal", "duplicate", "oversize", "symlink"])(
	"rejects %s before modifying active data",
	async (kind) => {
		const f = fixture(),
			archive = f.service.export(f.out).path!,
			manifestPath = join(archive, "manifest.json"),
			m = JSON.parse(readFileSync(manifestPath, "utf8"));
		if (kind === "corrupt") writeFileSync(join(archive, "data/attachments/report.md"), "corrupt");
		if (kind === "extra") writeFileSync(join(archive, "data/attachments/unlisted"), "extra");
		if (kind === "missing") rmSync(join(archive, "data/attachments/report.md"));
		if (kind === "version") m.version = 2;
		if (kind === "machine") m.machine = "another-mac";
		if (kind === "runtime") m.producer.runtime = "future";
		if (kind === "traversal") m.files[0].path = "../escape";
		if (kind === "duplicate") m.files.push(m.files[0]);
		if (kind === "oversize") m.files[0].bytes = 2 ** 30;
		if (kind === "symlink") {
			rmSync(join(archive, "data/attachments/report.md"));
			symlinkSync(join(f.data, "attachments/report.md"), join(archive, "data/attachments/report.md"));
		}
		writeFileSync(manifestPath, JSON.stringify(m));
		const before = readFileSync(join(f.data, "openbot.sqlite"));
		await expect(f.service.restore(archive)).rejects.toThrow();
		expect(readFileSync(join(f.data, "openbot.sqlite"))).toEqual(before);
		expect(existsSync(join(f.data, ".restore-journal.json"))).toBe(false);
	},
);
it("refuses symlink parents, oversized actual files and snapshots inside active data", () => {
	const f = fixture();
	symlinkSync(f.out, join(f.root, "link"));
	expect(() => f.service.export(join(f.root, "link"))).toThrow("symbolic");
	expect(() => f.service.export(f.data)).toThrow("outside");
	truncateSync(join(f.data, "attachments/report.md"), 257 * 1024 * 1024);
	expect(() => f.service.export(f.out)).toThrow("oversized");
});
it("rolls back a replacement failure", async () => {
	const f = fixture(),
		archive = f.service.export(f.out).path!;
	writeFileSync(join(f.data, "attachments/report.md"), "current");
	const service = new LocalBackups({
		...f.options,
		afterReplace: (i) => {
			if (i === 2) throw Error("disk fault");
		},
	});
	await expect(service.restore(archive)).rejects.toThrow("disk fault");
	expect(readFileSync(join(f.data, "attachments/report.md"), "utf8")).toBe("current");
	expect(existsSync(join(f.data, ".restore-journal.json"))).toBe(false);
});
it("recovers after the actual replacement process exits without finally handlers", () => {
	const f = fixture(),
		archive = f.service.export(f.out).path!;
	writeFileSync(join(f.data, "attachments/report.md"), "current");
	const script = join(f.root, "crash.mjs");
	writeFileSync(
		script,
		`import {LocalBackups} from ${JSON.stringify(resolve("packages/server-core/src/backup.ts"))}; const service=new LocalBackups({dataDirectory:${JSON.stringify(f.data)},machine:"this-mac",producer:${JSON.stringify(producer)},pauseRestored:async()=>{},afterReplace:i=>{if(i===2)process.exit(23)}});await service.restore(${JSON.stringify(archive)});`,
	);
	const child = spawnSync(process.execPath, [script], { encoding: "utf8" });
	expect(child.status, child.stderr).toBe(23);
	expect(existsSync(join(f.data, ".restore-journal.json"))).toBe(true);
	f.service.recover();
	f.service.recover();
	expect(readFileSync(join(f.data, "attachments/report.md"), "utf8")).toBe("current");
});
it("normalizes WAL snapshots so repeated validation does not change the archive", () => {
	const f = fixture();
	const db = new DatabaseSync(join(f.data, "openbot.sqlite"));
	db.exec("pragma journal_mode=wal;insert into facts values('wal')");
	db.close();
	const archive = f.service.export(f.out).path!;
	f.service.validate(archive);
	f.service.validate(archive);
	expect(existsSync(join(archive, "data/openbot.sqlite-wal"))).toBe(false);
});
