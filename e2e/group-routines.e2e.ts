/** Two independent hunters publish into one group; fixture reports test delivery, not model reasoning. */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, afterAll, afterEach, expect, it } from "vitest";
import { launchApp, type AppHarness } from "./harness.ts";
let h: AppHarness, domestic: string, overseas: string, groupId: string, firstRoutine: any;
const api = (name: string, params = {}): Promise<any> => h.page().evaluate(({ name, params }) => (window as any).openbot.methods[name](params), { name, params });
const poll = (fn: () => Promise<any>) => expect.poll(fn, { timeout: 20000 });
const button = (name: string) => h.page().getByRole("button", { name, exact: true });
const snapshot = () => api("groups.snapshot", { groupId });
const openGroup = async () => {
	await h.page().locator(".group-nav").filter({ hasText: "Competitor radar" }).click();
	await h.page().getByRole("heading", { name: "Competitor radar", exact: true }).waitFor();
};
const openDetails = async () => {
	if (!(await h.page().getByRole("region", { name: "Group routines" }).isVisible())) await button("Conversation details").click();
};
beforeAll(async () => {
	h = await launchApp("group-routines");
	h.page().setDefaultTimeout(12000);
	await api("settings.update", { defaultModel: { provider: "scripted", modelId: "scripted" } });
	domestic = (await api("bots.create", { requestId: "domestic", name: "Domestic Hunter", role: "Verify domestic Agent releases" })).botId;
	overseas = (await api("bots.create", { requestId: "overseas", name: "International Hunter", role: "Verify international Agent releases" })).botId;
	await writeFile(join(h.workspace, "domestic-source.md"), "Synthetic captured changelog. Source: https://domestic.example/releases/v1.2\nStable 1.2: tools can search their catalogue. Published inside the daily reporting window.\n");
	await writeFile(join(h.workspace, "international-source.md"), "Synthetic captured changelog. Source: https://international.example/changelog\nPrerelease 2.0-beta: context recovery. Stable 1.9 is older than the reporting window.\n");
}, 90000);
afterEach(async ({ task }) => { if (task.result?.state === "fail") await h.shot("failure"); });
afterAll(async () => { await h?.close(); });
it("creates a two-hunter group and confirms its report destination from group details", async () => {
	await button("New").click();
	await h.page().getByRole("button", { name: /^Create group/ }).click();
	const dialog = h.page().getByRole("dialog", { name: "Create group" });
	await dialog.getByLabel("Group name").fill("Competitor radar");
	await dialog.getByLabel("Objective").fill("Compare Agent changelogs. Link primary sources; distinguish stable releases, prereleases, no updates and unavailable sources.");
	await dialog.getByLabel("Domestic Hunter", { exact: true }).check();
	await dialog.getByLabel("International Hunter", { exact: true }).check();
	await dialog.getByLabel("Lead", { exact: true }).selectOption(domestic);
	await dialog.getByRole("button", { name: "Create group", exact: true }).click();
	groupId = (await api("groups.list"))[0].groupId;
	await openDetails();
	await button("New group routine").click();
	expect(await h.page().getByLabel("Send reports to", { exact: true }).inputValue()).toBe(groupId);
	await h.page().getByLabel("Bot", { exact: true }).selectOption(domestic);
	await h.page().getByLabel("Routine name", { exact: true }).fill("Domestic morning report");
	await h.page().getByLabel("Workflow", { exact: true }).fill("Read domestic-source.md. Report the last daily window, stable releases and primary links. Mark missing retrieval as unverified, never no updates.");
	await h.page().getByLabel("Local time", { exact: true }).fill("07:10");
	await h.page().getByLabel("Time zone", { exact: true }).fill("Asia/Singapore");
	await button("Review routine").click();
	await h.page().getByRole("region", { name: "Review routine" }).getByText("Send reports to: Competitor radar", { exact: true }).waitFor();
	expect((await api("routines.list")).routines).toHaveLength(0);
	await h.shot("01-group-routine-review-en");
	await button("Confirm routine change").click();
	await poll(async () => (await api("routines.list")).routines.length).toBe(1);
	firstRoutine = (await api("routines.list")).routines[0];
	expect(firstRoutine.reportTo).toEqual({ groupId, groupRevision: 1 });
});
it("publishes both attributed reports, follows sources and summarizes without automatic peer wakeups", async () => {
	h.model.script({ tool: "local_read", args: { path: "domestic-source.md" } },
		{ text: "Domestic stable release: **1.2** adds tool discovery. [Primary changelog](https://domestic.example/releases/v1.2). Reporting window: previous 07:00 to current 07:00 Asia/Singapore. Captured test source." });
	await button("Test run").click(); await button("Run now").click();
	await poll(async () => (await snapshot()).posts.length).toBe(1);
	const second = await api("routines.change", { action: "create", requestId: "international-routine", botId: overseas,
		fields: { name: "International morning report", instructions: "Read international-source.md and check the missing source. Separate stable, prerelease and unavailable sources.", schedule: { kind: "daily", time: "07:15", timezone: "Asia/Singapore" }, catchUpHours: 24, skills: [], reportTo: { groupId, groupRevision: 1 } } });
	h.model.script({ tool: "local_read", args: { path: "international-source.md" } },
		{ tool: "web_fetch", args: { url: "http://127.0.0.1/unavailable-changelog" } },
		{ text: "International update: **2.0-beta** is a prerelease; no new stable release in the captured source. [Primary changelog](https://international.example/changelog). Additional source unavailable: local URL refused. This is not evidence of no update." });
	const count = h.model.requests.length;
	await api("routines.test", { routineId: second.routineId, expectedRevision: 1, requestId: "international-test" });
	await poll(async () => (await snapshot()).posts.length).toBe(2);
	const posts = (await snapshot()).posts;
	expect(posts.map((p: any) => p.senderId)).toEqual([domestic, overseas]);
	expect(posts.every((p: any) => p.routine && p.recipientIds.length === 0)).toBe(true);
	expect((await snapshot()).tasks).toHaveLength(0);
	expect(h.model.requests.length).toBe(count + 3);
	expect(JSON.stringify(h.model.requests[count]?.tools)).not.toContain('"name":"bot_delegate"');
	await openGroup();
	await h.page().getByRole("link", { name: "Primary changelog", exact: true }).first().waitFor();
	expect(await h.page().getByRole("link", { name: "Primary changelog", exact: true }).first().getAttribute("href")).toBe("https://domestic.example/releases/v1.2");
	await h.shot("02-two-hunter-reports-en");
	h.model.script({ text: "Radar summary: one domestic stable release, one international prerelease, and one unavailable source. The missing source still needs verification." });
	await h.send("Summarize the two reports and identify unverified sources.");
	await h.page().getByText("Radar summary: one domestic stable release, one international prerelease, and one unavailable source. The missing source still needs verification.", { exact: true }).waitFor();
	const prompt = JSON.stringify(h.model.requests.at(-1)?.messages);
	expect(prompt).toContain("Domestic stable release");
	expect(prompt).toContain("Additional source unavailable");
	await h.shot("03-coordinator-summary-en");
});
it("restores reports and exact history links, and exposes contextual routines in Chinese", async () => {
	const before = (await snapshot()).posts;
	await h.crashHost(); await h.relaunch(); await openGroup();
	expect((await snapshot()).posts).toEqual(before);
	const search = await api("conversations.search", { query: "Domestic stable release" });
	expect(JSON.stringify(search)).toContain(before[0].postId);
	await h.page().locator(".routine-report-label").getByRole("button", { name: "View routine", exact: true }).first().click();
	await h.page().getByRole("region", { name: "Routine result" }).waitFor();
	await h.page().getByRole("region", { name: "Routine result" }).getByText("Domestic stable release:", { exact: false }).first().waitFor();
	await button("Open group").click(); await openDetails();
	await h.page().getByRole("region", { name: "Group routines" }).getByText("Domestic morning report", { exact: true }).waitFor();
	await api("settings.update", { language: "zh-CN" });
	await h.page().getByRole("button", { name: "新建群内定时任务", exact: true }).waitFor();
	await h.shot("04-group-routines-zh");
	await api("settings.update", { language: "en" });
});
it("pauses a pending report when group membership changes without leaking it", async () => {
	h.model.script({ tool: "local_exec", args: { command: "echo pending-hunter-report", description: "Hold a report for approval" } });
	await api("routines.test", { routineId: firstRoutine.routineId, expectedRevision: 1, requestId: "pending" });
	await poll(async () => (await api("routines.get", { routineId: firstRoutine.routineId })).snapshot?.approvals.length).toBe(1);
	const previousPosts = (await snapshot()).posts.length;
	const core = (await api("bots.list")).find((b: any) => b.kind === "core").botId;
	await api("groups.change", { action: "update", requestId: "remove-hunter", groupId, expectedRevision: 1,
		fields: { name: "Competitor radar", objective: "Changed membership", memberIds: [overseas, core], leadBotId: core } });
	await poll(async () => (await api("routines.get", { routineId: firstRoutine.routineId })).history.find((o: any) => o.occurrenceId.endsWith(":pending"))?.published).toBe(true);
	const r = (await api("routines.get", { routineId: firstRoutine.routineId })).routine;
	expect(r).toMatchObject({ enabled: false, destinationBlocked: true });
	expect((await snapshot()).posts).toHaveLength(previousPosts);
	await openGroup(); await openDetails();
	await h.page().getByRole("region", { name: "Group routines" }).getByRole("button", { name: /Domestic morning report/ }).click();
	await h.page().getByRole("status").getByText("Report destination changed. Edit the routine to confirm its group again.", { exact: true }).waitFor();
	await h.shot("05-destination-paused-en");
});
