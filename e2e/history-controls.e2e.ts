import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { launchApp, createBot, type AppHarness } from "./harness.ts";
let h: AppHarness;
beforeAll(async () => {
	h = await launchApp("history-controls");
	await createBot(h, "History controls");
});
afterAll(async () => {
	await h?.close();
});
it("keeps approvals, drafts and Stop usable when history reads fail, then recovers without replaying a tool", async () => {
	await h.app().evaluate(({ ipcMain }) => {
		const original = (ipcMain as any)._invokeHandlers.get("openbot:call");
		(globalThis as any).historyOriginal = original;
		(globalThis as any).historyFail = true;
		ipcMain.removeHandler("openbot:call");
		ipcMain.handle("openbot:call", async (event, method, params) => {
			if (method === "conversations.indexRetry") (globalThis as any).historyFail = false;
			return method === "conversations.window" && (globalThis as any).historyFail
				? { status: "unavailable", retryable: true }
				: original(event, method, params);
		});
	});
	try {
		h.model.script(
			{ tool: "local_exec", args: { command: "printf receipt >> history-control-receipts.txt", description: "Verify live approval" } },
			{ text: "Approved while history was unavailable." },
		);
		await h.send("Run the approval probe");
		await h.page().locator(".history-status").filter({ hasText: "History is unavailable" }).waitFor();
		await h.page().getByRole("button", { name: "Allow once", exact: true }).waitFor();
		await h.page().locator(".compose-area textarea").fill("Preserved draft 星图");
		await h.shot("01-unavailable-approval");
		await h.page().getByRole("button", { name: "Allow once", exact: true }).click();
		await expect
			.poll(async () => (await h.api("bots.list")).find((b: any) => b.name === "History controls")?.lastRun?.state, { timeout: 20000 })
			.toBe("completed");
		expect(await h.page().locator(".compose-area textarea").inputValue()).toBe("Preserved draft 星图");
		h.model.script({ chunks: ["Must be stopped"], delayMs: 15000, chunkDelayMs: 100 });
		await h.send("Wait for cancellation");
		await expect.poll(() => h.page().locator(".live-reply .reply-activity").textContent(), { timeout: 15000 }).toBe("Thinking…");
		await h.page().getByRole("button", { name: "Stop", exact: true }).click();
		await expect
			.poll(async () => (await h.api("bots.list")).find((b: any) => b.name === "History controls")?.lastRun?.state, { timeout: 20000 })
			.toBe("cancelled");
		await h.page().locator(".history-status").getByRole("button", { name: "Retry", exact: true }).click();
	} finally {
		await h.app().evaluate(({ ipcMain }) => {
			ipcMain.removeHandler("openbot:call");
			ipcMain.handle("openbot:call", (globalThis as any).historyOriginal);
		});
	}
	await h.page().getByText("Approved while history was unavailable.", { exact: true }).waitFor();
	expect(await readFile(join(h.workspace, "history-control-receipts.txt"), "utf8")).toBe("receipt");
	await h.shot("02-history-recovered");
});

it("opens a completed group execution through its bounded private delivery window", async () => {
	const bots = await h.api("bots.list"),
		bot = bots.find((b: any) => b.name === "History controls");
	const other = await h.api("bots.create", { requestId: "history-reviewer", name: "Reviewer", role: "Review evidence" });
	await h.api("groups.change", {
		requestId: "history-group",
		action: "create",
		groupId: "group_history_controls",
		expectedRevision: 0,
		fields: { name: "History details", objective: "Inspect delivery", memberIds: [bot.botId, other.botId], leadBotId: bot.botId },
	});
	h.model.script({ text: "Private execution final evidence." });
	await h.api("groups.send", {
		groupId: "group_history_controls",
		requestId: "history-delivery",
		text: "Inspect this delivery",
		recipientIds: [bot.botId],
	});
	await h
		.page()
		.locator(".bot-row")
		.filter({ has: h.page().getByText("History details", { exact: true }) })
		.click();
	await h.page().getByText("Private execution final evidence.", { exact: true }).waitFor();
	await h.page().getByRole("button", { name: "Execution details", exact: true }).click();
	await h.page().locator(".execution-timeline").getByText("Private execution final evidence.", { exact: true }).waitFor();
	const group = await h.api("groups.snapshot", { groupId: "group_history_controls", history: "omit" });
	expect(group.posts).toEqual([]);
	expect(group.tasks).toEqual([]);
	expect(await h.page().locator(".execution-timeline [data-history-row]").count()).toBeLessThanOrEqual(80);
	await h.shot("03-group-execution-window");
});
