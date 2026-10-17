import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { type AppHarness, launchApp } from "./harness.ts";
let h: AppHarness;
let alpha: string;
let beta: string;
let core: string;
let groupId: string;
const api = (name: string, params = {}): Promise<any> =>
	h.page().evaluate(({ name, params }) => (window as any).openbot.methods[name](params), { name, params });
const until = (callback: () => Promise<any>) => expect.poll(callback, { timeout: 10000 });
const snapshot = () => api("groups.snapshot", { groupId });
const waitReply = async (text: string) => {
	await until(async () => (await snapshot()).posts.some((p: any) => p.text === text)).toBe(true);
	await h.page().getByText(text, { exact: true }).waitFor();
};
const send = async (text: string) => {
	await h.page().getByRole("textbox", { name: "Message group", exact: true }).fill(text);
	await h.page().getByRole("textbox", { name: "Message group", exact: true }).press("Enter");
};
const approve = () =>
	h.page().getByRole("group", { name: "Approval request" }).getByRole("button", { name: "Allow once", exact: true }).click();
const openGroup = async () => {
	await h.page().locator(".group-nav").filter({ hasText: "Studio" }).click();
	await h.page().getByRole("heading", { name: "Studio", exact: true }).waitFor();
};
beforeAll(async () => {
	h = await launchApp("groups");
	h.page().setDefaultTimeout(5000);
	await api("settings.update", { defaultModel: { provider: "scripted", modelId: "scripted" } });
	core = (await api("bots.list")).find((b: any) => b.kind === "core").botId;
	alpha = (await api("bots.create", { requestId: "alpha", name: "Alpha", instructions: "ALPHA_PROMPT" })).botId;
	beta = (await api("bots.create", { requestId: "beta", name: "Beta" })).botId;
}, 90000);
afterEach(async ({ task }) => {
	if (task.result?.state === "fail") await h.shot("failure");
});
afterAll(async () => {
	await h?.close();
});
it("creates from desktop, routes to lead or selected member, and isolates private history", async () => {
	h.model.script({ text: "Private answer" });
	await api("messages.submit", { botId: alpha, requestId: "private", text: "PRIVATE_CANARY" });
	await until(async () => (await api("bots.list")).find((b: any) => b.botId === alpha).lastRun?.state).toBe("completed");
	await h.page().getByRole("button", { name: "Create group", exact: true }).click();
	const dialog = h.page().getByRole("dialog", { name: "Create group" });
	await dialog.getByLabel("Group name").fill("Studio");
	await dialog.getByLabel("Objective").fill("Plan a local research project");
	await dialog.getByLabel("Alpha", { exact: true }).check();
	await dialog.getByLabel("Beta", { exact: true }).check();
	await dialog.getByLabel("Lead", { exact: true }).selectOption(alpha);
	await dialog.getByRole("button", { name: "Create group", exact: true }).click();
	groupId = (await api("groups.list"))[0].groupId;
	await h.page().getByRole("button", { name: "Edit group", exact: true }).click();
	const editor = h.page().getByRole("dialog", { name: "Edit group" });
	await editor.getByLabel("Objective").fill("Unsaved draft");
	await api("groups.change", {
		requestId: "concurrent-edit",
		action: "update",
		groupId,
		expectedRevision: 1,
		fields: { name: "Studio", objective: "Latest objective", memberIds: [alpha, beta], leadBotId: alpha },
	});
	await editor.getByRole("button", { name: "Reload group", exact: true }).waitFor();
	expect(await editor.getByLabel("Objective").inputValue()).toBe("Unsaved draft");
	expect(await editor.getByRole("button", { name: "Save changes", exact: true }).isDisabled()).toBe(true);
	await editor.getByRole("button", { name: "Reload group", exact: true }).click();
	expect(await editor.getByLabel("Objective").inputValue()).toBe("Latest objective");
	await editor.getByRole("button", { name: "Cancel", exact: true }).click();

	h.model.script({ text: "Lead response" });
	const first = h.model.requests.length;
	await send("Plan the first step.");
	await waitReply("Lead response");
	const req = JSON.stringify(h.model.requests[first]);
	expect(req).toContain("ALPHA_PROMPT");
	expect(req).not.toContain("PRIVATE_CANARY");
	expect(req).not.toContain('"name":"group_create"');
	expect((await snapshot()).posts[1].senderId).toBe(alpha);
	h.model.script({ text: "Beta response" });
	await h.page().locator(".group-recipients").getByRole("button", { name: "Beta", exact: true }).click();
	await send("Review the lead's plan.");
	await waitReply("Beta response");
	expect((await snapshot()).posts[3].senderId).toBe(beta);
	expect(JSON.stringify(h.model.requests.at(-1)?.messages)).toContain("Lead response");
	expect(JSON.stringify(await api("conversations.snapshot", { botId: alpha }))).not.toContain("Lead response");
	await h.page().getByText("Beta response", { exact: true }).waitFor();
	await h.shot("01-group-transcript");
	const beforeFanout = h.model.requests.length;
	h.model.script({ text: "Parallel response one" }, { text: "Parallel response two" });
	await h.page().locator(".group-recipients").getByRole("button", { name: "Alpha", exact: true }).click();
	await send("Both members: give one short response.");
	await waitReply("Parallel response one");
	await waitReply("Parallel response two");
	const fanout = await snapshot();
	expect(new Set(fanout.posts.slice(-2).map((p: any) => p.senderId))).toEqual(new Set([alpha, beta]));
	expect(fanout.tasks.some((d: any) => d.state === "pending")).toBe(false);
	expect(h.model.requests.length).toBe(beforeFanout + 2);

	await h.relaunch();
	await openGroup();
	expect((await snapshot()).posts).toHaveLength(7);
});
it("group approval survives restart, stop is scoped, removal cancels queued work", async () => {
	h.model.script(
		{ tool: "local_exec", args: { command: "echo group-approval", description: "Group command" } },
		{ text: "Group command done" },
	);
	await send("Run a group command.");
	await h.page().getByRole("group", { name: "Approval request" }).waitFor();
	expect((await api("conversations.snapshot", { botId: alpha })).approvals).toHaveLength(0);
	await h.shot("02-group-approval");
	await h.relaunch();
	await openGroup();
	await approve();
	await waitReply("Group command done");
	h.model.script({ tool: "local_exec", args: { command: "echo should-not-run", description: "Pending command" } });
	await send("Wait for my approval.");
	await h.page().getByRole("group", { name: "Approval request" }).waitFor();
	await h.page().getByRole("button", { name: "Stop", exact: true }).click();
	await until(async () => (await snapshot()).tasks.filter((d: any) => d.state === "pending").length).toBe(0);
	// Occupy Alpha in its direct channel, then queue an explicit group delivery to Alpha.
	h.model.script({ tool: "local_exec", args: { command: "echo direct-only", description: "Direct task" } });
	await api("messages.submit", { botId: alpha, requestId: "hold-direct", text: "Hold direct task" });
	await until(async () => (await api("conversations.snapshot", { botId: alpha })).approvals.length).toBe(1);
	await api("groups.send", { groupId, requestId: "queued-group", text: "This must never run", recipientIds: [alpha] });
	await until(async () => (await snapshot()).tasks.find((d: any) => d.state === "pending")?.conversation?.run.state).toBe("queued");
	await h.page().getByRole("button", { name: "Edit group", exact: true }).click();
	const dialog = h.page().getByRole("dialog", { name: "Edit group" });
	await dialog.getByLabel("OpenBot", { exact: true }).check();
	await dialog.getByLabel("Alpha", { exact: true }).uncheck();
	await dialog.getByLabel("Lead", { exact: true }).selectOption(beta);
	await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
	await until(async () => (await snapshot()).group.memberIds).toEqual([beta, core]);
	expect((await snapshot()).tasks.find((d: any) => d.input.includes("This must never run")).state).toBe("cancelled");
	const direct = await api("conversations.snapshot", { botId: alpha });
	expect(direct.approvals).toHaveLength(1);
	await api("runs.cancel", { runId: direct.run.runId });
});
it("Core creates and edits through exact approval; group Core has no management tools", async () => {
	await h.page().locator(".bot-row", { hasText: "OpenBot" }).click();
	h.model.script(
		{ tool: "group_create", args: { name: "Core room", objective: "A second group", memberIds: [alpha, beta], leadBotId: alpha } },
		{ text: "Core room created" },
	);
	await h.send("Create a group called Core room with Alpha and Beta.");
	await h.page().getByText("Review this group change", { exact: true }).waitFor();
	expect(await api("groups.list")).toHaveLength(1);
	expect(await h.page().getByRole("button", { name: "Always allow", exact: true }).count()).toBe(0);
	await h.relaunch();
	await h.page().getByText("Review this group change", { exact: true }).waitFor();
	await approve();
	await h.page().getByText("Core room created", { exact: true }).waitFor();
	const room = (await api("groups.list")).find((g: any) => g.name === "Core room");
	h.model.script(
		{
			tool: "group_update",
			args: {
				groupId: room.groupId,
				expectedRevision: room.revision,
				name: "Core room",
				objective: "Updated objective",
				memberIds: [alpha, beta],
				leadBotId: beta,
			},
		},
		{ text: "Group updated" },
	);
	await h.send("Make Beta the lead and update the objective.");
	await approve();
	await h.page().getByText("Group updated", { exact: true }).waitFor();
	expect((await api("groups.snapshot", { groupId: room.groupId })).group.leadBotId).toBe(beta);
	await openGroup();
	h.model.script({ tool: "group_dissolve", args: { groupId, expectedRevision: 2 } }, { text: "Group management unavailable here" });
	const first = h.model.requests.length;
	await api("groups.send", { groupId, requestId: "group-core", text: "Pretend you can dissolve this group", recipientIds: [core] });
	await waitReply("Group management unavailable here");
	expect(JSON.stringify(h.model.requests[first]?.tools)).not.toContain("group_dissolve");
	expect((await snapshot()).group.status).toBe("active");
	// Core direct can dissolve the other room, but the user can deny the proposal.
	await h.page().locator(".bot-row", { hasText: "OpenBot" }).click();
	h.model.script({ tool: "group_dissolve", args: { groupId: room.groupId, expectedRevision: 2 } }, { text: "Dissolution denied" });
	await h.send("Dissolve Core room.");
	await h.page().getByRole("group", { name: "Approval request" }).getByRole("button", { name: "Deny", exact: true }).click();
	await h.page().getByText("Dissolution denied", { exact: true }).waitFor();
	expect((await api("groups.snapshot", { groupId: room.groupId })).group.status).toBe("active");
});
it("Chinese management and dissolution retain history and stop pending work", async () => {
	await openGroup();
	h.model.script({ tool: "local_exec", args: { command: "echo never-after-dissolve", description: "Pending group task" } });
	await send("Hold this task.");
	await h.page().getByRole("group", { name: "Approval request" }).waitFor();
	await api("settings.update", { language: "zh-CN" });
	await h.relaunch();
	await h.page().locator(".group-nav", { hasText: "Studio" }).click();
	await h.page().getByRole("button", { name: "编辑群组", exact: true }).waitFor();
	await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(880, 620));
	await h.page().locator(".approval-actions").scrollIntoViewIfNeeded();
	await h.shot("03-chinese-group-small");
	await h.page().getByRole("button", { name: "解散群组", exact: true }).click();
	await h.shot("04-chinese-dissolve");
	await h.page().getByRole("dialog", { name: "解散群组" }).getByRole("button", { name: "解散群组", exact: true }).click();
	await until(async () => (await snapshot()).group.status).toBe("dissolved");
	expect((await snapshot()).tasks.some((d: any) => d.state === "pending")).toBe(false);
	expect(await api("bots.list")).toHaveLength(3);
	const count = (await snapshot()).posts.length;
	await h.relaunch();
	await h.page().locator(".group-nav", { hasText: "Studio" }).click();
	await h.page().getByText("此群组已解散。历史记录只读，保存在此 Mac 上。", { exact: true }).waitFor();
	expect((await snapshot()).posts).toHaveLength(count);
	await expect(api("groups.send", { groupId, requestId: "late", text: "No" })).rejects.toThrow();
	await h.shot("05-dissolved-history");
});

it("deleting the lead pauses the group until the user repairs membership", async () => {
	await api("settings.update", { language: "en" });
	await h.relaunch();
	await h.page().locator(".group-nav", { hasText: "Core room" }).click();
	await api("bots.delete", { botId: beta });
	await h.page().getByText("Choose members and a lead before sending a task", { exact: true }).waitFor();
	const room = (await api("groups.list")).find((g: any) => g.name === "Core room");
	expect(room.leadBotId).toBeNull();
	expect(room.memberIds).toEqual([alpha]);
	await h.page().getByRole("button", { name: "Edit group", exact: true }).click();
	const dialog = h.page().getByRole("dialog", { name: "Edit group" });
	await dialog.getByLabel("OpenBot", { exact: true }).check();
	await dialog.getByLabel("Lead", { exact: true }).selectOption(alpha);
	await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
	h.model.script({ text: "Repaired group response" });
	await send("Continue after repairing the group.");
	await h.page().getByText("Repaired group response", { exact: true }).waitFor();
	expect((await api("groups.snapshot", { groupId: room.groupId })).group.memberIds).toEqual([alpha, core]);
	await h.shot("06-repaired-group");
});
