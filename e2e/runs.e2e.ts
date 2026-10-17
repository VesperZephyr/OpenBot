/**
 * End-to-end: Runs, the active-Run cap, steering, and Stop. The Host runs with a cap of one, so a second Bot's message
 * waits for a free slot. Screenshots land in e2e/.run/runs/.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AppHarness, createBot, launchApp } from "./harness.ts";

/** The part of a conversation snapshot this suite reads; the e2e project does not depend on product packages. */
type Snapshot = { readonly run?: { readonly runId: string; readonly state: string; readonly requestIds: readonly string[] } };
type Methods = {
	"bots.list": (params: Record<string, never>) => Promise<readonly { readonly botId: string; readonly name: string }[]>;
	"conversations.snapshot": (params: { readonly botId: string }) => Promise<Snapshot>;
};

let h: AppHarness;

beforeAll(async () => {
	h = await launchApp("runs", { env: { OPENBOT_MAX_ACTIVE_RUNS: "1" } });
	await h.page().getByRole("textbox", { name: "Message OpenBot" }).waitFor();
}, 60_000);

afterAll(async () => {
	await h?.close();
});

/** A Bot's conversation as the Host reports it, through the preload API. */
function snapshotOf(name: string): Promise<Snapshot> {
	return h.page().evaluate(async (botName) => {
		// The preload exposes `openbot` on the renderer window; this suite does not compile against the desktop types.
		const renderer = window as unknown as { readonly openbot: { readonly methods: Methods } };
		const { methods } = renderer.openbot;
		const bot = (await methods["bots.list"]({})).find((candidate) => candidate.name === botName);
		if (bot === undefined) throw new Error(`No Bot named ${botName}`);
		return methods["conversations.snapshot"]({ botId: bot.botId });
	}, name);
}

async function openBot(name: string): Promise<void> {
	const page = h.page();
	await page.locator(".bot-row", { hasText: name }).click();
	await page.getByRole("textbox", { name: `Message ${name}` }).waitFor();
}

describe("Runs", () => {
	it("second Bot waits for a free slot", async () => {
		const page = h.page();
		h.model.script(
			{ tool: "local_exec", args: { command: "echo first", description: "Say first" } },
			{ text: "Ada is done." },
			{ text: "Bea is done." },
		);
		await createBot(h, "Ada");
		await h.send("Run the first job");
		await page.getByRole("group", { name: "Approval request" }).waitFor();

		await createBot(h, "Bea");
		await h.send("Run the second job");
		await expect.poll(() => page.locator(".bot-row", { hasText: "Bea" }).textContent()).toContain("Queued");
		await page.getByText("Waiting for a free slot").waitFor();
		await page.getByRole("button", { name: "Stop" }).waitFor();
		expect(h.model.requests).toHaveLength(1);
		await h.shot("01-queued");

		await openBot("Ada");
		await page.getByRole("group", { name: "Approval request" }).getByRole("button", { name: "Allow once" }).click();
		await page.getByText("Ada is done.").waitFor();

		await openBot("Bea");
		await page.getByText("Bea is done.").waitFor();
		await expect.poll(() => page.locator(".bot-row", { hasText: "Bea" }).textContent()).not.toContain("Queued");
		await expect.poll(async () => (await snapshotOf("Bea")).run).toBeUndefined();
		await h.shot("02-both-done");
	});

	it("a message sent while working redirects the turn", async () => {
		const page = h.page();
		h.model.script(
			{ tool: "local_exec", args: { command: "sort notes.txt", description: "Read notes" } },
			{ text: "Switched to the other file." },
		);
		await h.send("Read notes.txt");
		const card = page.getByRole("group", { name: "Approval request" });
		await card.waitFor();
		const requestsBefore = h.model.requests.length;

		await h.send("Use a different file");
		// Shown at once, before the Bot reads it after the current tool round.
		await page.locator(".message-user.is-pending", { hasText: "Use a different file" }).waitFor();
		const working = await snapshotOf("Bea");
		expect(working.run?.state).toBe("running");
		expect(working.run?.requestIds).toHaveLength(2);
		await h.shot("03-steer-pending");

		await card.getByRole("button", { name: "Allow once" }).click();
		await page.getByText("Switched to the other file.").waitFor();
		// The next model request after the tool round already carries the steer, and nothing else ran in between.
		expect(h.model.requests).toHaveLength(requestsBefore + 1);
		expect(JSON.stringify(h.model.requests.at(-1)?.messages)).toContain("Use a different file");
		await expect.poll(async () => (await snapshotOf("Bea")).run).toBeUndefined();
		await h.shot("04-steered");
	});

	it("Stop cancels the running Run", async () => {
		const page = h.page();
		h.model.script({ tool: "local_exec", args: { command: "sleep 30", description: "Wait a while" } });
		await h.send("Wait for half a minute");
		await page.getByRole("group", { name: "Approval request" }).getByRole("button", { name: "Allow once" }).click();
		await page.locator(".tool-card.tool-running", { hasText: "Wait a while" }).waitFor();
		const runId = (await snapshotOf("Bea")).run?.runId;
		expect(runId).toBeDefined();

		await page.getByRole("button", { name: "Stop" }).click();
		await page.locator(".tool-card.tool-cancelled", { hasText: "Wait a while" }).waitFor();
		await page.getByRole("note").filter({ hasText: "Stopped" }).waitFor();
		await expect.poll(async () => (await snapshotOf("Bea")).run).toBeUndefined();
		await page.getByRole("button", { name: "Stop" }).waitFor({ state: "hidden" });
		await h.shot("05-stopped");

		// The next message starts a new Run instead of joining the stopped one.
		h.model.script({ tool: "local_exec", args: { command: "echo again", description: "Say again" } }, { text: "Fresh start." });
		await h.send("Start over");
		await page.getByRole("group", { name: "Approval request" }).waitFor();
		const next = (await snapshotOf("Bea")).run;
		expect(next?.state).toBe("running");
		expect(next?.runId).not.toBe(runId);
		expect(next?.requestIds).toHaveLength(1);
		await page.getByRole("group", { name: "Approval request" }).getByRole("button", { name: "Allow once" }).click();
		await page.getByText("Fresh start.").waitFor();
		await h.shot("06-new-run");
	});
});
