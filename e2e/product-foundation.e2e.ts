/** I1: combined artifacts, policy, lifecycle, usage and bounded observation on the actual hidden desktop. */
import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { launchApp, type AppHarness } from "./harness.ts";
let h: AppHarness, core: string, original: string, inputId: string, resultId: string;
const reported = { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 };
const poll = (fn: () => Promise<any>) => expect.poll(fn, { timeout: 15000 });
const snapshot = () => h.api("conversations.snapshot", { botId: core });
const usage = () => h.api("usage.get", { botId: core });
const box = () => h.page().locator(".compose-area textarea");
beforeAll(async () => {
	h = await launchApp("product-foundation", {
		prepare: async (run) => {
			await writeFile(join(run, "input.txt"), "I1_INPUT_CANARY 本地材料");
			return {};
		},
	});
	h.page().setDefaultTimeout(10000);
	await h.api("settings.update", { defaultModel: { provider: "scripted", modelId: "scripted" } });
	core = (await h.api("bots.list")).find((b: any) => b.kind === "core").botId;
});
afterEach(async ({ task }) => {
	if (task.result?.state === "fail") await h.shot("failure");
});
afterAll(async () => {
	await h?.close();
});
it("retains queued inputs across pause/restart, asks before publication and settles interrupted usage", async () => {
	await h.page().getByRole("button", { name: "Settings", exact: true }).click();
        await h.page().getByRole("button", { name: "Pause all", exact: true }).click();
        await h.page().getByRole("button", { name: "Back to chat", exact: true }).click();
	await poll(async () => (await h.api("lifecycle.get")).transitioning).toBe(false);
	await h.app().evaluate(
		({ dialog }, path) => {
			dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as any;
		},
		join(h.run, "input.txt"),
	);
	await h.page().getByRole("button", { name: "Attach files", exact: true }).click();
	await poll(() => h.page().locator(".attachment-chips .artifact-card").count()).toBe(1);
	inputId = (await h.page().locator(".attachment-chips .artifact-card").getAttribute("data-artifact-id"))!;
	await box().fill("Create a report from the attached material, publish it, then run the probe.");
	await h.page().reload();
	await poll(() => h.page().locator(".attachment-chips .artifact-card").count()).toBe(1);
	expect(await box().inputValue()).toContain("Create a report");
	await rm(join(h.run, "input.txt"));
	await box().press("Enter");
	await poll(async () => (await snapshot()).run?.state).toBe("queued");
	original = (await snapshot()).run.runId;
	expect(h.model.requests).toHaveLength(0);
	await h.relaunch();
	const policy = await h.api("policy.get");
	await h.api("policy.ask.create", {
		requestId: "i1-publication",
		expectedRevision: policy.revision,
		predicate: { tool: "artifact_publish", path: h.workspace },
	});
	h.model.script(
		{ tool: "local_write", args: { path: "report.txt", content: "I1_RESULT_CANARY" }, usage: reported },
		{ tool: "artifact_publish", args: { path: "report.txt", name: "Report.txt" }, usage: reported },
		{
			tool: "local_exec",
			args: {
				command: "printf 'once\\n' >> count.txt; sleep 30; printf 'late\\n' >> count.txt",
				description: "Interrupt the integration probe",
			},
			usage: reported,
		},
	);
	await h.page().getByRole("button", { name: "Resume work", exact: true }).click();
	await poll(async () => (await snapshot()).approvals?.[0]?.tool).toBe("artifact_publish");
	let approval = (await snapshot()).approvals[0];
	expect(approval.reason).toContain("Ask first");
	await h.api("approvals.decide", { approvalId: approval.approvalId, decision: "allow_once" });
	await poll(async () => (await snapshot()).approvals?.[0]?.tool).toBe("local_exec");
	const published = (await snapshot()).items.find((i: any) => i.tool === "artifact_publish");
	resultId = published.artifact.artifactId;
	expect((await h.api("artifacts.preview", { artifactId: resultId })).text).toBe("I1_RESULT_CANARY");
	approval = (await snapshot()).approvals[0];
	await h.api("approvals.decide", { approvalId: approval.approvalId, decision: "allow_once" });
	await poll(() => readFile(join(h.workspace, "count.txt"), "utf8").catch(() => "")).toBe("once\n");
	await h.page().getByRole("button", { name: "Settings", exact: true }).click();
        await h.page().getByRole("button", { name: "Pause all", exact: true }).click();
        await h.page().getByRole("button", { name: "Back to chat", exact: true }).click();
	await poll(async () => (await h.api("lifecycle.get")).transitioning).toBe(false);
	await h.page().getByText("Task interrupted", { exact: true }).waitFor();
	const data = await usage();
	expect(data.runs.find((r: any) => r.runId === original)).toMatchObject({ state: "needs_attention", usage: { totalTokens: 390 } });
	expect(data.total.totalTokens).toBe(390);
	expect(JSON.stringify(h.model.requests[0]!.messages)).toContain("I1_INPUT_CANARY");
	await h.page().locator(".details-toggle").click();
	await h.page().locator(".usage-panel > summary").click();
	await poll(() => h.page().locator(".usage-run > summary").textContent()).toContain("Needs attention");
	await h.page().locator(".usage-run > summary").click();
	await h.shot("01-interrupted-usage-en");
	await h
		.page()
		.getByRole("button", { name: /^View approval/ })
		.first()
		.click();
	await poll(() => h.page().locator(".search-target").count()).toBe(1);
	await h.shot("02-publication-evidence");
});
it("continues once with the same attachments, preserves receipts after reconnect and stays silent", async () => {
	const before = h.model.requests.length;
	await h.relaunch();
	expect(h.model.requests).toHaveLength(before);
	expect((await usage()).total.totalTokens).toBe(390);
	expect(await readFile(join(h.workspace, "count.txt"), "utf8")).toBe("once\n");
	await h.api("settings.update", { language: "zh-CN" });
	await h.page().getByRole("button", { name: "恢复工作", exact: true }).waitFor();
	await h.page().getByRole("button", { name: "恢复工作", exact: true }).click();
	h.model.script({ text: "已检查已有报告，不重复执行写入。", usage: reported });
	await h.page().getByRole("button", { name: "继续任务", exact: true }).click();
	await h.page().getByText("已检查已有报告，不重复执行写入。", { exact: true }).waitFor();
	await poll(async () => (await snapshot()).run).toBeUndefined();
	const next = await usage();
	expect(next.total.totalTokens).toBe(520);
	expect(next.runs[0].runId).not.toBe(original);
	expect(next.runs[0].usage.totalTokens).toBe(130);
	expect(next.runs.find((r: any) => r.runId === original).usage.totalTokens).toBe(390);
	const repeated = await h.api("runs.continue", { runId: original, requestId: `continue:${original}` });
	expect(repeated.runId).toBe(next.runs[0].runId);
	expect(h.model.requests.length).toBe(before + 1);
	expect((await snapshot()).items.filter((i: any) => i.kind === "user").at(-1).attachments[0].artifactId).toBe(inputId);
	await rm(join(h.workspace, "report.txt"));
	expect((await h.api("artifacts.preview", { artifactId: resultId })).text).toBe("I1_RESULT_CANARY");
	await box().fill("保留草稿 · keep this draft");
	await h.page().reload();
	await poll(() => box().inputValue()).toBe("保留草稿 · keep this draft");
	await h.page().locator(".details-toggle").click();
	await h.page().locator(".usage-panel > summary").click();
	await poll(() => h.page().locator(".usage-run").count()).toBe(2);
	await h.shot("03-integrated-zh");
	expect(await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((w) => !w.isVisible() && !w.isFocused()))).toBe(
		true,
	);
	const audit = await readFile(join(h.dataDirectory, "logs/host.log"), "utf8");
	expect(audit).not.toMatch(/I1_INPUT_CANARY|I1_RESULT_CANARY|printf 'once/);
});
