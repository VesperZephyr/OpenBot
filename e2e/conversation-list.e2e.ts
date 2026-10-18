import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { launchApp, type AppHarness } from "./harness.ts";
let h: AppHarness, core: string;
const groupId = "group_inbox";
const api = (name: string, params = {}): Promise<any> =>
	h.page().evaluate(({ name, params }) => (window as any).openbot.methods[name](params), { name, params });
const poll = (fn: () => Promise<any>) => expect.poll(fn, { timeout: 15000 });
const summary = async (key: string) => (await api("conversations.list")).find((r: any) => r.conversationKey === key);
const botRow = (name: string) =>
	h
		.page()
		.locator(".sidebar .bot-row:not(.group-nav)")
		.filter({ has: h.page().locator(".roster-name", { hasText: name }) });
const groupRow = () => h.page().locator(".group-nav").filter({ hasText: "Research studio" });
const box = () => h.page().locator(".compose-area textarea");
const privateReply = async (requestId: string, text: string) => {
	h.model.script({ text });
	await api("messages.submit", { botId: "bot_alpha", requestId, text: requestId });
	await poll(async () => (await summary("bot:bot_alpha"))?.latest?.text).toBe(text.slice(0, 160));
	await poll(async () => (await api("bots.list")).find((b: any) => b.botId === "bot_alpha").lastRun?.state).toBe("completed");
};
/** Simulate the native activity signal and document focus; the actual window stays hidden/non-focusable. */
const foreground = async (value: boolean) => {
	await h.app().evaluate(({ BrowserWindow }, active) => {
		const window = BrowserWindow.getAllWindows()[0]!;
		if (window.isVisible() || window.isFocusable()) throw Error("The test app must stay in background mode");
		window.webContents.send("openbot:window-active", active);
	}, value);
	await h.page().evaluate((visible) => {
		Object.defineProperty(document, "hasFocus", { configurable: true, value: () => visible });
		Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (visible ? "visible" : "hidden") });
		document.dispatchEvent(new Event("visibilitychange"));
		window.dispatchEvent(new Event(visible ? "focus" : "blur"));
	}, value);
};
beforeAll(async () => {
	h = await launchApp("conversation-list");
	h.page().setDefaultTimeout(8000);
	await api("settings.update", { defaultModel: { provider: "scripted", modelId: "scripted" } });
	core = (await api("bots.list")).find((b: any) => b.kind === "core").botId;
	for (const name of ["Alpha", "Reviewer"]) await api("bots.create", { requestId: name.toLowerCase(), name, role: "Research specialist" });
	await api("groups.change", {
		requestId: "create",
		groupId,
		action: "create",
		expectedRevision: 0,
		fields: {
			name: "Research studio",
			objective: "Independent public results",
			memberIds: ["bot_alpha", "bot_reviewer"],
			leadBotId: "bot_alpha",
		},
	});
});
afterEach(async ({ task }) => {
	if (task.result?.state === "fail") await h.shot("failure");
});
afterAll(async () => {
	await h?.close();
});

it("shows durable private previews/unread with drafts and does not read a hidden opened chat", async () => {
	await privateReply("first", "The research is ready.");
	await poll(async () => botRow("Alpha").locator(".bot-row-role").textContent()).toBe("Alpha: The research is ready.");
	expect(await botRow("Alpha").getByLabel("1 unread messages").count()).toBe(1);
	expect(await botRow("Alpha").locator("time").count()).toBe(1);
	await botRow("Alpha").click();
	await box().fill("Keep this draft");
	await h.page().waitForTimeout(650);
	expect((await summary("bot:bot_alpha")).unreadCount).toBe(1);
	expect(await botRow("Alpha").locator(".bot-row-role").textContent()).toBe("Draft: Keep this draft");
	await h.relaunch();
	await poll(async () => botRow("Alpha").getByLabel("1 unread messages").count()).toBe(1);
	await botRow("Alpha").click();
	expect(await box().inputValue()).toBe("Keep this draft");
	await box().fill("");
	await h.shot("01-private-preview-unread-en");
	const order = await h.page().locator(".sidebar .roster-name").allTextContents();
	expect(order[0]).toBe("OpenBot");
	expect(order[1]).toBe("Alpha");
});

it("keeps group/public and private read cursors independent, including delayed acknowledgements", async () => {
	h.model.script({ text: "Core checked the public result." });
	await api("groups.send", { groupId, requestId: "group-one", text: "Check the public result" });
	await poll(async () => (await summary(`group:${groupId}`))?.incomingCount).toBe(1);
	h.model.script({ text: "群聊结论已经核对。" });
	await api("groups.send", { groupId, requestId: "group-two", text: "核对结论", recipientIds: ["bot_alpha"] });
	await poll(async () => (await summary(`group:${groupId}`))?.incomingCount).toBe(2);
	await api("conversations.markRead", { conversationKey: `group:${groupId}`, through: 1 });
	expect((await summary(`group:${groupId}`)).unreadCount).toBe(1);
	expect((await summary("bot:bot_alpha")).unreadCount).toBe(1);
	expect((await summary(`bot:${core}`)).unreadCount).toBe(0);
	await expect(api("conversations.markRead", { conversationKey: `group:${groupId}`, through: 99 })).rejects.toThrow(
		"Invalid reading position",
	);
	await groupRow().click();
	await poll(async () => groupRow().locator(".bot-row-role").textContent()).toBe("Alpha: 群聊结论已经核对。");
	await h.page().getByRole("button", { name: "Mark as read", exact: true }).click();
	await poll(async () => (await summary(`group:${groupId}`)).unreadCount).toBe(0);
	await h.relaunch();
	expect((await summary(`group:${groupId}`)).readThrough).toBe(2);
	await api("bots.update", { botId: "bot_reviewer", pinned: true });
	await poll(async () => h.page().locator(".sidebar .roster-name").allTextContents()).toEqual([
		"OpenBot",
		"Reviewer",
		"Alpha",
		"Research studio",
	]);
});

it("acknowledges only a foreground timeline at its end, leaving history and hidden replies unread", async () => {
	await botRow("Alpha").click();
	const long = Array.from({ length: 50 }, (_, i) => `Finding ${i + 1}: Checked evidence.`).join("\n\n");
	h.model.script({ text: long });
	await api("messages.submit", { botId: "bot_alpha", requestId: "long", text: "Show findings" });
	await h.page().getByText("Finding 50: Checked evidence.", { exact: true }).waitFor();
	const timeline = h.page().locator(".timeline-scroll");
	await timeline.evaluate((el) => {
		el.scrollTop = 80;
		el.dispatchEvent(new Event("scroll", { bubbles: true }));
	});
	await foreground(true);
	await h.page().waitForTimeout(650);
	expect((await summary("bot:bot_alpha")).unreadCount).toBe(2);
	await privateReply("while-reading", "A new result while reading history.");
	await h.page().waitForTimeout(650);
	expect((await summary("bot:bot_alpha")).unreadCount).toBe(3);
	await h
		.page()
		.getByRole("button", { name: /New activity/ })
		.click();
	await poll(async () => (await summary("bot:bot_alpha")).unreadCount).toBe(0);
	await foreground(false);
	await privateReply("hidden-reply", "This reply is still unread in the background.");
	await h.page().waitForTimeout(650);
	expect((await summary("bot:bot_alpha")).unreadCount).toBe(1);
	await h.page().getByRole("button", { name: "New", exact: true }).click();
	await h.page().getByRole("dialog", { name: "New conversation", exact: true }).waitFor();
	await foreground(true);
	await h.page().waitForTimeout(650);
	expect((await summary("bot:bot_alpha")).unreadCount).toBe(1);
	await h.page().keyboard.press("Escape");
	await poll(async () => (await summary("bot:bot_alpha")).unreadCount).toBe(0);
	await foreground(false);
});

it("renders Chinese previews, dissolved history and deleted senders in a small dark window", async () => {
	h.model.script({ text: "中文预览与未读状态。" });
	await api("groups.send", { groupId, requestId: "group-three", text: "给我新结论", recipientIds: ["bot_alpha"] });
	await poll(async () => (await summary(`group:${groupId}`)).incomingCount).toBe(3);
	await api("settings.update", { language: "zh-CN" });
	await h.relaunch();
	await groupRow().click();
	await poll(async () => groupRow().getByLabel("1 条未读消息").count()).toBe(1);
	await box().fill("群聊草稿保留，未读仍然可见");
	await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(880, 700));
	await h.page().emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
	await h.shot("02-group-draft-unread-zh-small");
	expect(await h.page().evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await box().fill("");
	await api("bots.delete", { botId: "bot_alpha" });
	await poll(async () => groupRow().locator(".bot-row-role").textContent()).toBe("已删除的 Bot: 中文预览与未读状态。");
	const g = (await api("groups.list")).find((g: any) => g.groupId === groupId);
	await api("groups.change", { requestId: "dissolve", groupId, action: "dissolve", expectedRevision: g.revision });
	await h.page().getByRole("button", { name: "标记已读", exact: true }).click();
	await poll(async () => (await summary(`group:${groupId}`)).unreadCount).toBe(0);
	await h.shot("03-dissolved-preview-zh-small");
});

it("caps large unread badges and retains them while working, with long names and outgoing previews", async () => {
	await api("bots.update", { botId: "bot_reviewer", name: "Reviewer · Research verification specialist · 长名称布局检查" });
	h.model.script(...Array.from({ length: 100 }, (_, i) => ({ text: `Report ${i + 1} is ready.` })));
	for (let i = 1; i <= 100; i++) {
		await api("messages.submit", { botId: "bot_reviewer", requestId: `bulk-${i}`, text: `Prepare report ${i}` });
		await poll(async () => (await summary("bot:bot_reviewer")).incomingCount).toBe(i);
	}
	await poll(async () => botRow("Reviewer").locator(".unread-count").textContent()).toBe("99+");
	expect(await botRow("Reviewer").getByLabel("100 条未读消息").count()).toBe(1);
	h.model.script({ text: "Final report is ready.", delayMs: 2000 });
	await api("messages.submit", { botId: "bot_reviewer", requestId: "working", text: "Review the final report" });
	await poll(async () => botRow("Reviewer").locator(".bot-row-role").textContent()).toBe("正在处理");
	expect(await botRow("Reviewer").getByLabel("100 条未读消息").count()).toBe(1);
	const current = await summary("bot:bot_reviewer");
	expect(current.latest.senderId).toBe("user");
	expect(current.latest.text).toBe("Review the final report");
	await h.shot("04-working-unread-long-name");
	await poll(async () => (await summary("bot:bot_reviewer")).incomingCount).toBe(101);
	await poll(async () => botRow("Reviewer").locator(".bot-row-role").textContent()).toContain("Final report is ready.");
	expect(await h.page().evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await h.shot("05-large-unread-preview");
});
