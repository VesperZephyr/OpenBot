import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { PROCESS_SNAPSHOT_TIMEOUT_MS, posixProcessGroups, processSnapshot } from "../src/process-group.ts";

const exec = promisify(execFile);
const markers = new Set<string>();

async function killMarkers(): Promise<void> {
	if (!posixProcessGroups()) return;
	const { stdout } = await exec("ps", ["-ax", "-o", "pid=,command="], { encoding: "utf8" }).catch(() => ({ stdout: "" }));
	for (const line of stdout.split("\n")) {
		if (![...markers].some((marker) => line.includes(marker))) continue;
		const pid = Number(/^\s*(\d+)/.exec(line)?.[1]);
		if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// Already gone.
		}
	}
}

afterEach(async () => {
	await killMarkers();
	markers.clear();
});

it("reads the current process from the process table", async () => {
	if (!posixProcessGroups()) return;
	const rows = await processSnapshot();
	expect(rows.some((row) => row.pid === process.pid)).toBe(true);
});

it("returns no rows when the process-table command exceeds the snapshot timeout", async () => {
	if (!posixProcessGroups()) return;
	expect(PROCESS_SNAPSHOT_TIMEOUT_MS).toBeGreaterThan(0);
	const marker = `openbot-ps-timeout-${randomUUID()}`;
	markers.add(marker);
	const started = Date.now();
	const rows = await Promise.race([
		processSnapshot({
			command: process.execPath,
			args: ["-e", `process.title = ${JSON.stringify(marker)}; setInterval(() => {}, 1e8);`],
		}),
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error("ps snapshot was not bounded")), PROCESS_SNAPSHOT_TIMEOUT_MS + 2_000),
		),
	]);
	const elapsed = Date.now() - started;
	expect(rows).toEqual([]);
	expect(elapsed).toBeGreaterThanOrEqual(PROCESS_SNAPSHOT_TIMEOUT_MS - 200);
	expect(elapsed).toBeLessThan(PROCESS_SNAPSHOT_TIMEOUT_MS + 1_500);
	const { stdout } = await exec("ps", ["-ax", "-o", "command="], { encoding: "utf8" });
	expect(stdout).not.toContain(marker);
}, 8_000);
