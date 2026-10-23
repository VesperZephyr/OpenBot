import { afterAll, beforeAll, expect, it } from "vitest";
import { type AppHarness, createBot, launchApp } from "./harness.ts";
import type { BotSummary, MemoryState } from "../packages/protocol/src/index.ts";
let h: AppHarness;
let bot: BotSummary;
async function method(name: string, params: unknown = {}): Promise<any> {
	return h.page().evaluate(({ name, params }) => (window as any).openbot.methods[name](params), { name, params });
}
async function edit(memory = true, chinese = false): Promise<void> {
	await h.page().getByRole("button", { name: "•••" }).click();
	await h
		.page()
		.getByRole("menuitem", { name: chinese ? "编辑资料" : "Edit profile" })
		.click();
	if (memory)
		await h
			.page()
			.getByRole("tab", { name: chinese ? "记忆" : "Memory" })
			.click();
}
beforeAll(async () => {
	h = await launchApp("memory-controls");
	await createBot(h, "Cedar");
	bot = (await method("bots.list")).find((item: BotSummary) => item.name === "Cedar");
}, 90_000);
afterAll(async () => {
	await h?.close();
});

it("shows local provenance, protects drafts, clears and restores a previewed version", async () => {
	const page = h.page();
	await edit();
	const input = page.getByRole("textbox", { name: "Memory", exact: true });
	await input.fill("## Preferences\nTea 茶");
	await page.getByRole("button", { name: "Save memory" }).click();
	await edit();
	await expect.poll(() => input.inputValue()).toBe("## Preferences\nTea 茶");
	await input.fill("My unsaved correction");
	// Concurrent model write through the real routed tool while the editor stays open.
	h.model.script(
		{ tool: "memory_update", args: { action: "append", section: "Morning preference", content: "Quiet mornings", expectedRevision: 1 } },
		{ text: "Saved the preference." },
	);
	await method("messages.submit", { botId: bot.botId, requestId: "memory-race", text: "Remember quiet mornings" });
	await expect.poll(async () => (await method("bots.memory.get", { botId: bot.botId })).revision).toBe(2);
	await page.getByRole("button", { name: "Save memory" }).click();
	await page.getByRole("alert").filter({ hasText: "Memory changed" }).waitFor();
	expect(await input.inputValue()).toBe("My unsaved correction");
	await h.shot("01-conflict-keeps-draft");
	await page.getByRole("button", { name: "Reload memory" }).click();
	await expect.poll(() => input.inputValue()).toContain("Quiet mornings");
	await page.getByText("Learned by this Bot", { exact: false }).first().waitFor();
	await page.getByRole("button", { name: "Clear draft" }).click();
	expect(await input.inputValue()).toBe("");
	expect((await method("bots.memory.get", { botId: bot.botId })).revision).toBe(2);
	await page.getByRole("button", { name: "Save memory" }).click();
	await edit();
	await page.getByText("Previous versions", { exact: true }).click();
	await page.getByLabel("Version to preview").selectOption("1");
	await page.locator(".memory-preview").filter({ hasText: "Tea 茶" }).waitFor();
	await h.shot("02-history-preview");
	await page.getByRole("button", { name: "Restore this version" }).click();
	await expect.poll(() => input.inputValue()).toBe("## Preferences\nTea 茶");
	expect(await method("bots.memory.get", { botId: bot.botId })).toMatchObject({ revision: 4, source: "restore", restoredFrom: 1 });
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
});

it("protects Prompt drafts and applies the saved revision to the next model request", async () => {
	const page = h.page();
	await edit(false);
	const prompt = page.getByLabel("Prompt", { exact: true });
	await prompt.fill("Reply with CEDAR_PROMPT.");
	await method("bots.update", { botId: bot.botId, name: "Cedar", expectedRevision: bot.revision });
	await page.getByRole("button", { name: "Save profile" }).click();
	await page.getByRole("alert").filter({ hasText: "Profile changed" }).waitFor();
	await h.shot("04-profile-conflict");
	expect(await prompt.inputValue()).toBe("Reply with CEDAR_PROMPT.");
	await page.getByRole("button", { name: "Reload profile" }).click();
	await expect.poll(() => prompt.inputValue()).toBe("");
	await prompt.fill("Reply with CEDAR_PROMPT.");
	await page.getByRole("button", { name: "Save profile" }).click();
	// Saving closes a modal editor asynchronously; its inert chat cannot receive Enter yet.
	await page.getByRole("dialog", { name: "Conversation details", exact: true }).waitFor({ state: "hidden" });
	h.model.script({ text: "CEDAR_PROMPT" });
	await h.send("Hello");
	await page.getByText("CEDAR_PROMPT", { exact: true }).waitFor();
	const request = JSON.stringify(
		h.model.requests.at(-1)?.messages.filter((message) => message.role === "system" || message.role === "developer"),
	);
	expect(request).toContain("OpenBot profile revision: 3");
	expect(request).toContain("Reply with CEDAR_PROMPT.");
	expect(request).toContain("Tea 茶");
});

it("duplicates settings with empty memory and keeps source memory after restart", async () => {
	const page = h.page();
	await page.getByRole("button", { name: "•••" }).click();
	await page.getByRole("menuitem", { name: "Duplicate", exact: true }).click();
	await page.getByRole("textbox", { name: "Message Cedar (copy)" }).waitFor();
	const copy = (await method("bots.list")).find((item: BotSummary) => item.name === "Cedar (copy)");
	expect(copy.instructions).toBe("Reply with CEDAR_PROMPT.");
	expect(await method("bots.memory.get", { botId: copy.botId })).toMatchObject({ content: "", revision: 0, history: [] });
	expect((await method("conversations.snapshot", { botId: copy.botId })).items).toEqual([]);
	await h.relaunch();
	expect(await method("bots.memory.get", { botId: bot.botId })).toMatchObject({ revision: 4, content: "## Preferences\nTea 茶" });
});

it("offers Chinese memory controls, preserves source text, and rejects oversized UTF-8 drafts", async () => {
	const page = h.page();
	await page.getByRole("button", { name: /^Settings/ }).click();
	await page.getByLabel("Language", { exact: true }).selectOption("zh-CN");
	await page.getByRole("button", { name: /Cedar/, exact: false }).filter({ hasNotText: "copy" }).first().click();
	await edit(true, true);
	const input = page.getByRole("textbox", { name: "记忆", exact: true });
	await expect.poll(() => input.inputValue()).toBe("## Preferences\nTea 茶");
	await input.fill("中".repeat(2731));
	expect(await page.getByRole("button", { name: "保存记忆" }).isDisabled()).toBe(true);
	await page.getByRole("button", { name: "重新加载记忆" }).click();
	await expect.poll(() => input.inputValue()).toBe("## Preferences\nTea 茶");
	await input.fill("我的草稿");
	await method("bots.memory.update", { botId: bot.botId, content: "Concurrent correction", expectedRevision: 4 });
	await page.getByRole("button", { name: "保存记忆" }).click();
	await page.getByRole("alert").filter({ hasText: "记忆已变更" }).waitFor();
	expect(await input.inputValue()).toBe("我的草稿");
	await page.getByRole("button", { name: "重新加载记忆" }).click();
	await expect.poll(() => input.inputValue()).toBe("Concurrent correction");
	await page.getByText("历史版本", { exact: true }).click();
	await page.getByLabel("预览版本").selectOption("3");
	await page.getByText("空白记忆", { exact: true }).waitFor();
	await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(880, 560));
	await page.getByRole("button", { name: "恢复此版本" }).scrollIntoViewIfNeeded();
	await h.shot("03-chinese-memory-small");
	await page.getByRole("button", { name: "恢复此版本" }).click();
	await expect.poll(() => input.inputValue()).toBe("");
	expect(((await method("bots.memory.get", { botId: bot.botId })) as MemoryState).revision).toBe(6);
	await page.getByRole("button", { name: "取消", exact: true }).click();
});
