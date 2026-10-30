/** Generic application report inputs, exercised with two configured researchers and the existing Core. */
import { beforeAll, afterAll, afterEach, expect, it } from "vitest";
import { launchApp, type AppHarness } from "./harness.ts";
let h: AppHarness, core: string, groupId: string, sourceA: any, sourceB: any, summary: any;
const api = (name: string, params = {}): Promise<any> => h.page().evaluate(({ name, params }) => (window as any).openbot.methods[name](params), { name, params });
const button = (name: string) => h.page().getByRole("button", { name, exact: true });
const poll = (fn: () => Promise<any>, timeout = 20000) => expect.poll(fn, { timeout, interval: 200 });
const snapshot = () => api("groups.snapshot", { groupId });
const detail = (routineId = summary.routineId) => api("routines.get", { routineId });
const openGroup = async () => { await h.page().locator(".group-nav").filter({ hasText: "Research room" }).click(); };
const fields = { name: "Source report", instructions: "Return a source-backed report. This is a synthetic fixture.", schedule: { kind: "daily", time: "07:10", timezone: "Asia/Singapore" }, catchUpHours: 24, skills: [] };
beforeAll(async () => {
	h = await launchApp("routine-summaries");
	h.page().setDefaultTimeout(12000);
	await api("settings.update", { defaultModel: { provider: "scripted", modelId: "scripted" } });
	core = (await api("bots.list")).find((b: any) => b.kind === "core").botId;
	const a = (await api("bots.create", { requestId: "a", name: "Domestic Hunter", role: "Domestic research" })).botId;
	const b = (await api("bots.create", { requestId: "b", name: "International Hunter", role: "International research" })).botId;
	groupId = "group_summary_acceptance";
	await api("groups.change", { action: "create", requestId: "group", groupId, expectedRevision: 0, fields: { name: "Research room", objective: "Compare the researchers' reports", memberIds: [core, a, b], leadBotId: core } });
	// The Host scheduler's own calendar firing proves no test action or daily user message is required. The minute is
	// far enough ahead to stay in the future during setup; the test then moves the Host clock to it instead of waiting.
	const time = new Date(Date.now() + 120000).toISOString().slice(11, 16);
	for (const [index, botId] of [a, b].entries()) {
		const r = await api("routines.change", { action: "create", requestId: `source-${index}`, botId, fields: { ...fields, name: index ? "International report" : "Domestic report", schedule: { kind: "daily", time, timezone: "UTC" }, reportTo: { groupId, groupRevision: 1 } } });
		if (index) sourceB = r; else sourceA = r;
	}
});
afterEach(async ({ task }) => { if (task.result?.state === "fail") await h.shot("failure"); });
afterAll(async () => { await h?.close(); });
it("confirms generic inputs and automatically waits for both scheduled reports before Core summarizes", async () => {
	await openGroup(); await button("Conversation details").click(); await button("New group routine").click();
	await h.page().getByLabel("Bot", { exact: true }).selectOption(core);
	await h.page().getByLabel("Routine name", { exact: true }).fill("Daily comparison");
	await h.page().getByLabel("Use reports from other routines", { exact: true }).check();
	await h.page().getByLabel("Domestic report", { exact: true }).check();
	await h.page().getByLabel("International report", { exact: true }).check();
	await h.page().getByLabel("Workflow", { exact: true }).fill("Compare both reports. Preserve primary links, distinguish facts and suggestions, and disclose missing inputs.");
	await h.page().getByLabel("Local time", { exact: true }).fill(sourceA.schedule.time);
	await h.page().getByLabel("Time zone", { exact: true }).fill("UTC");
	await button("Review routine").click();
	await h.page().getByRole("region", { name: "Selected report inputs" }).getByText("Domestic report", { exact: false }).waitFor();
	await h.shot("01-review-inputs-en");
	expect((await api("routines.list")).routines).toHaveLength(2);
	await button("Confirm routine change").click();
	await poll(async () => (await api("routines.list")).routines.length).toBe(3);
	summary = (await api("routines.list")).routines.find((r: any) => r.name === "Daily comparison");
	expect(summary.botId).toBe(core);
	expect(await api("bots.list")).toHaveLength(3);
	h.model.script(
		{ text: "Domestic fact: stable tool discovery. [Primary A](https://example.com/domestic)" },
		{ text: "International fact: recovery prerelease. [Primary B](https://example.com/international)", delayMs: 7000 },
		{ text: "Daily comparison: both reports are available. One stable change and one prerelease. [Primary A](https://example.com/domestic) and [Primary B](https://example.com/international). Suggested priority: recovery." },
	);
	expect((await detail()).history).toHaveLength(0);
	await h.advanceHostClockTo(summary.nextAt + 1000);
	await poll(async () => (await detail()).history[0]?.state).toBe("pending");
	await h.page().getByRole("status").getByText("Waiting for source reports", { exact: true }).waitFor();
	await h.shot("02-waiting-inputs-en");
	await poll(async () => (await detail()).history[0]?.published, 25000).toBe(true);
	const occurrence = (await detail()).history[0];
	expect(occurrence.test).toBe(false);
	expect(occurrence.scheduledAt).toBe(summary.nextAt);
	expect(occurrence.inputSnapshot.entries.map((e: any) => e.status)).toEqual(["ready", "ready"]);
	expect(h.model.requests).toHaveLength(3);
	const prompt = JSON.stringify(h.model.requests[2]?.messages);
	expect(prompt).toContain("Domestic fact"); expect(prompt).toContain("International fact");
	expect(prompt).toContain("Host-confirmed report inputs");
	for (const tool of ["bot_delegate", "group_create", "codemode"]) expect(JSON.stringify(h.model.requests[2]?.tools)).not.toContain(`"name":"${tool}"`);
	const posts = (await snapshot()).posts;
	expect(posts).toHaveLength(3);
	expect(posts[2]).toMatchObject({ senderId: core, routine: { inputs: { ready: 2, total: 2 }, test: false } });
	expect((await snapshot()).tasks).toHaveLength(0);
	await h.page().getByRole("button", { name: /Completed/, exact: false }).click();
	await h.page().getByRole("region", { name: "Captured report inputs" }).waitFor();
	await h.shot("03-captured-inputs-en");
});
it("opens exact source posts, shows Chinese coverage and keeps one summary after full restart", async () => {
	await button("Open source report").first().click();
	await h.page().getByRole("link", { name: "Primary A", exact: true }).first().waitFor();
	await h.page().locator(".search-target").getByRole("link", { name: "Primary A", exact: true }).waitFor();
	const posts = (await snapshot()).posts;
	await h.crashHost(); await h.relaunch(); await openGroup();
	expect((await snapshot()).posts).toEqual(posts);
	expect(h.model.requests).toHaveLength(3);
	await api("settings.update", { language: "zh-CN" });
	await h.page().getByText("报告就绪：2/2", { exact: false }).waitFor();
	await h.shot("04-automatic-summary-zh");
	await api("settings.update", { language: "en" });
});
it("publishes a partial summary with authoritative missing-input status", async () => {
	const never = await api("routines.change", { action: "create", requestId: "never", botId: sourceB.botId, fields: { ...fields, name: "Unreported source", schedule: { kind: "interval", minutes: 10080 }, reportTo: { groupId, groupRevision: 1 } } });
	const partial = await api("routines.change", { action: "create", requestId: "partial", botId: core, fields: { ...fields, name: "Partial comparison", reportTo: { groupId, groupRevision: 1 }, reportInputs: { sources: [{ routineId: sourceA.routineId, revision: 1 }, { routineId: never.routineId, revision: 1 }], windowHours: 24, waitMinutes: 0 } } });
	h.model.script({ text: "Partial comparison: the domestic report is available; the second report is missing. Missing is not no updates." });
	await api("routines.test", { routineId: partial.routineId, expectedRevision: 1, requestId: "partial-test" });
	await poll(async () => (await detail(partial.routineId)).history[0]?.published).toBe(true);
	expect((await detail(partial.routineId)).history[0].inputSnapshot.entries.map((e: any) => e.status)).toEqual(["ready", "missing"]);
	await h.page().getByText("Inputs ready: 1/2", { exact: false }).waitFor();
	await h.shot("05-partial-inputs-en");
});
it("restores a waiting occurrence and revokes it when a source is edited without another model request", async () => {
	const list = (await api("routines.list")).routines;
	const never = list.find((r: any) => r.name === "Unreported source");
	const waiting = await api("routines.change", { action: "create", requestId: "waiting", botId: core, fields: { ...fields, name: "Waiting comparison", reportTo: { groupId, groupRevision: 1 }, reportInputs: { sources: [{ routineId: never.routineId, revision: 1 }], windowHours: 24, waitMinutes: 20 } } });
	const count = h.model.requests.length;
	const occurrence = await api("routines.test", { routineId: waiting.routineId, expectedRevision: 1, requestId: "waiting-test" });
	await h.crashHost(); await h.relaunch();
	expect((await detail(waiting.routineId)).history[0]).toMatchObject({ occurrenceId: occurrence.occurrenceId, state: "pending" });
	await api("routines.change", { action: "pause", requestId: "source-pause", routineId: never.routineId, expectedRevision: 1 });
	await poll(async () => (await detail(waiting.routineId)).history[0]?.published).toBe(true);
	expect((await detail(waiting.routineId)).routine).toMatchObject({ enabled: false, inputsBlocked: true });
	expect(h.model.requests).toHaveLength(count);
	await h.page().getByRole("button", { name: /^Settings/ }).click(); await button("Routines").click();
	await h.page().getByRole("button", { name: /^Waiting comparison/ }).click();
	await h.page().getByRole("status").getByText("Source routines changed. Edit this routine to confirm its report inputs again.", { exact: true }).waitFor();
	await h.shot("06-inputs-reconfirmation-en");
});
