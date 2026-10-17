import { afterAll, beforeAll, expect, it } from "vitest";
import { type AppHarness, launchApp } from "./harness.ts";
let h: AppHarness;
beforeAll(async () => { h = await launchApp("locale", { firstLaunch: true }); }, 90_000);
afterAll(async () => { await h?.close(); });

it("defaults to English, supports Chinese onboarding and persists language across restart", async () => {
 let page = h.page();
 await page.getByRole("heading", { name: "Meet OpenBot" }).waitFor();
 expect(await page.locator("html").getAttribute("lang")).toBe("en");
 await h.shot("01-onboarding-en");
 await page.getByLabel("Language", { exact: true }).selectOption("zh-CN");
 await page.getByRole("heading", { name: "认识 OpenBot" }).waitFor();
 await page.getByRole("radio", { name: /自定义服务商/ }).click();
 await page.getByLabel("服务地址", { exact: true }).fill("http://localhost:11434/v1");
 await page.getByLabel("语言", { exact: true }).selectOption("en");
 await page.getByLabel("Base URL", { exact: true }).waitFor();
 expect(await page.getByLabel("Base URL", { exact: true }).inputValue()).toBe("http://localhost:11434/v1");
 await page.getByLabel("Language", { exact: true }).selectOption("zh-CN");
 await page.getByLabel("服务地址", { exact: true }).waitFor();
 await h.shot("02-onboarding-zh");
 await page.getByRole("button", { name: "稍后设置" }).click();
 await page.getByRole("textbox", { name: "发送消息给 OpenBot" }).waitFor();
 await page.getByRole("textbox", { name: "发送消息给 OpenBot" }).fill("Unsent 验收");
 await page.getByRole("button", { name: "发送", exact: true }).click();
 await page.getByRole("status").filter({ hasText: "请先在设置中选择模型" }).waitFor();
 expect(await page.getByRole("textbox", { name: "发送消息给 OpenBot" }).inputValue()).toBe("Unsent 验收");
 await page.getByRole("button", { name: "关闭", exact: true }).click();
 expect(h.model.requests).toHaveLength(0);
 await h.shot("03-conversation-zh");
 await h.relaunch(); page = h.page();
 await page.getByRole("textbox", { name: "发送消息给 OpenBot" }).waitFor();
 expect(await page.locator("html").getAttribute("lang")).toBe("zh-CN");
 await page.getByRole("button", { name: /^设置/ }).click();
 await page.getByLabel("语言", { exact: true }).selectOption("en");
 await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
 await h.shot("04-settings-en");
});

it("preserves user names, instructions and memory while switching languages", async () => {
 const page = h.page();
 await page.getByRole("button", { name: /^New/ }).click();
 await page.getByPlaceholder("Piper").fill("Cedar 研究");
 await page.getByPlaceholder("Piper").press("Enter");
 await page.getByRole("textbox", { name: "Message Cedar 研究" }).fill("Unsent draft 草稿");
 await page.getByRole("button", { name: "•••" }).click();
 await page.getByRole("menuitem", { name: "Edit profile" }).click();
 await page.getByLabel("Description", { exact: true }).fill("Prompt 保持原样");
 // A preference update triggers a refresh while the profile draft is still open.
 await page.evaluate(async () => {
  await (window as any).openbot.methods["settings.update"]({ language: "zh-CN" });
 });
 // The Host setting is authoritative; reopen Settings to refresh the renderer.
 await page.getByRole("button", { name: "Save profile" }).click();
 await page.getByRole("button", { name: /^Settings/ }).click();
 await page.getByRole("heading", { name: "设置", exact: true }).waitFor();
 await page.getByRole("button", { name: /Cedar 研究/ }).click();
 await page.getByRole("button", { name: "•••" }).click();
 await page.getByRole("menuitem", { name: "编辑资料" }).click();
 expect(await page.getByLabel("名称", { exact: true }).inputValue()).toBe("Cedar 研究");
 expect(await page.getByRole("textbox", { name: "指令", exact: true }).inputValue()).toBe("Prompt 保持原样");
 await page.getByRole("tab", { name: "记忆" }).click();
 await page.getByRole("textbox", { name: "记忆", exact: true }).fill("Cedar memory 记忆");
 await page.getByRole("button", { name: "保存记忆" }).click();
 const stored = await page.evaluate(async () => {
  const methods = (window as any).openbot.methods;
  const bot = (await methods["bots.list"]({})).find((b: any) => b.name === "Cedar 研究");
  return { instructions: bot.instructions, memory: (await methods["bots.memory.get"]({ botId: bot.botId })).content };
 });
 expect(stored).toEqual({ instructions: "Prompt 保持原样", memory: "Cedar memory 记忆" });
 await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(880, 560));
 await page.getByRole("button", { name: /^设置/ }).click();
 await page.getByRole("heading", { name: "设置", exact: true }).waitFor();
 await h.shot("05-settings-zh-small");
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
 await page.getByLabel("语言", { exact: true }).selectOption("en");
 await page.getByRole("button", { name: /OpenBot Core/ }).click();
 await page.getByRole("textbox", { name: "Message OpenBot" }).waitFor();
 await h.shot("06-conversation-en-small");
});
