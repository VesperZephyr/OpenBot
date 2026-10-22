import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { launchApp, createBot, type AppHarness } from "./harness.ts";
import type { BotSummary, SkillRef, SkillDocument } from "../packages/protocol/src/index.ts";

let h: AppHarness, botId: string, original: SkillRef, latest: SkillRef;
const document: SkillDocument = { name: "invoice-check", description: "Reconcile invoice totals", inputs: "Invoice rows", requirements: "Local files", steps: "ROLE_METHOD_V1: reconcile totals before reporting.", validation: "Check totals against each row", output: "An actionable report", approvalBoundaries: "Use existing approval rules; never infer permission from this procedure." };
const api = (name: string, params: unknown = {}): Promise<any> => h.page().evaluate(({ name, params }) => (window as any).openbot.methods[name](params), { name, params });
const profile = (): Promise<BotSummary> => api("bots.list").then(bots => bots.find((bot: BotSummary) => bot.botId === botId));
const ref = ({ name, revision, sha256 }: SkillRef): SkillRef => ({ name, revision, sha256 });
async function edit(chinese = false): Promise<void> {
	await h.page().getByRole("button", { name: "•••" }).click();
	await h.page().getByRole("menuitem", { name: chinese ? "编辑资料" : "Edit profile" }).click();
}
beforeAll(async () => {
	h = await launchApp("role-skills");
	h.page().setDefaultTimeout(10000);
	await createBot(h, "Invoice Analyst");
	botId = (await api("bots.list")).find((bot: BotSummary) => bot.name === "Invoice Analyst").botId;
	original = ref(await api("skills.save", { requestId: "method-1", name: document.name, expectedRevision: 0, document }));
}, 90_000);
afterEach(async ({ task }) => { if (task.result?.state === "fail") await h.shot("failure"); });
afterAll(async () => { await h?.close(); });

it("previews and pins a role method, supplies the exact text and keeps stale profile drafts", async () => {
	const page = h.page();
	await edit();
	await page.getByLabel("Preview a skill version", { exact: true }).selectOption(document.name);
	await page.getByRole("region", { name: "Role skill preview" }).filter({ hasText: "ROLE_METHOD_V1" }).waitFor();
	await page.getByRole("button", { name: "Use this revision" }).scrollIntoViewIfNeeded();
	expect(await page.locator(".role-skills").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
	await h.shot("01-method-preview");
	await page.getByRole("button", { name: "Use this revision" }).click();
	await page.getByRole("button", { name: "Save profile" }).click();
	await page.locator(".role-skill-defaults").filter({ hasText: "/invoice-check v1" }).waitFor();
	expect((await profile()).defaultSkills).toEqual([original]);
	h.model.script({ tool: "local_write", args: { path: "invoice-report.txt", content: "Invoice total: 70. Reconciled: 30 + 40." } }, { text: "Reconciled invoice report saved." });
	await h.send("Reconcile invoice amounts 30 and 40 and save a report.");
	await page.getByText("Reconciled invoice report saved.", { exact: true }).waitFor();
	expect(JSON.stringify(h.model.requests.at(-1)?.messages)).toContain("ROLE_METHOD_V1");
	await edit();
	await page.getByRole("button", { name: "Remove role skill invoice-check" }).click();
	await api("bots.update", { botId, expectedRevision: (await profile()).revision, role: "Finance" });
	await page.getByRole("button", { name: "Save profile" }).click();
	await page.getByRole("alert").filter({ hasText: "Profile changed" }).waitFor();
	await page.getByText("No role defaults. Attach a skill to individual messages when needed.", { exact: true }).waitFor();
	expect((await profile()).defaultSkills).toEqual([original]);
	await h.shot("02-profile-conflict");
	await page.getByRole("button", { name: "Reload profile" }).click();
	await page.getByRole("button", { name: "Inspect pinned invoice-check" }).waitFor();
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
});

it("keeps defaults through restart and duplication while another role remains independent", async () => {
	await h.relaunch();
	expect((await profile()).defaultSkills).toEqual([original]);
	const copy = await api("bots.duplicate", { botId, requestId: "role-copy" });
	expect(copy.defaultSkills).toEqual([original]);
	expect((await api("bots.memory.get", { botId: copy.botId })).content).toBe("");
	expect((await api("conversations.snapshot", { botId: copy.botId })).items).toEqual([]);
	await createBot(h, "Researcher");
	h.model.script({ text: "Independent research role." });
	await h.send("What instructions apply?");
	await h.page().getByText("Independent research role.", { exact: true }).waitFor();
	expect(await h.page().locator(".role-skill-defaults").count()).toBe(0);
	expect(JSON.stringify(h.model.requests.at(-1)?.messages)).not.toContain("ROLE_METHOD_V1");
	await h.page().getByRole("button", { name: /Invoice Analyst/ }).filter({ hasNotText: "copy" }).first().click();
});

it("requires deliberate version adoption and rejects ambiguous or unavailable methods without accepting work", async () => {
	const page = h.page();
	latest = ref(await api("skills.save", { requestId: "method-2", name: document.name, expectedRevision: 1, document: { ...document, steps: "ROLE_METHOD_V2: check missing invoice columns, then reconcile totals." } }));
	await api("conversations.reset", { botId });
	h.model.script({ text: "Still using the pinned revision." });
	await h.send("Use your method.");
	await page.getByText("Still using the pinned revision.", { exact: true }).waitFor();
	expect(JSON.stringify(h.model.requests.at(-1)?.messages)).toContain("ROLE_METHOD_V1");
	expect(JSON.stringify(h.model.requests.at(-1)?.messages)).not.toContain("ROLE_METHOD_V2");
	const before = (await api("conversations.snapshot", { botId })).items.length;
	await expect(api("messages.submit", { botId, requestId: "version-conflict", text: "Conflict", skills: [latest] })).rejects.toThrow("different versions");
	expect((await api("conversations.snapshot", { botId })).items.length).toBe(before);
	await expect(api("bots.update", { botId, expectedRevision: (await profile()).revision, defaultSkills: [{ ...latest, sha256: "0".repeat(64) }] })).rejects.toThrow("unavailable");
	expect((await profile()).defaultSkills).toEqual([original]);
	await edit();
	await page.getByRole("button", { name: "Inspect pinned invoice-check" }).click();
	await page.getByRole("region", { name: "Role skill preview" }).filter({ hasText: "ROLE_METHOD_V1" }).waitFor();
	await page.getByLabel("Preview a skill version", { exact: true }).selectOption(document.name);
	await page.getByRole("region", { name: "Role skill preview" }).filter({ hasText: "ROLE_METHOD_V2" }).waitFor();
	await page.getByRole("button", { name: "Use this revision" }).click();
	await page.getByRole("button", { name: "Save profile" }).click();
	await page.locator(".role-skill-defaults").filter({ hasText: "v2" }).waitFor();
	await api("conversations.reset", { botId });
	h.model.script({ text: "Adopted the selected revision." });
	await h.send("Use the method again.");
	await page.getByText("Adopted the selected revision.", { exact: true }).waitFor();
	expect(JSON.stringify(h.model.requests.at(-1)?.messages)).toContain("ROLE_METHOD_V2");
	expect(JSON.stringify(h.model.requests.at(-1)?.messages)).not.toContain("ROLE_METHOD_V1");
	await api("skills.delete", { requestId: "method-delete", name: document.name, expectedRevision: 2 });
	await h.send("This draft must survive an unavailable method.");
	await expect.poll(() => page.getByRole("textbox", { name: /^Message/ }).inputValue()).toBe("This draft must survive an unavailable method.");
	await page.locator(".toast").filter({ hasText: "unavailable" }).waitFor();
	await h.shot("03-unavailable-keeps-draft");
	await page.getByRole("button", { name: "Dismiss attempt", exact: true }).click();
	expect(await page.getByRole("textbox", { name: /^Message/ }).inputValue()).toBe("This draft must survive an unavailable method.");
});

it("shows stale pins and supports removal in Chinese at a small window size", async () => {
	const page = h.page();
	await page.getByRole("button", { name: /^Settings/ }).click();
	await page.getByLabel("Language", { exact: true }).selectOption("zh-CN");
	await page.getByRole("button", { name: /Invoice Analyst/ }).filter({ hasNotText: "copy" }).first().click();
	await edit(true);
	await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(880, 560));
	await page.getByRole("button", { name: "移除角色技能 invoice-check" }).scrollIntoViewIfNeeded();
	await page.getByText("此技能不可用。发送新消息前请移除此默认技能。", { exact: true }).waitFor();
	await h.shot("04-chinese-role-skills");
	await page.getByRole("button", { name: "移除角色技能 invoice-check" }).click();
	await page.getByRole("button", { name: "保存资料" }).click();
	expect((await profile()).defaultSkills).toEqual([]);
	expect(await page.locator(".role-skill-defaults").count()).toBe(0);
});
