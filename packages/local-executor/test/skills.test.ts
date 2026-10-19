import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { SkillStore } from "../src/skills.ts";
import { renderSkill, type SkillChange, type SkillDocument } from "@openbot/protocol";
let root: string, store: SkillStore;
const doc: SkillDocument = {
	name: "sales-report",
	description: "Compare sales totals",
	inputs: "CSV",
	requirements: "None",
	steps: "Sum rows",
	validation: "Verify totals",
	output: "Markdown report",
	approvalBoundaries: "Ask before external changes",
};
const save = (expectedRevision = 0, document = doc): SkillChange => ({ action: "save", name: doc.name, expectedRevision, document });
beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "openbot-skills-")));
	store = new SkillStore(join(root, "skills"));
});
afterEach(() => {
	store.close();
	rmSync(root, { recursive: true, force: true });
});
it("saves immutable versions, reconciles a lost response and retains deletion history", () => {
	const a = store.change("first", save());
	expect(readFileSync(join(root, "skills", doc.name, "SKILL.md"), "utf8")).toBe(renderSkill(doc));
	store.close();
	store = new SkillStore(join(root, "skills"));
	expect(store.change("first", save())).toEqual(a);
	const b = store.change("second", save(1, { ...doc, steps: "Changed method" }));
	expect(b.revision).toBe(2);
	expect(store.get(doc.name, 1).current.markdown).toContain("Sum rows");
	expect(() => store.change("stale", save(1))).toThrow("changed");
	expect(() => store.change("first", save(2))).toThrow("identity");
	store.change("delete", { action: "delete", name: doc.name, expectedRevision: 2 });
	expect(store.get(doc.name).current).toMatchObject({ deleted: true, revision: 3 });
	expect(() => store.change("new", save())).toThrow("changed");
	expect(store.change("restore", save(3)).revision).toBe(4);
	expect(store.get(doc.name).history.map((v) => v.revision)).toEqual([4, 3, 2, 1]);
});
it("refuses traversal, oversized content, unreviewed files and symlink projections", () => {
 expect(()=>store.change("unicode",save(0,{...doc,steps:"\ud800"}))).toThrow("Invalid");
	expect(() => store.change("bad", { ...save(), name: "../escape" })).toThrow("Invalid");
	expect(() => store.change("large", save(0, { ...doc, steps: "x".repeat(32768) }))).toThrow("Invalid");
	store.change("first", save());
	const path = join(root, "skills", doc.name, "SKILL.md");
	writeFileSync(path, "external change");
	expect(store.list()[0]?.available).toBe(false);
	expect(() => store.change("changed", save(1))).toThrow("outside");
	expect(readFileSync(path, "utf8")).toBe("external change");
	rmSync(path);
	const outside = join(root, "outside");
	writeFileSync(outside, "private");
	symlinkSync(outside, path);
	expect(store.list()[0]?.available).toBe(false);
	expect(() => store.change("symlink", save(1))).toThrow("outside");
	expect(readFileSync(outside, "utf8")).toBe("private");
});
it("reconciles durable intent only from verified old or intended new bytes", () => {
	store.change("first", save());
	store.change("second", save(1, { ...doc, steps: "New method" }));
	store.close();
	const db = new DatabaseSync(join(root, "skills", "metadata.sqlite"));
	db.prepare("delete from versions where revision=2").run();
	db.prepare("update mutations set result=null where id='second'").run();
	db.close();
	store = new SkillStore(join(root, "skills"));
	expect(store.get(doc.name).current.revision).toBe(2);
	expect(store.change("second", save(1, { ...doc, steps: "New method" })).revision).toBe(2);
});
it("preserves unrecognized files after an interrupted projection", () => {
	store.change("first", save());
	store.change("second", save(1, { ...doc, steps: "New method" }));
	store.close();
	const db = new DatabaseSync(join(root, "skills", "metadata.sqlite"));
	db.prepare("delete from versions where revision=2").run();
	db.prepare("update mutations set result=null where id='second'").run();
	db.close();
	const path = join(root, "skills", doc.name, "SKILL.md");
	writeFileSync(path, "unreviewed");
	store = new SkillStore(join(root, "skills"));
	expect(store.list()[0]?.available).toBe(false);
	expect(() => store.change("second", save(1, { ...doc, steps: "New method" }))).toThrow("reconciliation");
	expect(readFileSync(path, "utf8")).toBe("unreviewed");
});
it("caps active skills and keeps receipt replay available at capacity", () => {
	for (let i = 0; i < 50; i++)
		store.change(`create${i}`, { action: "save", name: `skill-${i}`, expectedRevision: 0, document: { ...doc, name: `skill-${i}` } });
	expect(() => store.change("full", save())).toThrow("full");
	expect(store.list()).toHaveLength(50);
	expect(
		store.change("create0", { action: "save", name: "skill-0", expectedRevision: 0, document: { ...doc, name: "skill-0" } }).revision,
	).toBe(1);
});
it("fails closed at lifetime revision capacity while allowing exact committed replay", () => {
 const first=store.change("first",save());store.close();
 const db=new DatabaseSync(join(root,"skills","metadata.sqlite"));
 const insert=db.prepare("insert into versions values(?,?,?)");
 db.exec("begin");for(let revision=2;revision<=1024;revision++)insert.run(doc.name,revision,JSON.stringify({...first,revision}));db.exec("commit");db.close();
 store=new SkillStore(join(root,"skills"));expect(()=>store.change("over-quota",save(1024))).toThrow("capacity");expect(store.change("first",save())).toEqual(first);expect(store.get(doc.name).history).toHaveLength(20);
});
it("rejects a symlinked database instead of opening external storage", () => {
 store.close();rmSync(join(root,"skills","metadata.sqlite"));const outside=join(root,"external.sqlite");writeFileSync(outside,"private");symlinkSync(outside,join(root,"skills","metadata.sqlite"));
 expect(()=>new SkillStore(join(root,"skills"))).toThrow("Invalid skill metadata storage");expect(readFileSync(outside,"utf8")).toBe("private");
 rmSync(join(root,"skills","metadata.sqlite"));store=new SkillStore(join(root,"skills"));
});
