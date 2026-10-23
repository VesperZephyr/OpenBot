import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { launchApp, type AppHarness } from "./harness.ts";
let h: AppHarness, core: string, firstRun: string;
const api = (name: string, params = {}) =>
	h.page().evaluate(({ name, params }) => (window as any).openbot.methods[name](params), { name, params });
const poll = (fn: () => Promise<any>) => expect.poll(fn, { timeout: 15000 });
const reported = {
	prompt_tokens: 100,
	completion_tokens: 30,
	total_tokens: 130,
	prompt_tokens_details: { cached_tokens: 20 },
	completion_tokens_details: { reasoning_tokens: 10 },
};
const usage = () => api("usage.get", { botId: core });
const openPanel = async () => {
	await h.page().locator(".details-toggle").click();
	await h.page().locator(".usage-panel > summary").click();
	await poll(() => h.page().locator(".usage-run").count()).toBeGreaterThan(0);
};
beforeAll(async () => {
	h = await launchApp("usage", {
		prepare: async (run) => {
			const path = join(run, "home/models.json");
			const config = JSON.parse(await readFile(path, "utf8"));
			config.providers.scripted.models[0].cost = { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0 };
			await writeFile(path, JSON.stringify(config));
			return {};
		},
	});
	h.page().setDefaultTimeout(8000);
	await api("settings.update", { defaultModel: { provider: "scripted", modelId: "scripted" } });
	core = (await api("bots.list")).find((b: any) => b.kind === "core").botId;
});
afterEach(async ({ task }) => {
	if (task.result?.state === "fail") await h.shot("failure");
});
afterAll(async () => {
	await h?.close();
});
it("records exact model usage, an approval and result without changing read cursors", async () => {
	h.model.script(
		{
			tool: "local_exec",
			args: { description: "Write synthetic evidence", command: "printf 'usage-evidence' > usage.txt" },
			usage: reported,
		},
		{ tool: "local_read", args: { path: "usage.txt" }, usage: reported },
		{ text: "Usage evidence saved.", usage: reported },
	);
	const sent = await api("messages.submit", { botId: core, requestId: "usage-first", text: "Write the synthetic usage evidence" });
	firstRun = sent.runId;
	await poll(async () => (await api("conversations.snapshot", { botId: core })).approvals?.length).toBe(1);
	const approval = (await api("conversations.snapshot", { botId: core })).approvals[0];
	await api("approvals.decide", { approvalId: approval.approvalId, decision: "allow_once" });
	await poll(async () => (await usage()).runs.find((r: any) => r.runId === firstRun)?.state).toBe("completed");
	const data = await usage();
	expect(data.total.totalTokens).toBe(390);
	expect(data.total.estimatedUsd).toBeCloseTo(0.00045, 8);
	expect(data.runs[0].usage.reasoning).toBe(30);
	expect(data.runs[0].references.some((r: any) => r.kind === "approval")).toBe(true);
	expect(data.runs[0].references.some((r: any) => r.kind === "result")).toBe(true);
	expect(JSON.stringify(data)).not.toMatch(/usage-evidence|printf|baseUrl|apiKey/);
	const before = await api("conversations.list");
	await usage();
	expect(await api("conversations.list")).toEqual(before);
	await openPanel();
	await h.page().locator(".usage-run > summary").first().click();
	await h.shot("01-usage-en");
	await h.page().getByRole("button", { name: "View result", exact: true }).click();
	await poll(() => h.page().locator(".search-target").textContent()).toContain("Usage evidence saved.");
	expect(await readFile(join(h.workspace, "usage.txt"), "utf8")).toBe("usage-evidence");
	await openPanel();
	await h.page().locator(".usage-run > summary").first().click();
	await h
		.page()
		.getByRole("button", { name: /^View approval/ })
		.click();
	await poll(() => h.page().locator(".search-target .tool-command").isVisible()).toBe(true);
	expect(await h.page().locator(".steps-row > details").getAttribute("open")).not.toBeNull();
	await h.shot("05-approval-evidence-link");
	const requests = h.model.requests.length;
	const repeat = await api("messages.submit", { botId: core, requestId: "usage-first", text: "Write the synthetic usage evidence" });
	expect(repeat.runId).toBe(firstRun);
	expect((await usage()).total).toEqual(data.total);
	expect(h.model.requests.length).toBe(requests);
});
it("preserves settled estimates across restart and displays Chinese without repeating the model", async () => {
	const before = await usage(),
		requests = h.model.requests.length;
	await h.relaunch();
	expect(await usage()).toEqual(before);
	expect(h.model.requests.length).toBe(requests);
	await api("settings.update", { language: "zh-CN" });
	await h.page().reload();
	await h.page().locator(".sidebar").waitFor();
	await openPanel();
	await poll(() => h.page().locator(".usage-panel > summary").textContent()).toBe("用量与任务");
	await h.page().locator(".usage-run > summary").first().click();
	await h.shot("02-usage-zh");
	await h.page().getByRole("button", { name: "关闭详情", exact: true }).click();
	await api("settings.update", { language: "en" });
	await h.page().reload();
});
it("keeps unknown prices unavailable, rejects bad reads and preserves usage after a new topic", async () => {
	await api("conversations.reset", { botId: core });
	await api("bots.create", { requestId: "unknown-usage", name: "Unknown price" });
	const path = join(h.run, "home/models.json");
	const config = JSON.parse(await readFile(path, "utf8"));
	delete config.providers.scripted.models[0].cost;
	await writeFile(path, JSON.stringify(config));
	await h.relaunch();
	h.model.script({ text: "Unknown price result.", usage: reported });
	await api("messages.submit", { botId: "bot_unknown-usage", requestId: "unknown", text: "Reply" });
	await poll(async () => (await api("usage.get", { botId: "bot_unknown-usage" })).total.totalTokens).toBe(130);
	expect((await api("usage.get", { botId: "bot_unknown-usage" })).total.estimatedUsd).toBeUndefined();
	expect((await usage()).total.totalTokens).toBe(390);
	await expect(api("usage.get", { botId: core, limit: 51 })).rejects.toThrow();
	await expect(api("usage.get", { botId: "missing" })).rejects.toThrow();
	await h.page().locator(".sidebar .bot-row").filter({ hasText: "Unknown price" }).click();
	await openPanel();
	await h.shot("03-unknown-cost");
});

it("counts Code Mode provider generations once across multiple child reads", async () => {
	const before = (await usage()).total.totalTokens;
	h.model.script(
		{
			tool: "codemode",
			args: {
				code: "await tools.app_bots_inspect({});await tools.app_conversations_list({});await tools.app_bots_create({name:'Usage child'});text('Read two resources and created the approved helper');",
			},
			usage: reported,
		},
		{ text: "Both resources checked.", usage: reported },
	);
	const sent = await api("messages.submit", { botId: core, requestId: "usage-code", text: "Inspect application data" });
	await poll(async () => (await api("conversations.snapshot", { botId: core })).approvals?.length).toBe(1);
	const nested = (await api("conversations.snapshot", { botId: core })).approvals[0];
	await api("approvals.decide", { approvalId: nested.approvalId, decision: "allow_once" });

	await poll(async () => (await usage()).runs.find((r: any) => r.runId === sent.runId)?.state).toBe("completed");
	const data = await usage();
	const run = data.runs.find((r: any) => r.runId === sent.runId);
	expect(run.usage.totalTokens).toBe(260);
	expect(data.total.totalTokens).toBe(before + 260);
	const code = (await api("conversations.snapshot", { botId: core })).items.find((item: any) => item.tool === "codemode");
	expect(code.execution.children).toHaveLength(3);
	expect(run.references.some((r: any) => r.kind === "approval" && r.approvalId === nested.approvalId && r.messageId === code.id)).toBe(
		true,
	);
	expect(code.status).toBe("succeeded");
});

it("links group usage to a published group result, without leaking its private channel entries", async () => {
	const groupId = "group_usage_evidence";
	await api("groups.change", {
		requestId: "usage-group",
		action: "create",
		groupId,
		expectedRevision: 0,
		fields: { name: "Usage group", objective: "Synthetic evidence", memberIds: [core, "bot_unknown-usage"], leadBotId: core },
	});
	h.model.script({ text: "Published group usage result.", usage: reported });
	await api("groups.send", { groupId, requestId: "group-usage", text: "Check the group task", recipientIds: ["bot_unknown-usage"] });
	await poll(async () => (await api("usage.get", { botId: "bot_unknown-usage" })).runs[0]?.references.length).toBe(1);
	const row = (await api("usage.get", { botId: "bot_unknown-usage" })).runs[0];
	expect(row.conversationKey).toBe(`group:${groupId}`);
	expect(row.references[0].messageId).toMatch(/^reply:/);
	expect(row.usage.totalTokens).toBe(130);
	if (await h.page().getByRole("button", { name: "Close details", exact: true }).isVisible())
		await h.page().getByRole("button", { name: "Close details", exact: true }).click();
	await h.page().locator(".sidebar .bot-row:not(.group-nav)").filter({ hasText: "Unknown price" }).click();
	await openPanel();
	await h.page().locator(".usage-run > summary").first().click();
	await h.page().getByRole("button", { name: "View result", exact: true }).click();
	await poll(() => h.page().locator(".search-target").textContent()).toContain("Published group usage result.");
	await h.shot("04-group-result-link");
});
