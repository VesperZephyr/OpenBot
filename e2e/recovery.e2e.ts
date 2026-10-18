/**
 * End-to-end recovery: approvals and executor receipts survive a Host restart, so an approved command runs at most
 * once. Restarts are a clean quit and relaunch, or a crash (SIGKILL of the Host and executor) followed by a relaunch.
 */
import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AppHarness, createBot, launchApp } from "./harness.ts";

const run = promisify(execFile);
let h: AppHarness;

/** Lines of count.txt in the workspace; empty while it does not exist. */
async function countLines(): Promise<string[]> {
	const text = await readFile(join(h.workspace, "count.txt"), "utf8").catch(() => "");
	return text.split("\n").filter((line) => line !== "");
}

/** PIDs of a `pgrep -f` pattern, or none. */
async function pgrep(args: readonly string[]): Promise<number[]> {
	const { stdout } = await run("pgrep", [...args]).catch(() => ({ stdout: "" }));
	return stdout.split("\n").filter((line) => line !== "").map(Number);
}

/** `sleep 30` processes running in this suite's workspace; other checkouts may run their own. */
async function orphanedSleeps(): Promise<number[]> {
	const pids = await pgrep(["-f", "sleep 30"]);
	if (pids.length === 0) return [];
	const workspace = await realpath(h.workspace);
	const { stdout } = await run("lsof", ["-a", "-d", "cwd", "-Fn", "-p", pids.join(",")]).catch(() => ({ stdout: "" }));
	const ours: number[] = [];
	let pid = 0;
	for (const line of stdout.split("\n")) {
		if (line.startsWith("p")) pid = Number(line.slice(1));
		else if (line === `n${workspace}`) ours.push(pid);
	}
	return ours;
}

async function openBot(name: string): Promise<void> {
	await h.page().locator(".bot-row").filter({ has: h.page().getByText(name, { exact: true }) }).click();
	await h.page().getByRole("textbox", { name: `Message ${name}` }).waitFor();
}

beforeAll(async () => {
	h = await launchApp("recovery");
	await createBot(h, "Keeper");
}, 90_000);

afterAll(async () => {
	await h?.close();
});

describe("recovery", () => {
	it("pending approval survives a restart", async () => {
		h.model.script({ tool: "local_exec", args: { command: "echo run >> count.txt", description: "Count run" } }, { text: "Counted." });
		await h.send("Count a run");
		const card = h.page().getByRole("group", { name: "Approval request" });
		await card.waitFor();
		await h.shot("01-pending");

		await h.relaunch();
		await openBot("Keeper");
		const again = h.page().getByRole("group", { name: "Approval request" });
		await again.waitFor();
		expect(await again.locator(".approval-args").textContent()).toContain("echo run >> count.txt");
		expect(await countLines()).toEqual([]);
		await h.shot("02-pending-after-restart");

		await again.getByRole("button", { name: "Allow once" }).click();
		await h.page().locator(".tool-card.tool-succeeded", { hasText: "Count run" }).waitFor();
		await h.page().locator(".transcript").getByText("Counted.").waitFor();
		expect(await countLines()).toEqual(["run"]);
		await h.shot("03-allowed-once");
	});

	it("approved command interrupted by a crash is not repeated", async () => {
		h.model.script(
			{ tool: "local_exec", args: { command: "echo start >> count.txt; sleep 30", description: "Long job" } },
			{ text: "I will check what happened." },
		);
		await h.send("Start the long job");
		const card = h.page().getByRole("group", { name: "Approval request" });
		await card.getByRole("button", { name: "Allow once" }).click();
		await expect.poll(countLines, { timeout: 15_000 }).toContain("start");

		// A crash, not a quit: a clean quit cancels the command and records `cancelled`. The executor dies first so it
		// never gets to cancel anything; then its Host.
		const hostPid = Number((await readFile(join(h.dataDirectory, "host.lock"), "utf8")).trim());
		const executorPids = await pgrep(["-P", String(hostPid)]);
		expect(executorPids.length).toBeGreaterThan(0);
		for (const pid of executorPids) process.kill(pid, "SIGKILL");
		process.kill(hostPid, "SIGKILL");

		await h.relaunch();
		await openBot("Keeper");
		const row = h.page().locator(".tool-card.tool-interrupted", { hasText: "Long job" });
		await row.waitFor();
		expect(await row.locator(".tool-verb").textContent()).toBe("Interrupted");
		await expect.poll(() => h.page().locator(".bot-row").filter({ has: h.page().getByText("Keeper", { exact: true }) }).textContent()).toContain("Needs attention");
		expect(await countLines()).toEqual(["run", "start"]);
		expect(await orphanedSleeps()).toEqual([]);
		// The model was told the action may have partly run.
		await expect.poll(() => JSON.stringify(h.model.requests.at(-1)?.messages.at(-1))).toContain("may have partly run");
		await h.shot("04-interrupted");
	});
});
