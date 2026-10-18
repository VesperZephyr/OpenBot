import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { launchApp, type AppHarness } from "./harness.ts";
let h: AppHarness, core: string;
const api = (name: string, params = {}): Promise<any> =>
	h.page().evaluate(({ name, params }) => (window as any).openbot.methods[name](params), { name, params });
const snapshot = () => api("conversations.snapshot", { botId: core });
const parent = async () => (await snapshot()).items.filter((i: any) => i.kind === "tool" && i.tool === "codemode").at(-1);
const idle = async () => expect.poll(async () => (await snapshot()).run, { timeout: 15000 }).toBeUndefined();
const send = async (code: string, reply: string) => {
	h.model.script({ tool: "codemode", args: { code } }, { text: reply });
	const box = h.page().locator(".compose-area textarea");
	await box.fill("Perform the requested synthetic management check.");
	await box.press("Enter");
};
const approve = async () => {
	await h.page().locator(".approval").waitFor();
	const id = await h.page().locator(".approval").getAttribute("data-approval-id");
	await h.page().locator(".approval-actions button.primary").click();
	await h.page().locator(`[data-approval-id="${id}"]`).waitFor({ state: "detached" });
};
beforeAll(async () => {
	h = await launchApp("code-management");
	h.page().setDefaultTimeout(10000);
	await api("settings.update", { defaultModel: { provider: "scripted", modelId: "scripted" } });
	core = (await api("bots.list"))[0].botId;
});
afterEach(async ({ task }) => {
	if (task.result?.state === "fail") await h.shot("failure");
});
afterAll(async () => {
	await h?.close();
});
it("shows exact nested approvals, resumes a waiting script and retains six approved lifecycle receipts", async () => {
	await send(
		`const b=await tools.app_bots_create({name:"Code Helper",instructions:"Use evidence."});const id=b.value.bot.botId;const g=await tools.app_groups_create({name:"Code Studio",objective:"Research",memberIds:[${JSON.stringify(core)},id],leadBotId:${JSON.stringify(core)}});text({bot:id,group:g.value.groupId});`,
		"Created the requested helper and group.",
	);
	await h.page().getByText("Creates a Specialist with its own instructions and empty memory.").waitFor();
	expect(await api("bots.list")).toHaveLength(1);
	expect(
		await h
			.page()
			.getByRole("button", { name: /Always allow/ })
			.count(),
	).toBe(0);
	const waiting = await parent();
	expect(waiting.execution.children[0].capability).toBe("app_bots_create");
	await h.shot("01-nested-exact-approval-en");
	await h.relaunch();
	await approve();
	await h.page().getByText("Create group", { exact: true }).waitFor();
	expect(await api("bots.list")).toHaveLength(2);
	await h.shot("02-group-exact-approval");
	await approve();
	await idle();
	expect((await parent()).execution.children.map((c: any) => c.object?.kind)).toEqual(["bot", "group"]);
	expect((await parent()).execution.deadline).toBe(waiting.execution.deadline);
	const bot = (await api("bots.list")).find((b: any) => b.kind === "specialist"),
		group = (await api("groups.list"))[0];
	await send(
		`const b=await tools.app_bots_inspect({botId:${JSON.stringify(bot.botId)}});await tools.app_bots_update({botId:b.value[0].botId,expectedRevision:b.value[0].revision,role:"Reviewer"});const g=await tools.app_groups_inspect({groupId:${JSON.stringify(group.groupId)}});await tools.app_groups_update({groupId:g.value[0].groupId,expectedRevision:g.value[0].revision,name:"Updated studio",objective:"Review",memberIds:g.value[0].memberIds,leadBotId:${JSON.stringify(bot.botId)}});`,
		"Updated both profiles.",
	);
	await approve();
	await approve();
	await idle();
	expect((await api("groups.list"))[0].name).toBe("Updated studio");
	await api("settings.update", { language: "zh-CN" });
	await h.page().reload();
	await send(
		`const g=await tools.app_groups_inspect({groupId:${JSON.stringify(group.groupId)}});await tools.app_groups_dissolve({groupId:g.value[0].groupId,expectedRevision:g.value[0].revision});const b=await tools.app_bots_inspect({botId:${JSON.stringify(bot.botId)}});await tools.app_bots_delete({botId:b.value[0].botId,expectedRevision:b.value[0].revision});`,
		"群组已解散，Bot 已删除。",
	);
	await h.page().locator(".approval").waitFor();
	expect(await h.page().locator(".approval-reason").textContent()).not.toBe("Review this group change");
	await h.shot("03-dissolve-zh");
	await approve();
	await h.page().locator(".approval").waitFor();
	await h.shot("04-delete-zh");
	await approve();
	await idle();
	await h.relaunch();
	expect(await api("bots.list")).toHaveLength(1);
	expect((await api("groups.list"))[0].status).toBe("dissolved");
	expect((await api("bots.management.history")).filter((r: any) => r.outcome === "succeeded")).toHaveLength(3);
});
it("shows partial completion after denial and prevents a caught failure from proposing another change", async () => {
	await send(
		'await tools.app_bots_create({name:"Kept helper"});try{await tools.app_bots_create({name:"Denied helper"});}catch{}try{await tools.app_bots_create({name:"Forbidden helper"});}catch{}',
		"只完成了第一个 Bot，后续操作已停止。",
	);
	await approve();
	await h.page().locator(".approval").waitFor();
	await h.page().locator(".approval-actions button").first().click();
	await idle();
	expect((await api("bots.list")).map((b: any) => b.name)).toEqual(["OpenBot", "Kept helper"]);
	expect((await snapshot()).approvals).toHaveLength(0);
	expect((await parent()).execution.managementClosed).toBe(true);
	await h.page().getByText("管理操作已停止，已完成的更改会保留。", { exact: true }).waitFor();
	await h.shot("05-partial-completion-zh");
	await h.relaunch();
	expect((await parent()).execution.children[0].object.id).toBe((await api("bots.list"))[1].botId);
});
it("group Core discovers reads only and cannot call a guessed management alias", async () => {
	const requestStart = h.model.requests.length;
	const helper = (await api("bots.list")).find((b: any) => b.kind === "specialist");
	await api("groups.change", {
		requestId: "scope-group",
		action: "create",
		groupId: "group_scope",
		expectedRevision: 0,
		fields: { name: "Scope check", objective: "Verify bounds", memberIds: [core, helper.botId], leadBotId: core },
	});
	h.model.script(
		{
			tool: "codemode",
			args: {
				code: 'text(ALL_TOOLS.map(t=>t.name));try{await tools.app_bots_create({name:"Forbidden group helper"});}catch{ text("Management unavailable"); }',
			},
		},
		{ text: "Group management is unavailable in this context." },
	);
	await api("groups.send", {
		groupId: "group_scope",
		requestId: "scope-check",
		text: "Verify management is unavailable from the group context.",
	});
	await expect
		.poll(async () => (await api("groups.snapshot", { groupId: "group_scope" })).roots[0]?.state, { timeout: 15000 })
		.toBe("completed");
	const output = JSON.stringify(h.model.requests.slice(requestStart).flatMap((r) => r.messages.filter((m) => m.role === "tool")));
	expect(output).toContain("app_conversations_search");
	expect(output).not.toContain("app_bots_create");
	expect(output).toContain("Management unavailable");
	expect(await api("bots.list")).toHaveLength(2);
	expect((await snapshot()).approvals).toHaveLength(0);
});

it("expires pending approval, rejects late approval and Stop leaves no unfinished writes after restart", async () => {
	await send('// @options: {"timeout_ms":1800}\nawait tools.app_bots_create({name:"Expired helper"});', "审批已过期，没有创建。");
	await h.page().locator(".approval").waitFor();
	const approval = (await snapshot()).approvals[0];
	await idle();
	expect(await api("bots.list")).toHaveLength(2);
	expect((await snapshot()).approvals).toHaveLength(0);
	await h.page().getByText("应用操作已过期", { exact: true }).waitFor();
	await h.shot("06-expired-zh");
	expect(
		await api("approvals.decide", { approvalId: approval.approvalId, decision: "allow_once" }).then(
			() => true,
			() => false,
		),
	).toBe(false);
	await send('await tools.app_bots_create({name:"Stopped helper"});', "Stopped.");
	await h.page().locator(".approval").waitFor();
	const run = (await snapshot()).run;
	await api("runs.cancel", { runId: run.runId });
	await idle();
	await h.relaunch();
	expect(await api("bots.list")).toHaveLength(2);
	expect((await snapshot()).approvals).toHaveLength(0);
	await h.shot("07-stopped-after-restart");
});
