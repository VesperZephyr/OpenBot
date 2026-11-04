import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export type ProcessRow = { readonly pid: number; readonly ppid: number; readonly pgid: number; readonly started: string | undefined };
export type TrackedGroup = { readonly pgid: number; readonly started: string | undefined };

/**
 * POSIX process groups are the unit stop can signal. Windows has neither `ps` group ids nor `kill(-pgid)`,
 * so callers there fall back to the direct child only. OpenBot's supported host is macOS.
 */
export function posixProcessGroups(): boolean {
	return process.platform !== "win32";
}

/** The recorded leader is still ours unless that pid now exists with a different start time. */
export function groupStillOurs(current: string | undefined, recorded: string): boolean {
	return !(current !== undefined && current !== recorded);
}

/** One process table read. Stop uses this once; it does not call `ps` again per group. */
export async function processSnapshot(): Promise<readonly ProcessRow[]> {
	if (!posixProcessGroups()) return [];
	try {
		const { stdout } = await exec("ps", ["-ax", "-o", "pid=,ppid=,pgid=,lstart="], { encoding: "utf8" });
		return parseProcessTable(stdout);
	} catch {
		return [];
	}
}

/** `ps` start time of one process, or undefined when it does not exist. */
export function processStartTime(pid: number): string | undefined {
	if (!posixProcessGroups()) return undefined;
	try {
		const started = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" }).trim();
		return started === "" ? undefined : started;
	} catch {
		return undefined;
	}
}

/** Kill a process group a dead executor left behind, using the ledger's recorded start time. */
export function killOrphanGroup(pgid: number, leaderStarted: string): void {
	if (!posixProcessGroups()) return;
	if (!groupStillOurs(processStartTime(pgid), leaderStarted)) return;
	try {
		process.kill(-pgid, "SIGKILL");
	} catch {
		// The group is gone.
	}
}

export function trackedGroups(rootPid: number, table: readonly ProcessRow[]): TrackedGroup[] {
	if (!posixProcessGroups()) return [];
	const own = table.find((row) => row.pid === process.pid)?.pgid;
	const children = new Map<number, number[]>();
	for (const row of table) {
		const list = children.get(row.ppid) ?? [];
		list.push(row.pid);
		children.set(row.ppid, list);
	}
	const members = new Set<number>();
	const stack = [rootPid];
	while (stack.length > 0) {
		const pid = stack.pop();
		if (pid === undefined || members.has(pid)) continue;
		members.add(pid);
		for (const child of children.get(pid) ?? []) stack.push(child);
	}
	for (const row of table) if (row.pgid === rootPid) members.add(row.pid);
	const groups = new Map<number, string | undefined>();
	for (const row of table) {
		if (!members.has(row.pid) || row.pgid <= 1 || row.pgid === own) continue;
		if (!groups.has(row.pgid)) groups.set(row.pgid, row.started);
	}
	if (rootPid > 1 && rootPid !== own && !groups.has(rootPid)) groups.set(rootPid, undefined);
	return [...groups].map(([pgid, started]) => ({ pgid, started }));
}

export function signalTrackedGroups(groups: readonly TrackedGroup[]): void {
	if (!posixProcessGroups()) return;
	for (const group of groups) {
		try {
			process.kill(-group.pgid, "SIGKILL");
		} catch {
			// Already gone.
		}
	}
}

function parseProcessTable(text: string): ProcessRow[] {
	return text.trim().split("\n").flatMap((line) => {
		const match = /^(\d+)\s+(\d+)\s+(\d+)\s*(.*)$/.exec(line.trim());
		if (!match) return [];
		const pid = Number(match[1]);
		const ppid = Number(match[2]);
		const pgid = Number(match[3]);
		if (!Number.isInteger(pid) || !Number.isInteger(ppid) || !Number.isInteger(pgid) || pid <= 0) return [];
		const started = match[4]?.trim();
		return [{ pid, ppid, pgid, started: started === undefined || started === "" ? undefined : started }];
	});
}
