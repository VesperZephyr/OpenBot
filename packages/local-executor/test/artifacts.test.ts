import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { ArtifactStore } from "../src/artifacts.ts";
let root: string, store: ArtifactStore;
beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "openbot-artifact-")));
	store = new ArtifactStore(join(root, "store"));
});
afterEach(() => {
	store.close();
	rmSync(root, { recursive: true, force: true });
});
function file(name: string, content: string | Buffer) {
	const path = join(root, name);
	writeFileSync(path, content);
	return path;
}
describe("immutable local artifacts", () => {
	it("retains an independent copy, deduplicates imports and reopens after source removal", () => {
		const path = file("研究.md", "# Evidence\n本地资料");
		const ref = store.capture("import", path);
		rmSync(path);
		expect(store.capture("import", path)).toEqual(ref);
		expect(store.content(ref.artifactId).text).toBe("# Evidence\n本地资料");
		expect(JSON.stringify(ref)).not.toContain(root);
		store.close();
		store = new ArtifactStore(join(root, "store"));
		expect(store.get(ref.artifactId)).toEqual(ref);
		expect(() => store.capture("import", join(root, "different.md"))).toThrow("different arguments");
	});
	it("never overwrites exports and retries the recorded copy without another side effect", () => {
		const ref = store.capture("import", file("input.csv", "a,b\n1,2"));
		const destination = join(root, "export.csv");
		store.export("export", ref.artifactId, destination);
		expect(readFileSync(destination, "utf8")).toBe("a,b\n1,2");
		writeFileSync(destination, "later edit");
		store.export("export", ref.artifactId, destination);
		expect(readFileSync(destination, "utf8")).toBe("later edit");
		expect(() => store.export("new-export", ref.artifactId, destination)).toThrow("already exists");
		expect(() => store.export("export", ref.artifactId, join(root, "other.csv"))).toThrow("different arguments");
	});
	it("keeps removal tombstones and distinguishes missing and corrupt content", () => {
		const ref = store.capture("a", file("a.txt", "original"));
		writeFileSync(join(root, "store", ref.artifactId), "changed");
		expect(store.get(ref.artifactId).availability).toBe("corrupt");
		rmSync(join(root, "store", ref.artifactId));
		expect(store.content(ref.artifactId)).toMatchObject({ artifact: { availability: "missing" } });
		store.remove("remove", ref.artifactId);
		store.remove("remove", ref.artifactId);
		expect(store.get(ref.artifactId).availability).toBe("removed");
		expect(store.capture("a", join(root, "a.txt")).availability).toBe("removed");
	});
	it("checks paths, format, UTF-8, file size and shared storage quota", () => {
		expect(() => store.capture("bad", file("x.exe", "MZ"))).toThrow("Unsupported");
		expect(() => store.capture("html", file("x.html", "<script>alert(1)</script>"))).toThrow("Unsupported");
		expect(() => store.capture("utf8", file("x.txt", Buffer.from([0xff])))).toThrow("UTF-8");
		expect(() => store.capture("null", file("nul.txt", "a\0b"))).toThrow("UTF-8");
		expect(() => store.capture("large", file("large.txt", "a".repeat(256 * 1024 + 1)))).toThrow("size");
		const source = file("real.txt", "valid");
		symlinkSync(source, join(root, "link.txt"));
		expect(() => store.capture("link", join(root, "link.txt"))).toThrow("Symbolic links");
		expect(() => store.capture("traversal", `${root}/store/../real.txt`)).toThrow("without symbolic links");
		mkdirSync(join(root, "folder.txt"));
		expect(() => store.capture("directory", join(root, "folder.txt"))).toThrow("regular files");
		store.close();
		store = new ArtifactStore(join(root, "small-store"), { storageBytes: 8 });
		store.capture("first", source);
		expect(() => store.capture("second", file("second.txt", "four"))).toThrow("storage is full");
		const empty = store.capture("empty", file("empty.txt", ""));
		expect(empty.bytes).toBe(0);
	});
	it("previews HTML only as bounded text and enforces image signatures/dimensions", () => {
		const html = "<script>fetch('file:///secret')</script>" + "x".repeat(100000);
		const ref = store.capture("result", file("result.html", html), "result");
		const preview = store.content(ref.artifactId, true);
		expect(preview.truncated).toBe(true);
		expect(preview.text).toHaveLength(65536);
		expect(preview.text).toContain("<script>");
		expect(preview.base64).toBeUndefined();
		expect(() => store.capture("fake", file("fake.png", "text"))).toThrow("invalid image");
		const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/2cAAAAASUVORK5CYII=", "base64");
		const image = store.capture("image", file("image.png", png));
		expect(image.mediaType).toBe("image/png");
		expect(store.content(image.artifactId).base64).toBe(png.toString("base64"));
		png.writeUInt32BE(4097, 16);
		expect(() => store.capture("huge", file("huge.png", png))).toThrow("dimensions");
	});
	it("bounds durable operation records without losing existing replay or removal", () => {
		const source = file("quota.txt", "kept"),
			ref = store.capture("stable", source);
		store.close();
		const db = new DatabaseSync(join(root, "store", "metadata.sqlite"));
		db.exec(
			"with recursive n(x) as (values(1) union all select x+1 from n where x<16383) insert into operations(id,digest,intent,result) select 'export:fixture-'||x,'fixture',null,'null' from n",
		);
		db.close();
		store = new ArtifactStore(join(root, "store"));
		expect(() => store.capture("new", source)).toThrow("operation history is full");
		expect(store.capture("stable", source)).toEqual(ref);
		store.remove("remove-stable", ref.artifactId);
		expect(store.get(ref.artifactId).availability).toBe("removed");
	});

	it("reconciles committed blobs and exports after a lost ledger completion", () => {
		const ref = store.capture("import", file("input.txt", "stable"));
		const dest = join(root, "export.txt");
		store.export("export", ref.artifactId, dest);
		store.close();
		const db = new DatabaseSync(join(root, "store", "metadata.sqlite"));
		db.exec("delete from artifacts; update operations set result=null;");
		db.close();
		store = new ArtifactStore(join(root, "store"));
		expect(store.get(ref.artifactId).availability).toBe("available");
		rmSync(join(root, "input.txt"));
		expect(store.capture("import", join(root, "input.txt"))).toEqual(ref);
		store.export("export", ref.artifactId, dest);
		expect(readFileSync(dest, "utf8")).toBe("stable");
	});
});

it("lists immutable shared references with stable pagination, filtering and removal",()=>{
 for(let i=0;i<202;i++)store.capture(`list-${i}`,file(`file-${i}.txt`,String(i)));
 const first=store.list(0,""),second=store.list(first.nextOffset!,"");
 expect(first.items).toHaveLength(200);expect(second.items).toHaveLength(2);expect(second.nextOffset).toBeUndefined();
 expect(new Set([...first.items,...second.items].map(item=>item.artifactId)).size).toBe(202);
 const match=store.list(0,"FILE-201");expect(match.items).toHaveLength(1);
 const ref=match.items[0]!;store.remove("list-remove",ref.artifactId);expect(store.list(0,"file-201").items).toHaveLength(0);
});

it("publishes immutable PDF results without widening model input formats",()=>{
 const path=file("report.pdf","%PDF-1.4\nsynthetic signature fixture");
 expect(()=>store.capture("pdf-input",path)).toThrow("Unsupported attachment");
 const ref=store.capture("pdf-result",path,"result");expect(ref.mediaType).toBe("application/pdf");
 rmSync(path);expect(Buffer.from(store.content(ref.artifactId).base64!,"base64").toString()).toContain("%PDF-1.4");
 expect(()=>store.capture("bad-pdf",file("bad.pdf","not pdf"),"result")).toThrow("Invalid PDF");
});

it("filters generated files by trusted Bot before pagination and preserves legacy results", () => {
	const path = file("report.md", "original");
	const legacy = store.capture("legacy", path, "result");
	const first = store.capture("bot-a", path, "result", undefined, "a");
	const input = store.capture("input", path, "input", undefined, "a");
	for (let i = 0; i < 201; i++) store.capture(`other-${i}`, path, "result", undefined, "b");
	expect(store.list(0, "", { source: "result", botId: "a" }).items).toEqual([first]);
	expect(store.list(0, "REPORT", { source: "result", botId: "b" }).nextOffset).toBe(200);
	expect(store.list(200, "", { source: "result", botId: "b" }).items).toHaveLength(1);
	expect(store.list(0, "missing", { botId: "a" }).items).toEqual([]);
	expect(input.botId).toBeUndefined();
	expect(legacy.botId).toBeUndefined();
	rmSync(path);
	expect(store.capture("bot-a", path, "result", undefined, "b")).toEqual(first);
	store.close(); store = new ArtifactStore(join(root, "store"));
	expect(store.list(0, "", { botId: "a" }).items).toEqual([first]);
	store.remove("remove-a", first.artifactId);
	expect(store.list(0, "", { botId: "a" }).items).toEqual([]);
	expect(store.get(legacy.artifactId).availability).toBe("available");
}, 30000);
