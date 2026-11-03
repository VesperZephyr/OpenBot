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
		const bot = () => h.api("bots.list").then((bots: any[]) => bots.find((b) => b.name === "History controls"));
		await expect.poll(async () => (await bot())?.lastRun?.state, { timeout: 20000 }).toBe("completed");
		const finished = (await bot()).lastRun.runId as string;
		expect(await h.page().locator(".compose-area textarea").inputValue()).toBe("Preserved draft 星图");
		// The settled answer can still be on screen as "Generating response" while the renderer catches up.
		// Stop must target the next Run, and that Run must still be in flight when Stop is clicked.
		await expect.poll(() => h.page().locator(".live-reply").count()).toBe(0);
		const held = Promise.withResolvers<void>();
		h.model.script({ text: "Must be stopped", wait: held.promise });
		try {
			await h.send("Wait for cancellation");
			await expect
				.poll(async () => {
					const run = (await bot())?.lastRun;
					return run && run.runId !== finished ? run.state : "";
				})
				.toBe("running");
			await expect.poll(() => h.page().locator(".live-reply .reply-activity").textContent()).toBe("Generating response");
			await h.page().getByRole("button", { name: "Stop", exact: true }).click();
			await expect.poll(async () => (await bot())?.lastRun?.state, { timeout: 20000 }).toBe("cancelled");
		} finally {
			held.resolve();
		}
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

it.each(["unavailable", "building"])("keeps Continue usable while history is %s without duplicating recovered controls", async (status) => {
	await h.page().locator(".chat-list .bot-row").filter({ has: h.page().getByText("History controls", { exact: true }) }).click();
	const bot = (await h.api("bots.list")).find((b: any) => b.name === "History controls");
	await h.app().evaluate(({ ipcMain }, status) => {
		const original = (ipcMain as any)._invokeHandlers.get("openbot:call");
		(globalThis as any).historyOriginal = original;
		(globalThis as any).historyFail = true;
		ipcMain.removeHandler("openbot:call");
		ipcMain.handle("openbot:call", (event, method, params) =>
			method === "conversations.window" && (globalThis as any).historyFail
				? { status, retryable: status === "unavailable" }
				: original(event, method, params));
	}, status);
	try {
		h.model.script({ text: "Interrupted answer must stay hidden", delayMs: 15000 });
		await h.send(`Interrupt while history is ${status}`);
		await expect.poll(() => h.page().locator(".reply-activity").textContent()).toBe("Generating response");
		await h.api("lifecycle.pause", {});
		await expect.poll(async () => (await h.api("bots.list")).find((b: any) => b.botId === bot.botId)?.lastRun?.state).toBe("needs_attention");
		await h.page().locator(".live-reply").waitFor({ state: "detached" });
		const interrupted = (await h.api("bots.list")).find((b: any) => b.botId === bot.botId).lastRun;
		const resume = h.page().getByRole("button", { name: "Resume and continue", exact: true });
		await expect.poll(() => resume.count()).toBe(1);
		expect(await resume.isEnabled()).toBe(true);
		await h.shot(`04-continue-${status}`);
		if (status === "building") {
			await h.app().evaluate(() => { (globalThis as any).historyFail = false; });
			await h.page().locator(".history-status").waitFor({ state: "detached" });
			await h.page().locator(`.history-row[data-history-row="run-outcome:${interrupted.runId}"] .interrupted-run`).waitFor();
			expect(await resume.count()).toBe(1);
			await h.shot("05-continue-history-recovered");
		}
		h.model.script({ text: `Continued with ${status} history.` });
		await resume.click();
		await expect.poll(async () => (await h.api("bots.list")).find((b: any) => b.botId === bot.botId)?.lastRun?.state).toBe("completed");
		await expect.poll(() => h.page().locator(".interrupted-run").count()).toBe(0);
	} finally {
		await h.app().evaluate(({ ipcMain }) => {
			ipcMain.removeHandler("openbot:call");
			ipcMain.handle("openbot:call", (globalThis as any).historyOriginal);
		});
	}
});

it.each(["unavailable", "building"])("keeps input-specific Retry usable while history is %s", async (status) => {
	await h.app().evaluate(({ ipcMain }, status) => {
		const original = (ipcMain as any)._invokeHandlers.get("openbot:call");
		(globalThis as any).historyOriginal = original;
		(globalThis as any).historyFail = true;
		ipcMain.removeHandler("openbot:call");
		ipcMain.handle("openbot:call", (event, method, params) =>
			method === "conversations.window" && (globalThis as any).historyFail
				? { status, retryable: status === "unavailable" }
				: original(event, method, params));
	}, status);
	try {
		h.model.script({ error: "PRIVATE_FAILURE" });
		await h.send(`Retry while history is ${status}`);
		const bot = (await h.api("bots.list")).find((b: any) => b.name === "History controls");
		await expect.poll(async () => (await h.api("bots.list")).find((b: any) => b.botId === bot.botId)?.lastRun?.state).toBe("failed");
		const snapshot = await h.api("conversations.snapshot", { botId: bot.botId, history: "omit" });
		const outcome = h.page().locator(`[data-message-id="${snapshot.retry.outcomeId}"]`);
		const retry = outcome.getByRole("button", { name: "Retry", exact: true });
		await retry.waitFor();
		expect(await outcome.count()).toBe(1);
		expect(await h.page().getByText("PRIVATE_FAILURE", { exact: true }).count()).toBe(0);
		await h.shot(`06-retry-${status}`);
		if (status === "building") {
			await h.app().evaluate(() => { (globalThis as any).historyFail = false; });
			await h.page().locator(".history-status").waitFor({ state: "detached" });
			await h.page().locator(`[data-history-row="${snapshot.retry.outcomeId}"]`).waitFor();
			expect(await outcome.count()).toBe(1);
		}
		h.model.script({ text: `Retried with ${status} history.` });
		await retry.click();
		await expect.poll(async () => (await h.api("bots.list")).find((b: any) => b.botId === bot.botId)?.lastRun?.state).toBe("completed");
		expect(JSON.stringify(h.model.requests.at(-1)?.messages)).toContain(`Retry while history is ${status}`);
		await expect.poll(() => h.page().locator(".message-outcome").getByRole("button", { name: "Retry", exact: true }).count()).toBe(0);
	} finally {
		await h.app().evaluate(({ ipcMain }) => {
			ipcMain.removeHandler("openbot:call");
			ipcMain.handle("openbot:call", (globalThis as any).historyOriginal);
		});
	}
});
