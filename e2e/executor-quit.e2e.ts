/**
 * A detached executor must not outlive Desktop. Quit is the real app close, which gives the Host five seconds
 * and then SIGKILLs it.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { type AppHarness, launchApp } from "./harness.ts";

const run = promisify(execFile);

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function descendantPids(root: number): Promise<number[]> {
	const { stdout } = await run("ps", ["-ax", "-o", "pid=,ppid="]).catch(() => ({ stdout: "" }));
	const rows = stdout.trim().split("\n").flatMap((line) => {
		const [pid, ppid] = line.trim().split(/\s+/).map(Number);
		if (pid === undefined || ppid === undefined || !Number.isInteger(pid) || !Number.isInteger(ppid)) return [];
		return [{ pid, ppid }];
	});
	const children = new Map<number, number[]>();
	for (const row of rows) {
		const list = children.get(row.ppid) ?? [];
		list.push(row.pid);
		children.set(row.ppid, list);
	}
	const found: number[] = [];
	const stack = [...(children.get(root) ?? [])];
	const seen = new Set<number>();
	while (stack.length > 0) {
		const pid = stack.pop();
		if (pid === undefined || seen.has(pid)) continue;
		seen.add(pid);
		found.push(pid);
		for (const child of children.get(pid) ?? []) stack.push(child);
	}
	return found;
}

it("desktop quit leaves no detached executor process behind", async () => {
	let h: AppHarness | undefined;
	try {
		h = await launchApp("executor-quit");
		const hostPid = Number((await readFile(join(h.dataDirectory, "host.lock"), "utf8")).trim());
		expect(alive(hostPid)).toBe(true);
		const descendants = await descendantPids(hostPid);
		expect(descendants.length).toBeGreaterThan(0);
		await h.close();
		h = undefined;
		await expect.poll(() => alive(hostPid)).toBe(false);
		await expect.poll(() => descendants.every((pid) => !alive(pid))).toBe(true);
		expect(await descendantPids(hostPid)).toEqual([]);
		void closed;
	} finally {
		await h?.close();
	}
}, 90_000);
