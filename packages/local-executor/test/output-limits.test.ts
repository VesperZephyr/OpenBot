import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, utimesSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { OutputLog, SPILL_LIMITS, pruneArtifacts } from "../src/output.ts";
let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "openbot-spill-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
it("caps each file and the aggregate while retaining recent output and honest loss markers", () => {
	const block = Buffer.alloc(1024 * 1024, 120);
	for (let index = 0; index < 8; index++) {
		const path = join(root, `${index}.txt`),
			log = new OutputLog(path);
		for (let i = 0; i < 12; i++) log.append(block);
		log.append(Buffer.from("\nRECENT_TAIL\n"));
		const rendered = log.render();
		log.close();
		expect(rendered.text).toContain("full output was not saved");
		expect(rendered.text).toContain("RECENT_TAIL");
		expect(Buffer.byteLength(rendered.text)).toBeLessThan(26 * 1024);
		try {
			expect(statSync(path).size).toBeLessThanOrEqual(SPILL_LIMITS.fileBytes);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	expect(readdirSync(root).reduce((sum, name) => sum + statSync(join(root, name)).size, 0)).toBe(SPILL_LIMITS.totalBytes);
});
it("caps the number of empty spill files and never prunes the durable attachment store", () => {
	for (let i = 0; i < SPILL_LIMITS.files; i++) writeFileSync(join(root, `${i}.txt`), "");
	const log = new OutputLog(join(root, "over.txt"));
	log.append(Buffer.alloc(30 * 1024, 120));
	expect(log.render().text).toContain("storage limit");
	log.close();
	expect(readdirSync(root)).toHaveLength(SPILL_LIMITS.files);
	const attachments = join(root, "attachments");
	mkdirSync(attachments);
	writeFileSync(join(attachments, "copy"), "retained");
	const old = join(root, "0.txt");
	utimesSync(old, 0, 0);
	pruneArtifacts(root);
	expect(readFileSync(join(attachments, "copy"), "utf8")).toBe("retained");
	expect(readdirSync(root)).not.toContain("0.txt");
});
