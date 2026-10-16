import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RotatingLog } from "../src/main/host-log";

let directory: string | undefined;
afterEach(async () => {
	if (directory !== undefined) await rm(directory, { recursive: true, force: true });
});

describe("RotatingLog", () => {
	it("keeps the live file under the limit and the previous file as .1", async () => {
		directory = await mkdtemp(join(tmpdir(), "openbot-log-"));
		const path = join(directory, "logs", "host.log");
		const log = new RotatingLog(path, 100);
		for (let line = 0; line < 30; line++) log.write(Buffer.from(`line ${String(line).padStart(2, "0")}\n`));

		expect((await stat(path)).size).toBeLessThanOrEqual(100);
		expect((await stat(`${path}.1`)).size).toBeLessThanOrEqual(100);
		const current = await readFile(path, "utf8");
		expect(current.endsWith("line 29\n")).toBe(true);
		const previous = await readFile(`${path}.1`, "utf8");
		expect(Number(previous.trimEnd().split("\n").at(-1)?.slice(5)) + 1).toBe(Number(current.split("\n")[0]?.slice(5)));
	});

	it("appends to an existing file and counts its size toward the limit", async () => {
		directory = await mkdtemp(join(tmpdir(), "openbot-log-"));
		const path = join(directory, "host.log");
		new RotatingLog(path, 100).write(Buffer.from("x".repeat(90)));
		new RotatingLog(path, 100).write(Buffer.from("y".repeat(20)));

		expect(await readFile(`${path}.1`, "utf8")).toBe("x".repeat(90));
		expect(await readFile(path, "utf8")).toBe("y".repeat(20));
	});
});
