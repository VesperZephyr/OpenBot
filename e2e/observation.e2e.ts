/** Background-only recovery of observation, independent of task dispatch and read acknowledgements. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { launchApp, type AppHarness } from "./harness.ts";
let h: AppHarness, core: string;
const api = (name: string, params = {}): Promise<any> =>
	h.page().evaluate(({ name, params }) => (window as any).openbot.methods[name](params), { name, params });
const poll = (fn: () => Promise<any>) => expect.poll(fn, { timeout: 15000 });
const box = () => h.page().locator(".compose-area textarea");
const snapshot = () => api("conversations.snapshot", { botId: core });
const unread = async (key: string) => (await api("conversations.list")).find((r: any) => r.conversationKey === key).unreadCount;
async function restartHost() {
	const cursor = await api("observation.wait", { waitMs: 0 });
	const pid = Number((await readFile(join(h.dataDirectory, "host.lock"), "utf8")).trim());
	process.kill(pid, "SIGTERM");
	await poll(async () => {
		try {
			return (await api("observation.wait", { waitMs: 0 })).streamId;
		} catch {
			return cursor.streamId;
		}
	}).not.toBe(cursor.streamId);
	await poll(() => h.page().evaluate(() => (window as any).openbot.hostState())).toMatchObject({ status: "ready" });
}
beforeAll(async () => {
	h = await launchApp("observation");
	h.page().setDefaultTimeout(10000);
	await api("settings.update", { defaultModel: { provider: "scripted", modelId: "scripted" } });
	core = (await api("bots.list"))[0].botId;
	await box().waitFor();
});
afterEach(async ({ task }) => {
	if (task.result?.state === "fail") await h.shot("failure");
});
afterAll(async () => {
	await h?.close();
});
it("reloads and reconnects an exact approval without losing a draft or repeating its effect", async () => {
	h.model.script(
		{ tool: "codemode", args: { code: 'const result=await tools.app_bots_create({name:"Observation helper"});text(result);' } },
		{ text: "OBSERVATION_RESULT created once." },
	);
	await box().fill("Create my observation helper.");
	await box().press("Enter");
	await h.page().locator(".approval").waitFor();
	const approval = (await snapshot()).approvals[0].approvalId;
	await box().fill("Keep this English draft / 保留中文草稿");
	await h.page().reload();
	await h.page().locator(".approval").waitFor();
	expect(await box().inputValue()).toBe("Keep this English draft / 保留中文草稿");
	await restartHost();
	await poll(async () => (await snapshot()).approvals[0]?.approvalId).toBe(approval);
	expect(await api("bots.list")).toHaveLength(1);
	await h.page().locator(".approval-actions button.primary").click();
	await h.page().getByText("OBSERVATION_RESULT created once.", { exact: true }).waitFor();
	await poll(async () => (await snapshot()).run).toBeUndefined();
	const before = await snapshot();
	const tool = before.items.find((i: any) => i.kind === "tool" && i.tool === "codemode");
	expect(tool.execution.children[0].object.kind).toBe("bot");
	const count = await unread(`bot:${core}`);
	await restartHost();
	await h.page().getByText("OBSERVATION_RESULT created once.", { exact: true }).waitFor();
	expect(await api("bots.list")).toHaveLength(2);
	expect((await snapshot()).items.filter((i: any) => i.id === tool.id)).toHaveLength(1);
	expect(await unread(`bot:${core}`)).toBe(count);
	expect(await box().inputValue()).toBe("Keep this English draft / 保留中文草稿");
	expect(await h.page().evaluate(() => (window as any).openbot.windowActive())).toBe(false);
	await h.shot("01-reconnected-result-en");
});
it("keeps a group search target, unread count and Chinese draft through Host recovery", async () => {
	const helper = (await api("bots.list")).find((b: any) => b.kind === "specialist");
	await api("settings.update", { language: "zh-CN" });
	await api("groups.change", {
		requestId: "observation-group",
		action: "create",
		groupId: "group_observation",
		expectedRevision: 0,
		fields: { name: "恢复验证群", objective: "Local recovery", memberIds: [core, helper.botId], leadBotId: core },
	});
	h.model.script({ text: "群聊恢复标记：这份结果只发布一次。" });
	await api("groups.send", {
		groupId: "group_observation",
		requestId: "group-answer",
		text: "Give a recovery result.",
		recipientIds: [helper.botId],
	});
	await poll(() => unread("group:group_observation")).toBe(1);
	const search = h.page().getByRole("searchbox");
	await search.fill("群聊恢复标记");
	await h.page().locator(".search-result").click();
	await h.page().getByText("正在查看搜索结果", { exact: true }).waitFor();
	await box().fill("群聊中文草稿 / next task");
	await restartHost();
	await poll(() => h.page().locator(".search-target").textContent()).toContain("群聊恢复标记");
	await poll(() => h.page().locator(".search-result").count()).toBe(1);
	expect(await search.inputValue()).toBe("群聊恢复标记");
	expect(await box().inputValue()).toBe("群聊中文草稿 / next task");
	expect(await unread("group:group_observation")).toBe(1);
	expect(
		(await api("groups.snapshot", { groupId: "group_observation" })).posts.filter((p: any) => p.text.startsWith("群聊恢复标记")),
	).toHaveLength(1);
	await h.shot("02-reconnected-group-search-zh");
});
