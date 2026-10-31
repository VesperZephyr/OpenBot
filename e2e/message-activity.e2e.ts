import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { launchApp, type AppHarness } from "./harness.ts";

let h: AppHarness, botId: string;
const button = (name: string) => h.page().getByRole("button", { name, exact: true });
beforeAll(async () => {
	h = await launchApp("message-activity");
	await h.api("settings.update", { defaultModel: { provider: "scripted", modelId: "scripted" } });
	const bot = await h.api("bots.create", { requestId: "updates", name: "Evidence Bot" });
	botId = bot.botId;
	await h.page().locator(".chat-list .bot-row").filter({ hasText: "Evidence Bot" }).click();
}, 60000);
afterEach(async ({ task }) => {
	if (task.result?.state === "fail") await h.shot("failure");
});
afterAll(async () => {
	await h?.close();
});

it("shows deliberate updates, hides ordinary prose, and keeps approvals and the canonical answer", async () => {
	const before = h.model.requests.length;
	h.model.script(
		{ tool: "send_message", args: { text: "I found the relevant source." }, preface: "HIDDEN_INTERMEDIATE_SENTINEL" },
		{ tool: "local_exec", args: { command: "sleep 2; printf verified", description: "Verify the source" } },
		{ chunks: ["## Verified result\n\n", "The source passed the check."], delayMs: 500, chunkDelayMs: 700 },
	);
	await h.send("Verify this source");
	await h.page().getByText("I found the relevant source.", { exact: true }).waitFor();
	await button("Allow once").waitFor();
	expect(await h.page().getByText("HIDDEN_INTERMEDIATE_SENTINEL", { exact: true }).count()).toBe(0);
	expect(await button("Stop").isVisible()).toBe(true);
	await h.shot("01-update-approval-light");
	await button("Allow once").click();
	await expect.poll(() => h.page().locator(".reply-activity").textContent()).toBe("Waiting for result");
	await h.page().getByRole("heading", { name: "Verified result" }).waitFor();
	await expect.poll(() => h.page().locator(".live-reply").count()).toBe(0);
	expect(h.model.requests.length - before).toBe(3);
	expect(JSON.stringify(h.model.requests.at(-1)?.messages)).toContain("HIDDEN_INTERMEDIATE_SENTINEL");
	expect(await h.page().getByRole("heading", { name: "Verified result" }).count()).toBe(1);
	expect(await h.page().locator(".tool-card").filter({ hasText: "send_message" }).count()).toBe(0);
	const history = await h.api("conversations.window", { conversationKey: `bot:${botId}`, position: { kind: "latest" } });
	expect(history.status).toBe("ready");
	const messages = history.window.rows.filter((r: any) => r.content.item?.kind === "assistant");
	expect(messages).toHaveLength(2);
	const ids = messages.map((r: any) => r.id);
	await h.relaunch();
	await h.page().locator(".chat-list .bot-row").filter({ hasText: "Evidence Bot" }).click();
	await h.page().getByRole("heading", { name: "Verified result" }).waitFor();
	const reopened = await h.api("conversations.window", { conversationKey: `bot:${botId}`, position: { kind: "latest" } });
	expect(reopened.window.rows.filter((r: any) => r.content.item?.kind === "assistant").map((r: any) => r.id)).toEqual(ids);
});

it("keeps input-specific Retry after an update and a restart", async () => {
	h.model.script({ tool: "send_message", args: { text: "The first check is complete." } }, { error: "PRIVATE_PROVIDER_DIAGNOSTIC" });
	await h.send("Retry exactly this request");
	await button("Retry").waitFor();
	expect(await h.page().getByText("The first check is complete.", { exact: true }).count()).toBe(1);
	expect(await h.page().getByText("PRIVATE_PROVIDER_DIAGNOSTIC", { exact: false }).count()).toBe(0);
	await h.relaunch();
	await h.page().locator(".chat-list .bot-row").filter({ hasText: "Evidence Bot" }).click();
	await button("Retry").waitFor();
	h.model.script({ text: "The retry succeeded." });
	await button("Retry").click();
	await h.page().getByText("The retry succeeded.", { exact: true }).waitFor();
	expect(JSON.stringify(h.model.requests.at(-1)?.messages)).toContain("Retry exactly this request");
	await expect.poll(() => button("Retry").count()).toBe(0);
});

it("renders fixed feedback accessibly in a narrow Chinese dark view", async () => {
	await button("Settings").click();
	await h.page().getByRole("radio", { name: "Dark", exact: true }).check();
	await button("Back to chat").click();
	await h.api("settings.update", { language: "zh-CN" });
	await h.page().emulateMedia({ reducedMotion: "reduce" });
	await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(880, 700));
	h.model.script({ tool: "send_message", args: { text: "已找到所需资料，正在核对。" } }, { text: "核对完成。", delayMs: 2500 });
	const composer = h.page().getByRole("textbox", { name: "发送消息给 Evidence Bot" });
	await composer.fill("继续核对");
	await composer.press("Enter");
	await h.page().getByText("已找到所需资料，正在核对。", { exact: true }).waitFor();
	await expect.poll(() => h.page().locator(".reply-activity").textContent()).toBe("正在生成回复");
	expect(await h.page().locator(".reply-activity").getAttribute("role")).toBe("status");
	expect(
		await h
			.page()
			.locator(".activity-dots i")
			.first()
			.evaluate((el) => getComputedStyle(el).animationName),
	).toBe("none");
	expect(await button("停止").isVisible()).toBe(true);
	await h.nextFrame();
	await h.shot("02-update-chinese-dark");
	await h.page().getByText("核对完成。", { exact: true }).waitFor();
});
