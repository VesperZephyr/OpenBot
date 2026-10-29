import { mkdtempSync, realpathSync, rmSync, writeFileSync, readFileSync, symlinkSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { PNG } from "pngjs";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
const fault = vi.hoisted(() => ({ kind: "" }));
vi.mock("node:fs", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs")>();
	return {
		...fs,
		writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
			if (fault.kind === "write" && String(args[0]).endsWith(".tmp")) {
				const error = new Error("disk full");
				Object.assign(error, { code: "ENOSPC" });
				throw error;
			}
			return fs.writeFileSync(...args);
		},
		linkSync: (...args: Parameters<typeof fs.linkSync>) => {
			if (fault.kind === "link") throw Object.assign(Error("publish failed"), { code: "EIO" });
			return fs.linkSync(...args);
		},
		fstatSync: (fd: number) => {
			const stat = fs.fstatSync(fd);
			if (fault.kind === "read") {
				fault.kind = "after-read";
			} else if (fault.kind === "after-read") {
				stat.mtimeMs++;
			}
			return stat;
		},
	};
});
import { ArtifactStore } from "../src/artifacts.ts";
import { readBotTemplate } from "../src/templates.ts";
import { canonicalTemplateJson, normalizeTemplate } from "@openbot/protocol";
let root: string, store: ArtifactStore;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const doc = () =>
	normalizeTemplate({
		format: "openbot-bot-template",
		version: 1,
		profile: {
			name: "Reader",
			role: "",
			instructions: "",
			avatar: { kind: "generated", version: 1, seed: 1, motif: "leaf" },
			model: null,
			thinkingLevel: "off",
			defaultSkills: [],
		},
	});
beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "openbot-template-")));
	store = new ArtifactStore(join(root, "attachments"));
});
afterEach(() => {
	fault.kind = "";
	store.close();
	rmSync(root, { recursive: true, force: true });
});
it("rejects changed reads and cleans up partial publication on disk or link failures", () => {
	const text = canonicalTemplateJson(doc()) + "\n",
		source = join(root, "source.json");
	writeFileSync(source, text);
	fault.kind = "read";
	expect(() => readBotTemplate(source)).toThrow("Could not read");
	fault.kind = "";
	for (const kind of ["write", "link"]) {
		const destination = join(root, `${kind}.json`);
		fault.kind = kind;
		expect(() => store.templateWrite(kind, destination, text, hash(text))).toThrow();
		fault.kind = "";
		expect(readdirSync(root)).not.toContain(`${kind}.json`);
		expect(readdirSync(root).filter((name) => name.endsWith(".tmp"))).toEqual([]);
		store.templateWrite(kind, destination, text, hash(text));
		expect(readFileSync(destination, "utf8")).toBe(text);
	}
});
it("publishes a complete canonical file once and reconciles a lost reply after restart", () => {
	const text = canonicalTemplateJson(doc()) + "\n",
		path = join(root, "bot.json");
	store.templateWrite("one", path, text, hash(text));
	const db = new DatabaseSync(join(root, "attachments", "metadata.sqlite"));
	db.exec("update operations set result=null where id='template-export:one'");
	db.close();
	store.close();
	store = new ArtifactStore(join(root, "attachments"));
	expect(store.templateWrite("one", path, text, hash(text))).toBeNull();
	expect(readBotTemplate(path).template).toEqual(doc());
	expect(() => store.templateWrite("one", join(root, "different.json"), text, hash(text))).toThrow();
	expect(() => store.templateWrite("two", path, text, hash(text))).toThrow("already exists");
	expect(readFileSync(path, "utf8")).toBe(text);
	expect(store.list(0, "").items).toEqual([]);
	expect(readdirSync(root).some((n) => n.endsWith(".tmp"))).toBe(false);
});
it("rejects unsafe paths, changed identity and nonregular or invalid UTF-8 files", () => {
	const path = join(root, "invalid.json");
	writeFileSync(path, Buffer.from([0xff]));
	expect(() => readBotTemplate(path)).toThrow();
	writeFileSync(path, JSON.stringify(doc()));
	symlinkSync(path, join(root, "link"));
	for (const target of [root, join(root, "link"), join(root, "missing")])
		expect(() => readBotTemplate(target)).toThrow();
	symlinkSync(join(root, "missing"), join(root, "dangling"));
	const text = canonicalTemplateJson(doc()) + "\n";
	expect(() => store.templateWrite("x", join(root, "dangling"), text, hash(text))).toThrow();
	expect(() => store.templateWrite("x", join(root, "new"), text, "a".repeat(64))).toThrow();
	writeFileSync(path, Buffer.alloc(1048577));
	expect(() => readBotTemplate(path)).toThrow();
});
it("validates bounded PNG data before creating any asset or file", () => {
	const template = doc(),
		path = join(root, "image.json"),
		png = PNG.sync.write(new PNG({ width: 256, height: 256 }), { colorType: 6 });
	template.profile.avatar = { kind: "png", base64: png.toString("base64") };
	writeFileSync(path, JSON.stringify(template));
	expect(readBotTemplate(path).template).toEqual(template);
	png[28] = 1;
	template.profile.avatar.base64 = png.toString("base64");
	writeFileSync(path, JSON.stringify(template));
	expect(() => readBotTemplate(path)).toThrow();
	expect(store.list(0, "").items).toHaveLength(0);
});
