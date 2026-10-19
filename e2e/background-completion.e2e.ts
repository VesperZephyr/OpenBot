import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, afterAll, afterEach, expect, it } from "vitest";
import { launchApp, type AppHarness } from "./harness.ts";
let h: AppHarness, core: string;
const api = (name: string, params = {}): Promise<any> =>
	h.page().evaluate(({ name, params }) => (window as any).openbot.methods[name](params), { name, params });
const poll = (fn: () => Promise<any>) => expect.poll(fn, { timeout: 15000 });
const snapshot = () => api("conversations.snapshot", { botId: core });
const approve = () =>
	h.page().getByRole("group", { name: "Approval request" }).getByRole("button", { name: "Allow once", exact: true }).click();
const selectCore = () =>
	h
		.page()
		.locator(".bot-row")
		.filter({ has: h.page().getByText("OpenBot", { exact: true }) })
		.click();
const command = (marker: string) => ({
	tool: "local_exec",
	args: {
		command: `while [ ! -f ${marker} ]; do sleep 0.1; done; printf 'B15B_FINAL_13'`,
		description: `Wait for ${marker}`,
		background: true,
	},
});
beforeAll(async () => {
	h = await launchApp("background-completion");
	await api("settings.update", { defaultModel: { provider: "scripted", modelId: "scripted" } });
	core = (await api("bots.list"))[0].botId;
	await api("bots.create", { requestId: "analyst", name: "Analyst" });
});
afterEach(async ({ task }) => {
	if (task.result?.state === "fail") await h.shot("failure");
});
afterAll(async () => {
	await h?.close();
});
it("delivers a final result automatically while another Bot responds, with one immutable completion after restart", async () => {
	h.model.script(command("release-one"), { text: "The command is running; its result will return here." });
	await h.send("Run the background report.");
	await approve();
	await h.page().getByText("The command is running; its result will return here.", { exact: true }).waitFor();
	await poll(async () => (await snapshot()).backgroundTasks?.[0]?.state).toBe("running");
	await h.page().getByText("Command running", { exact: true }).waitFor();
	h.model.script({ text: "Another conversation is responsive." });
	await api("messages.submit", { botId: "bot_analyst", requestId: "parallel", text: "Answer while the command is running." });
	await poll(async () =>
		(await api("conversations.snapshot", { botId: "bot_analyst" })).items.some(
			(i: any) => i.kind === "assistant" && i.parts.some((p: any) => p.text === "Another conversation is responsive."),
		),
	).toBe(true);
	h.model.script({ text: "The background result is B15B_FINAL_13." });
	await writeFile(join(h.workspace, "release-one"), "go");
	await h.page().getByText("The background result is B15B_FINAL_13.", { exact: true }).waitFor();
	await poll(async () => (await snapshot()).backgroundTasks[0].state).toBe("delivered");
	const before = await snapshot(),
		record = before.backgroundTasks[0];
	expect(record.receipt.output).toBe("B15B_FINAL_13");
	expect(before.items.filter((i: any) => i.source === "background")).toHaveLength(1);
	expect(before.items.filter((i: any) => i.tool === "task_output")).toHaveLength(0);
	expect(JSON.stringify(h.model.requests.at(-1)?.messages)).toContain("untrusted command output");
	await h.page().getByText("Background task result", { exact: true }).waitFor();
	await h.shot("01-completion-en");
	await h.relaunch();
	await selectCore();
	expect((await snapshot()).items.filter((i: any) => i.source === "background")).toHaveLength(1);
	expect((await snapshot()).backgroundTasks[0].continuationRunId).toBe(record.continuationRunId);
});
it("keeps completion tools unattended and cannot grant Core management or recursively wake", async () => {
	h.model.script(command("release-two"), { text: "Second command started." });
	await h.send("Start another background report.");
	await approve();
	await h.page().getByText("Second command started.", { exact: true }).waitFor();
	h.model.script(
		{ tool: "bot_create", args: { name: "Forbidden automatic Bot", instructions: "Do work" } },
		{ tool: "local_exec", args: { command: "printf 'FOLLOWUP'", description: "Unattended follow-up", background: true } },
		{ text: "Follow-up denied; no extra Bot was created." },
	);
	await writeFile(join(h.workspace, "release-two"), "go");
	await poll(async () => (await snapshot()).approvals.length).toBe(1);
	const pending = (await snapshot()).approvals[0];
	expect(pending.binding.origin).toBe("unattended");
	expect(pending.expiresAt ?? pending.deadline).toBeDefined();
	await h.page().getByRole("group", { name: "Approval request" }).getByRole("button", { name: "Deny", exact: true }).click();
	await h.page().getByText("Follow-up denied; no extra Bot was created.", { exact: true }).waitFor();
	expect((await api("bots.list")).some((b: any) => b.name === "Forbidden automatic Bot")).toBe(false);
	await poll(async () => (await snapshot()).backgroundTasks.at(-1).state).toBe("delivered");
	expect((await snapshot()).backgroundTasks).toHaveLength(2);
});
it("stops a background task from its inline card and preserves the tombstone in Chinese after restart", async () => {
	h.model.script(command("release-stop"), { text: "A stoppable job is running." });
	await h.send("Start a job that I can stop.");
	await approve();
	await h.page().getByText("A stoppable job is running.", { exact: true }).waitFor();
	await h.page().getByRole("button", { name: "Stop background task", exact: true }).click();
	await poll(async () => (await snapshot()).backgroundTasks.at(-1).state).toBe("suppressed");
	const count = h.model.requests.length;
	await writeFile(join(h.workspace, "release-stop"), "late");
	await api("settings.update", { language: "zh-CN" });
	await h.relaunch();
	await selectCore();
	await h.page().getByText("自动续接已停止", { exact: true }).waitFor();
	await h.shot("02-stopped-zh");
	expect(h.model.requests.length).toBe(count);
	expect(await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((w) => !w.isVisible() && !w.isFocused()))).toBe(
		true,
	);
	expect(await readFile(join(h.dataDirectory, "logs/host.log"), "utf8")).not.toContain("B15B_FINAL_13");
});
it("returns group completion to the same root and suppresses dissolved group work", async () => {
	await api("settings.update", { language: "en" });
	await api("bots.create", { requestId: "reviewer", name: "Reviewer" });
	await api("groups.change", {
		requestId: "group",
		action: "create",
		groupId: "group_background",
		expectedRevision: 0,
		fields: { name: "Background studio", objective: "Reports", memberIds: ["bot_analyst", "bot_reviewer"], leadBotId: "bot_analyst" },
	});
	await h.page().locator(".group-nav").filter({ hasText: "Background studio" }).click();
	h.model.script(command("release-group"), { text: "Group command started." });
	await h.page().locator(".compose-area textarea").fill("Run a background group report.");
	await h.page().locator(".compose-area textarea").press("Enter");
	await approve();
	await h.page().getByText("Group command started.", { exact: true }).waitFor();
	const groupSnapshot = () => api("groups.snapshot", { groupId: "group_background" });
	await poll(async () => (await groupSnapshot()).backgroundTasks.length).toBe(1);
	expect((await groupSnapshot()).roots[0].state).toBe("running");
	h.model.script({ text: "Group final result: B15B_FINAL_13." });
	await writeFile(join(h.workspace, "release-group"), "go");
	await h.page().getByText("Group final result: B15B_FINAL_13.", { exact: true }).waitFor();
	await poll(async () => (await groupSnapshot()).roots[0].state).toBe("completed");
	const group = await groupSnapshot();
	expect(group.roots[0].automaticDeliveries).toBe(1);
	expect(group.posts.filter((p: any) => p.text === "Group final result: B15B_FINAL_13.")).toHaveLength(1);
	await h.shot("03-group-completion-en");
	h.model.script(command("release-dissolved"), { text: "Waiting in the group." });
	await api("groups.send", { groupId: "group_background", requestId: "dissolve-work", text: "Start a background job." });
	await approve();
	await h.page().getByText("Waiting in the group.", { exact: true }).waitFor();
	const current = (await groupSnapshot()).group;
	await api("groups.change", { requestId: "dissolve", action: "dissolve", groupId: current.groupId, expectedRevision: current.revision });
	await writeFile(join(h.workspace, "release-dissolved"), "late");
	await poll(async () => (await groupSnapshot()).backgroundTasks.at(-1).state).toBe("suppressed");
});
it("reset suppresses a copied result and an approved follow-up cannot create another automatic wake", async () => {
	await selectCore();
	h.model.script(command("release-reset"), { text: "Reset candidate started." });
	await h.send("Start a reset candidate.");
	await approve();
	await h.page().getByText("Reset candidate started.", { exact: true }).waitFor();
	const before = h.model.requests.length;
	await api("conversations.reset", { botId: core });
	await writeFile(join(h.workspace, "release-reset"), "go");
	await poll(async () => (await snapshot()).backgroundTasks.at(-1).state).toBe("suppressed");
	expect(h.model.requests.length).toBe(before);
	h.model.script(command("release-no-chain"), { text: "One permitted automatic result." });
	await h.send("Run a no-chain candidate.");
	await approve();
	await h.page().getByText("One permitted automatic result.", { exact: true }).waitFor();
	const subscriptions = (await snapshot()).backgroundTasks.length;
	h.model.script(
		{ tool: "local_exec", args: { command: "sleep 0.1; printf 'NO_CHAIN_FINAL'", description: "Approved follow-up", background: true } },
		{ text: "Follow-up started without another automatic wake." },
	);
	await writeFile(join(h.workspace, "release-no-chain"), "go");
	await approve();
	await h.page().getByText("Follow-up started without another automatic wake.", { exact: true }).waitFor();
	await poll(async () => (await snapshot()).backgroundTasks.at(-1).state).toBe("delivered");
	const state = await snapshot();
	expect(state.backgroundTasks).toHaveLength(subscriptions);
	expect(state.items.filter((i: any) => i.tool === "local_exec").at(-1).output).toContain("No automatic continuation is scheduled");
	await h.relaunch();
	await selectCore();
	expect((await snapshot()).backgroundTasks).toHaveLength(subscriptions);
});
