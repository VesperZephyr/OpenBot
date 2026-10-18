import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { type AppHarness, launchApp } from "./harness.ts";
let h: AppHarness, core: string;
const groupId = "group_experience";
const api = (name: string, params = {}): Promise<any> =>
	h.page().evaluate(({ name, params }) => (window as any).openbot.methods[name](params), { name, params });
const poll = (fn: () => Promise<any>) => expect.poll(fn, { timeout: 15000 });
const box = () => h.page().locator(".compose-area textarea");
const openGroup = async () => {
	await h.page().locator(".group-nav").filter({ hasText: "Research studio" }).click();
	await h.page().getByRole("heading", { name: "Research studio" }).waitFor();
};
const openBot = async (name: string) => {
	await h.page().locator(".sidebar .bot-row").filter({ hasText: name }).click();
	await h.page().locator(".conversation-name").filter({ hasText: name }).waitFor();
};
const group = () => api("groups.snapshot", { groupId });
beforeAll(async () => {
	h = await launchApp("conversation-experience");
	h.page().setDefaultTimeout(8000);
	await api("settings.update", { defaultModel: { provider: "scripted", modelId: "scripted" } });
	core = (await api("bots.list")).find((b: any) => b.kind === "core").botId;
	for (const name of ["Analyst", "Reviewer"])
		await api("bots.create", {
			requestId: name.toLowerCase(),
			name,
			role: name === "Analyst" ? "Research specialist" : "Review specialist",
		});
	await api("groups.change", {
		requestId: "create",
		groupId,
		action: "create",
		expectedRevision: 0,
		fields: {
			name: "Research studio",
			objective: "A clear, checked answer",
			memberIds: ["bot_analyst", "bot_reviewer"],
			leadBotId: "bot_analyst",
		},
	});
});
afterEach(async ({ task }) => {
	if (task.result?.state === "fail") await h.shot("failure");
});
afterAll(async () => {
	await h?.close();
});

it("keeps private and group drafts through filtering, details, locale and restart; New and Escape restore focus", async () => {
	await openBot("Analyst");
	await box().fill("Private 草稿");
	await openGroup();
	await box().fill("Group 草稿");
	await openBot("Reviewer");
	await box().fill("Review draft");
	await h.page().keyboard.press("Meta+k");
	const search = h.page().getByRole("searchbox", { name: "Search conversations" });
	expect(await search.evaluate((el) => el === document.activeElement)).toBe(true);
	await search.fill("Research");
	expect(await h.page().locator(".sidebar .bot-row").count()).toBe(2);
	await search.fill("");
	await openBot("Analyst");
	expect(await box().inputValue()).toBe("Private 草稿");
	await h.page().getByRole("button", { name: "Conversation details", exact: true }).click();
	await h.page().getByRole("tab", { name: "Memory", exact: true }).click();
	await h.page().getByRole("textbox", { name: "Memory", exact: true }).waitFor();
	await h.page().getByRole("button", { name: "Close details" }).click();
	expect(await box().inputValue()).toBe("Private 草稿");
	await h.page().getByRole("button", { name: "New", exact: true }).click();
	expect(
		await h
			.page()
			.getByRole("button", { name: /^Create new Bot/ })
			.isVisible(),
	).toBe(true);
	expect(
		await h
			.page()
			.getByRole("button", { name: /^Create group/ })
			.isVisible(),
	).toBe(true);
	await h.page().keyboard.press("Escape");
	expect(await h.page().getByRole("dialog").count()).toBe(0);
	await api("settings.update", { language: "zh-CN" });
	await h.relaunch();
	await openGroup();
	expect(await box().inputValue()).toBe("Group 草稿");
	expect(await h.page().locator("html").getAttribute("lang")).toBe("zh-CN");
	await openBot("Analyst");
	expect(await box().inputValue()).toBe("Private 草稿");
	expect(h.model.requests).toHaveLength(0);
	await api("settings.update", { language: "en" });
	await h.relaunch();
});

it("recovers an acknowledged send with a lost reply without another model call", async () => {
	h.model.script({ text: "Accepted exactly once." });
	// Simulate the persisted window between Host acceptance and renderer acknowledgement.
	const requestId = "lost-ui-ack";
	await h.page().evaluate(
		({ groupId, requestId }) => {
			const key = `group:${groupId}`;
			const disk = JSON.parse(localStorage.getItem("openbot.composers.v1")!);
			disk.records[key] = {
				draft: { version: 1, text: "A newer draft", recipientIds: [], revision: 8, updatedAt: Date.now() },
				attempt: { requestId, conversationKey: key, text: "Accept once", recipientIds: [], draftRevision: 7, state: "pending" },
			};
			localStorage.setItem("openbot.composers.v1", JSON.stringify(disk));
		},
		{ groupId, requestId },
	);
	await api("groups.send", { groupId, requestId, text: "Accept once" });
	await poll(async () => (await group()).roots.at(-1)?.state).toBe("completed");
	const calls = h.model.requests.length;
	await h.relaunch();
	await openGroup();
	await h.page().getByText("Message delivery is uncertain", { exact: true }).waitFor();
	expect(h.model.requests.length).toBe(calls);
	await h.page().getByRole("button", { name: "Retry send", exact: true }).click();
	await poll(async () => h.page().getByText("Message delivery is uncertain", { exact: true }).count()).toBe(0);
	expect(await box().inputValue()).toBe("A newer draft");
	expect(h.model.requests.length).toBe(calls);
	expect((await group()).posts.filter((p: any) => p.text === "Accept once")).toHaveLength(1);
});

it("mentions are keyboard accessible, IME-safe and never silently redirect removed recipients", async () => {
	await box().fill("@Re");
	await box().press("ArrowDown");
	await box().press("Enter");
	expect(await h.page().getByRole("button", { name: "Remove Reviewer" }).isVisible()).toBe(true);
	await box().fill("检查一下");
	await box().dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true, bubbles: true });
	expect(await box().inputValue()).toBe("检查一下");
	const before = h.model.requests.length;
	const previous = (await group()).group;
	await api("groups.change", {
		requestId: "remove",
		groupId,
		action: "update",
		expectedRevision: previous.revision,
		fields: { name: previous.name, objective: previous.objective, memberIds: ["bot_analyst", core], leadBotId: "bot_analyst" },
	});
	await h.page().getByText("A selected Bot is no longer available. Remove it or choose Core before sending.").waitFor();
	expect(await h.page().getByRole("button", { name: "Send", exact: true }).isDisabled()).toBe(true);
	expect(h.model.requests.length).toBe(before);
	await h.page().getByRole("button", { name: "Core · automatic", exact: true }).click();
	h.model.script({ text: "Core received the explicit new choice." });
	await box().press("Enter");
	await poll(async () => (await group()).posts.at(-1)?.text).toBe("Core received the explicit new choice.");
	expect((await group()).posts.at(-1).senderId).toBe(core);
	const changed = (await group()).group;
	await api("groups.change", {
		requestId: "restore",
		groupId,
		action: "update",
		expectedRevision: changed.revision,
		fields: { name: previous.name, objective: previous.objective, memberIds: previous.memberIds, leadBotId: previous.leadBotId },
	});
	await box().fill("@An");
	await h.page().getByRole("option", { name: "@Analyst" }).waitFor();
	await box().press("Escape");
	expect(await h.page().getByRole("listbox").count()).toBe(0);
	await box().fill("@Re");
	await h.page().getByRole("option", { name: "@Reviewer", exact: true }).waitFor();
	await box().press("Tab");
	expect(await h.page().getByRole("button", { name: "Remove Reviewer" }).isVisible()).toBe(true);
	h.model.script({ text: "Reviewer replied directly." });
	await box().fill("Review now");
	await box().press("Enter");
	await poll(async () => (await group()).posts.at(-1)?.text).toBe("Reviewer replied directly.");
	expect((await group()).posts.at(-1).senderId).toBe("bot_reviewer");
	expect(await h.page().getByRole("button", { name: "Core · automatic" }).getAttribute("aria-pressed")).toBe("true");
});

it("preserves reading position for private and group updates and renders bilingual small/dark layouts", async () => {
	for (const kind of ["private", "group"]) {
		if (kind === "private") await openBot("Analyst");
		else await openGroup();
		const answer = Array.from({ length: 45 }, (_, i) => `${kind} finding ${i + 1}: A concrete observation with evidence.`).join("\n\n");
		h.model.script({ text: answer });
		await box().fill(`Write ${kind} findings`);
		await box().press("Enter");
		await h.page().getByText(`${kind} finding 45: A concrete observation with evidence.`, { exact: true }).waitFor();
		const timeline = h.page().locator(".timeline-scroll");
		await timeline.evaluate((el) => {
			el.scrollTop = 100;
			el.dispatchEvent(new Event("scroll", { bubbles: true }));
		});
		const top = await timeline.evaluate((el) => el.scrollTop);
		h.model.script({ text: `${kind} new update` });
		if (kind === "private") await api("messages.submit", { botId: "bot_analyst", requestId: "history-private", text: "More" });
		else await api("groups.send", { groupId, requestId: "history-group", text: "More" });
		await h.page().getByText(`${kind} new update`, { exact: true }).waitFor();
		expect(Math.abs((await timeline.evaluate((el) => el.scrollTop)) - top)).toBeLessThan(3);
		await h
			.page()
			.getByRole("button", { name: /New activity/ })
			.waitFor();
		await h.page().getByRole("button", { name: "Conversation details", exact: true }).click();
		await h.page().getByRole("button", { name: "Close details" }).click();
		expect(Math.abs((await timeline.evaluate((el) => el.scrollTop)) - top)).toBeLessThan(3);
		await h
			.page()
			.getByRole("button", { name: /New activity/ })
			.click();
		await poll(async () => timeline.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(85);
	}
	await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900));
	await h.page().emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
	await h.shot("01-group-light-en");
	await h.page().getByRole("button", { name: "Conversation details", exact: true }).click();
	await h.shot("02-details-en");
	await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(880, 700));
	await h.page().getByRole("dialog", { name: "Conversation details" }).waitFor();
	await h.page().keyboard.press("Tab");
	expect(
		await h
			.page()
			.getByRole("dialog")
			.evaluate((el) => el.contains(document.activeElement)),
	).toBe(true);
	await h.page().keyboard.press("Escape");
	await api("settings.update", { language: "zh-CN" });
	await h.relaunch();
	await openGroup();
	await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(880, 700));
	await h.page().emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
	await h.shot("03-group-dark-zh-small");
	expect(await h.page().evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await box().fill("解散前的草稿");
	const current = (await group()).group;
	await api("groups.change", { requestId: "dissolve", groupId, action: "dissolve", expectedRevision: current.revision });
	await h.page().getByRole("button", { name: "复制草稿" }).waitFor();
	expect(await box().inputValue()).toBe("解散前的草稿");
	expect(await box().getAttribute("readonly")).not.toBeNull();
	await h.shot("04-dissolved-draft-zh");
});

it("keeps long names and code readable at minimum width without page overflow", async () => {
	await api("settings.update", { language: "en" });
	await h.relaunch();
	const name = "Research and verification specialist · 长名称与代码布局检查";
	await api("bots.create", { requestId: "long-name", name });
	await openBot(name);
	await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(880, 700));
	h.model.script({
		text: "A local result to inspect.\n\n```text\n" + "evidence/".repeat(60) + "\n```\n\nThe long line scrolls inside its code block.",
	});
	await box().fill("Show a code result");
	await box().press("Enter");
	await h.page().getByText("The long line scrolls inside its code block.", { exact: true }).waitFor();
	expect(await h.page().evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	expect(
		await h
			.page()
			.locator(".timeline-scroll pre")
			.evaluate((el) => el.scrollWidth > el.clientWidth),
	).toBe(true);
	await h.shot("05-long-name-code-small");
	await h.page().getByRole("button", { name: "Conversation details", exact: true }).click();
	await h.page().getByRole("dialog", { name: "Conversation details" }).waitFor();
	await h.page().keyboard.press("Shift+Tab");
	expect(
		await h
			.page()
			.getByRole("dialog")
			.evaluate((el) => el.contains(document.activeElement)),
	).toBe(true);
	await h.page().keyboard.press("Escape");
	expect(
		await h
			.page()
			.getByRole("button", { name: "Conversation details", exact: true })
			.evaluate((el) => el === document.activeElement),
	).toBe(true);
});
