/** B11a: hidden desktop confirms real work, enforces ordinary authority and restores durable reports. */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, afterAll, afterEach, expect, it } from "vitest";
import { launchApp, type AppHarness } from "./harness.ts";
let h: AppHarness, core: string, routine: any, first: string;
const api = (name: string, params = {}): Promise<any> =>
	h.page().evaluate(({ name, params }) => (window as any).openbot.methods[name](params), { name, params });
const poll = (fn: () => Promise<any>) => expect.poll(fn, { timeout: 20000 });
const button = (name: string) => h.page().getByRole("button", { name, exact: true });
const detail = () => api("routines.get", { routineId: routine.routineId });
const select = async () => {
	await h.page().getByRole("button", { name: /^Settings/ }).click();
	await button("Routines").click();
	await h
		.page()
		.getByRole("button", { name: /Morning sales/ })
		.click();
};
const confirmRun = async () => {
	const previous = (await detail()).history[0]?.occurrenceId;
	await button("Test run").click();
	await button("Run now").click();
	await poll(async () => (await detail()).history[0]?.occurrenceId).not.toBe(previous);
};
beforeAll(async () => {
	h = await launchApp("routines");
	h.page().setDefaultTimeout(12000);
	await api("settings.update", { defaultModel: { provider: "scripted", modelId: "scripted" } });
	core = (await api("bots.list")).find((b: any) => b.kind === "core").botId;
	await writeFile(join(h.workspace, "sales.csv"), "region,revenue\nEast,350\nWest,480\n");
});
afterEach(async ({ task }) => {
	if (task.result?.state === "fail") await h.shot("failure");
});
afterAll(async () => {
	await h?.close();
});
it("reviews before saving, pins a skill and runs an isolated report with a real artifact", async () => {
	const skill = await api("skills.save", {
		requestId: "routine-skill",
		name: "sales-digest",
		expectedRevision: 0,
		document: {
			name: "sales-digest",
			description: "Summarize current sales",
			inputs: "sales.csv",
			requirements: "A readable source",
			steps: "ROUTINE_SKILL_CANARY: sum revenue",
			validation: "Check the sum",
			output: "Markdown report",
			approvalBoundaries: "Existing policy applies",
		},
	});
	h.model.script({ text: "Private context noted." });
	await h.send("PRIVATE_ROUTINE_CANARY");
	await h.page().getByText("Private context noted.", { exact: true }).waitFor();
	await h.page().getByRole("button", { name: /^Settings/ }).click();
	await button("Routines").click();
	await button("New routine").click();
	await h.page().getByLabel("Routine name", { exact: true }).fill("Morning sales");
	await h
		.page()
		.getByLabel("Workflow", { exact: true })
		.fill("Read sales.csv, total revenue and publish morning-sales.md. Report missing data explicitly.");
	await h.page().getByLabel("Frequency", { exact: true }).selectOption("weekly");
	await h.page().getByLabel("Weekday", { exact: true }).selectOption("1");
	await h.page().getByLabel("Time zone", { exact: true }).fill("Asia/Singapore");
	await h
		.page()
		.getByLabel(/sales-digest/)
		.check();
	await button("Review routine").click();
	expect((await api("routines.list")).routines).toHaveLength(0);
	await h.shot("01-review-en");
	await button("Confirm routine change").click();
	await poll(async () => (await api("routines.list")).routines.length).toBe(1);
	routine = (await api("routines.list")).routines[0];
	await select();
	await select();
	await button("Edit routine").waitFor();
	expect(routine.skills).toEqual([{ name: skill.name, revision: skill.revision, sha256: skill.sha256 }]);
	const count = h.model.requests.length;
	h.model.script(
		{ tool: "local_read", args: { path: "sales.csv" } },
		{ tool: "local_write", args: { path: "morning-sales.md", content: "# Morning sales\n\nRevenue: **830**\n\nEast: 350 · West: 480" } },
		{ tool: "artifact_publish", args: { path: "morning-sales.md" } },
		{ text: "Morning sales: revenue is 830. The report is ready." },
	);
	await button("Test run").click();
	expect(h.model.requests).toHaveLength(count);
	await h.shot("02-test-confirmation-en");
	await button("Run now").click();
	await poll(async () => (await detail()).history[0]?.published).toBe(true);
	const o = (await detail()).history[0];
	first = o.occurrenceId;
	expect(o.state).toBe("completed");
	expect(await readFile(join(h.workspace, "morning-sales.md"), "utf8")).toContain("830");
	expect(o.artifacts).toHaveLength(1);
	expect(JSON.stringify(h.model.requests[count]?.messages)).not.toContain("PRIVATE_ROUTINE_CANARY");
	expect(JSON.stringify(h.model.requests[count]?.messages)).toContain("ROUTINE_SKILL_CANARY");
	const tools = JSON.stringify(h.model.requests[count]?.tools);
	for (const name of ["bot_create", "group_create", "codemode", "bot_delegate"]) expect(tools).not.toContain(`"name":"${name}"`);
	await h
		.page()
		.getByRole("region", { name: "Routine result" })
		.getByText("Morning sales: revenue is 830. The report is ready.", { exact: true })
		.first()
		.waitFor();
	await h.page().locator(".routine-result").scrollIntoViewIfNeeded();
	await h.shot("03-result-en");
	const direct = await api("conversations.snapshot", { botId: core });
	expect(direct.items.filter((i: any) => i.routine?.occurrenceId === first)).toHaveLength(1);
	expect((await api("conversations.list")).find((s: any) => s.conversationKey === `bot:${core}`).unreadCount).toBeGreaterThan(0);
	expect(h.model.requests).toHaveLength(count + 4);
});
it("restores one report after restart, searches it and opens the exact routine history", async () => {
	await h.relaunch();
	await h
		.page()
		.locator(".routine-report-label")
		.getByText(/Morning sales/)
		.waitFor();
	const reports = (await api("conversations.snapshot", { botId: core })).items.filter((i: any) => i.routine?.occurrenceId === first);
	expect(reports).toHaveLength(1);
	const result = await api("conversations.search", { query: "revenue is 830" });
	expect(JSON.stringify(result)).toContain(reports[0].id);
	await button("View routine").click();
	await h.page().getByRole("region", { name: "Routine result" }).waitFor();
	await h.shot("04-restored-en");
	expect((await detail()).routine.schedule).toEqual({ kind: "weekly", weekday: 1, time: "09:00", timezone: "Asia/Singapore" });
});
it("shows unattended expiry and denies a command without writing, then pauses pending work", async () => {
	await api("policy.update", { commandSetting: "ask" });
	h.model.script(
		{ tool: "local_exec", args: { command: "printf forbidden >> forbidden.txt", description: "Write a test marker" } },
		{ text: "The command was denied; no marker was written." },
	);
	await confirmRun();
	await poll(async () => (await detail()).snapshot?.approvals.length).toBe(1);
	let d = await detail();
	const approval = d.snapshot.approvals[0];
	expect(approval.binding.origin).toBe("unattended");
	expect(approval.deadline - approval.createdAt).toBe(600000);
	await h.crashHost();
	await poll(async () => (await detail()).snapshot?.approvals[0]?.deadline).toBe(approval.deadline);
	await h
		.page()
		.getByText(/Unattended approval expires in/)
		.waitFor();
	await h.page().locator(".routine-result .approval").scrollIntoViewIfNeeded();
	await h.shot("05-approval-en");
	await h.page().locator(".routine-result .approval").getByRole("button", { name: "Deny", exact: true }).click();
	await poll(async () => (await detail()).history[0]?.published).toBe(true);
	expect(await readFile(join(h.workspace, "forbidden.txt"), "utf8").catch(() => null)).toBeNull();
	h.model.script({ tool: "local_exec", args: { command: "printf forbidden >> paused.txt", description: "Pending write" } });
	await confirmRun();
	await poll(async () => (await detail()).snapshot?.approvals.length).toBe(1);
	await button("Pause routine").click();
	await button("Confirm routine change").click();
	await poll(async () => (await detail()).routine.enabled).toBe(false);
	await poll(async () => (await detail()).history[0]?.state).toBe("cancelled");
	expect(await readFile(join(h.workspace, "paused.txt"), "utf8").catch(() => null)).toBeNull();
	await button("Resume routine").click();
	await button("Confirm routine change").click();
	await poll(async () => (await detail()).routine.enabled).toBe(true);
});
it("edits through review, keeps a failed model outcome, stops an occurrence and renders Chinese at minimum width", async () => {
	await button("Edit routine").click();
	await h.page().getByLabel("Frequency", { exact: true }).selectOption("interval");
	await h.page().getByLabel("Minutes between runs", { exact: true }).fill("15");
	await button("Review routine").click();
	expect((await detail()).routine.schedule.kind).toBe("weekly");
	await button("Confirm routine change").click();
	await poll(async () => (await detail()).routine.schedule.kind).toBe("interval");
	h.model.script(...Array.from({ length: 4 }, () => ({ error: "Source service unavailable" })));
	await confirmRun();
	await poll(async () => (await detail()).history[0]?.published).toBe(true);
	expect((await detail()).history[0].state).toBe("failed");
	h.model.script({ tool: "local_exec", args: { command: "printf forbidden >> stopped.txt", description: "Stop pending write" } });
	await confirmRun();
	await poll(async () => (await detail()).snapshot?.approvals.length).toBe(1);
	await button("Stop routine run").click();
	await poll(async () => (await detail()).history[0]?.state).toBe("cancelled");
	expect(await readFile(join(h.workspace, "stopped.txt"), "utf8").catch(() => null)).toBeNull();
	await api("settings.update", { language: "zh-CN" });
	await button("编辑定时任务").waitFor();
	await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(880, 640));
	await h.shot("06-history-zh-minimum");
	await button("编辑定时任务").click();
	await button("确认定时任务").waitFor();
	await h.shot("07-editor-zh-minimum");
	await button("取消").click();
	expect(await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((w) => !w.isVisible() && !w.isFocused()))).toBe(
		true,
	);
	await button("删除任务").click();
	expect((await detail()).routine.deleted).toBe(false);
	await button("确认更改定时任务").click();
	await poll(async () => (await api("routines.list")).routines.length).toBe(0);
	await h.relaunch();
	expect((await api("routines.list")).routines).toHaveLength(0);
});
it("fires a scheduled occurrence without Test run and reports missing source data honestly", async () => {
	await api("settings.update", { language: "en" });
	const next = new Date(Date.now() + 90000),
		time = next.toISOString().slice(11, 16);
	routine = await api("routines.change", {
		action: "create",
		botId: core,
		requestId: "scheduled-missing-source",
		fields: {
			name: "Morning sales · source check",
			instructions: "Read unavailable.csv. If it is missing, report that no total can be calculated.",
			schedule: { kind: "daily", time, timezone: "UTC" },
			catchUpHours: 0,
			skills: [],
		},
	});
	h.model.script(
		{ tool: "local_read", args: { path: "unavailable.csv" } },
		{ text: "The source unavailable.csv is missing. No revenue total can be calculated." },
	);
	await select();
	await expect.poll(async () => (await detail()).history[0]?.published, { timeout: 105000, interval: 500 }).toBe(true);
	const o = (await detail()).history[0];
	expect(o.test).toBe(false);
	expect(o.scheduledAt).toBe(routine.nextAt);
	await h
		.page()
		.getByRole("button", { name: /Completed/ })
		.click();
	await h
		.page()
		.locator(".routine-result > .markdown")
		.getByText("The source unavailable.csv is missing. No revenue total can be calculated.", { exact: true })
		.waitFor();
	await h.shot("08-scheduled-missing-source-en");
	expect((await detail()).history).toHaveLength(1);
}, 120000);
