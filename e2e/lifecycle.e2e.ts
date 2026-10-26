/** Hidden native event simulation exercises the real Host and executor without locking or waking the owner's Mac. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AppHarness, createBot, launchApp } from "./harness.ts";
let h: AppHarness;
function api(method: string, params: unknown = {}) {
	return h
		.page()
		.evaluate(
			({ method, params }) =>
				(window as unknown as { openbot: { methods: Record<string, (params: unknown) => Promise<any>> } }).openbot.methods[method]!(params),
			{ method, params },
		);
}
async function native(event: string) {
	await h.app().evaluate(({ powerMonitor }, name) => powerMonitor.emit(name as never), event);
}
async function select(name: string) {
	await h
		.page()
		.locator(".bot-row")
		.filter({ has: h.page().getByText(name, { exact: true }) })
		.click();
}
beforeAll(async () => {
	h = await launchApp("lifecycle", { env: { OPENBOT_MAX_ACTIVE_RUNS: "1" } });
	await createBot(h, "Lifecycle");
}, 60000);
afterAll(async () => {
	await h?.close();
});
describe("Lifecycle gates", () => {
	it("queues without provider traffic, persists pause, and resumes only explicitly", async () => {
		await h.page().getByRole("button", { name: "Settings", exact: true }).click();
        await h.page().getByRole("button", { name: "Pause all", exact: true }).click();
        await h.page().getByRole("button", { name: "Back to chat", exact: true }).click();
		await expect.poll(async () => (await api("lifecycle.get")).transitioning).toBe(false);
		h.model.script({ text: "Queued work completed." });
		await h.send("Handle this after resume");
		expect(h.model.requests).toHaveLength(0);
		await h.shot("01-paused-queue");
		await h.relaunch();
		await select("Lifecycle");
		expect((await api("lifecycle.get")).blocked).toBe(true);
		expect(h.model.requests).toHaveLength(0);
		await h.page().getByRole("button", { name: "Resume work", exact: true }).click();
		await h.page().getByText("Queued work completed.", { exact: true }).waitFor();
		await h.shot("02-resumed");
	});
 it("keeps authorized work running across lock and unlock without a resume prompt", async () => {
  h.model.script({text:"Background work completed while locked.",delayMs:700});
  await h.send("Continue in the background");
  await native("lock-screen");
  await expect.poll(async()=>(await api("lifecycle.get")).locked).toBe(true);
  expect((await api("lifecycle.get")).blocked).toBe(false);
  await h.page().getByText("Background work completed while locked.",{exact:true}).waitFor();
  await native("unlock-screen");
  await expect.poll(async()=>(await api("lifecycle.get")).needsResume).toBe(false);
 });

	it("stops approved execution on suspend and never replays it after automatic wake", async () => {
		h.model.script({
			tool: "local_exec",
			args: {
				command: "printf 'once\\n' >> lifecycle-count.txt; sleep 30; printf 'late\\n' >> lifecycle-count.txt",
				description: "Lifecycle probe",
			},
		});
		await h.send("Run the lifecycle probe");
		await h.page().getByRole("group", { name: "Approval request" }).getByRole("button", { name: "Allow once", exact: true }).click();
		await expect.poll(async () => readFile(join(h.workspace, "lifecycle-count.txt"), "utf8").catch(() => "")).toBe("once\n");
		const before = h.model.requests.length;
		await native("suspend");
		await expect.poll(async () => (await api("lifecycle.get")).transitioning).toBe(false);
		await h.page().getByText("Task interrupted", { exact: true }).waitFor();
		await native("resume");
		await expect.poll(async () => (await api("lifecycle.get")).blocked).toBe(false);
		expect(h.model.requests).toHaveLength(before);
		await h.shot("03-interrupted");
		expect(await readFile(join(h.workspace, "lifecycle-count.txt"), "utf8")).toBe("once\n");
		h.model.script({ text: "Reviewed committed actions; no repeated command." });
		await h.page().getByRole("button", { name: "Continue task", exact: true }).click();
		await h.page().getByText("Reviewed committed actions; no repeated command.", { exact: true }).waitFor();
		expect(JSON.stringify(h.model.requests.at(-1)?.messages)).toContain("reconcile uncertain effects");
		expect(await readFile(join(h.workspace, "lifecycle-count.txt"), "utf8")).toBe("once\n");
	});
	it("withdraws pending approval before suspend and keeps queued work after wake", async () => {
		h.model.script({ tool: "local_exec", args: { command: "echo should-not-run", description: "Pending lifecycle approval" } });
		await h.send("Ask before running");
		await h.page().getByRole("group", { name: "Approval request" }).waitFor();
		await native("suspend");
		await expect.poll(async () => (await api("lifecycle.get")).transitioning).toBe(false);
		await h.page().getByRole("group", { name: "Approval request" }).waitFor({ state: "hidden" });
		await native("resume");
		await expect.poll(async () => (await api("lifecycle.get")).blocked).toBe(false);
		await api("lifecycle.pause");
		h.model.script({ text: "New queued request answered." });
		await h.send("New request after interruption");
		const before = h.model.requests.length;
		await api("settings.update", { language: "zh-CN" });
		await h.relaunch();
		await select("Lifecycle");
		await h.page().getByRole("button", { name: "恢复工作", exact: true }).waitFor();
		await h.shot("04-paused-zh");
		expect(h.model.requests).toHaveLength(before);
		await h.page().getByRole("button", { name: "恢复工作", exact: true }).click();
		await h.page().getByText("New queued request answered.", { exact: true }).waitFor();
		await api("settings.update", { language: "en" });
	});
	it("keeps idle restart ready, hides native authority from the renderer, and stays invisible", async () => {
		await expect
			.poll(async () => {
				const bot = (await api("bots.list")).find((b: any) => b.name === "Lifecycle");
				return (await api("conversations.snapshot", { botId: bot.botId })).run;
			})
			.toBeUndefined();
		await h.relaunch();
		await expect.poll(async () => (await api("lifecycle.get")).blocked).toBe(false);
		expect(await h.page().evaluate(() => typeof (window as any).openbot.methods["lifecycle.native"])).toBe("undefined");
		expect(
			await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((w) => !w.isVisible() && !w.isFocused())),
		).toBe(true);
		await h.shot("05-idle-restart");
	});
	it("stops a group chain without waking peers after Resume", async () => {
		const bot = (await api("bots.list")).find((b: any) => b.name === "Lifecycle");
		await api("groups.change", {
			requestId: "lifecycle-group",
			action: "create",
			groupId: "group_lifecycle",
			expectedRevision: 0,
			fields: {
				name: "Lifecycle group",
				objective: "Test interruption",
				memberIds: [bot.botId, (await api("bots.list")).find((b: any) => b.kind === "core").botId],
				leadBotId: bot.botId,
			},
		});
		h.model.script({ tool: "local_exec", args: { command: "echo group", description: "Group pause probe" } });
		await api("groups.send", { groupId: "group_lifecycle", requestId: "group-request", text: "Run the probe" });
		await expect
			.poll(async () =>
				(await api("groups.snapshot", { groupId: "group_lifecycle" })).tasks.some((d: any) => d.conversation?.approvals?.length),
			)
			.toBe(true);
		const before = h.model.requests.length;
		await api("lifecycle.pause");
		await api("lifecycle.resume");
		const group = await api("groups.snapshot", { groupId: "group_lifecycle" });
		expect(group.roots[0].state).toBe("cancelled");
		expect(group.roots[0].reason).toBe("Work interrupted by application lifecycle");
		expect(group.tasks.every((d: any) => !["pending", "running"].includes(d.state))).toBe(true);
		expect(h.model.requests).toHaveLength(before);
	});
	it("cancels a Core Code Mode approval without letting its remaining script mutate", async () => {
		await select("OpenBot");
		const core = (await api("bots.list")).find((b: any) => b.kind === "core").botId;
		h.model.script({
			tool: "codemode",
			args: { code: 'await tools.app_bots_create({name:"Must stay absent"});await tools.app_bots_create({name:"Also absent"});' },
		});
		await h.send("Run this synthetic Code Mode check");
		await h.page().locator(".approval").waitFor();
		const approval = (await api("conversations.snapshot", { botId: core })).approvals[0].approvalId,
			before = h.model.requests.length;
		await api("lifecycle.pause");
		const snapshot = await api("conversations.snapshot", { botId: core });
		expect(snapshot.run.state).toBe("needs_attention");
		expect(snapshot.approvals).toHaveLength(0);
		const parent = snapshot.items.findLast((item: any) => item.execution);
		expect(parent.execution.state).toBe("cancelled");
		await expect(api("approvals.decide", { approvalId: approval, decision: "allow_once" })).rejects.toThrow();
		await api("lifecycle.resume");
		expect((await api("bots.list")).some((b: any) => b.name.includes("absent"))).toBe(false);
		expect(h.model.requests).toHaveLength(before);
	});

	it("closing a window keeps its Host and task alive without activating a window", async () => {
		await select("Lifecycle");
		h.model.script({ text: "Completed after window close.", delayMs: 1000 });
		const before = h.model.requests.length;
		await h.send("Keep working with the window closed");
		await expect.poll(() => h.model.requests.length).toBe(before + 1);
		const pid = await readFile(join(h.dataDirectory, "host.lock"), "utf8");
		await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
		expect(await readFile(join(h.dataDirectory, "host.lock"), "utf8")).toBe(pid);
		await h.app().evaluate(({ app }) => app.emit("activate"));
		const page = h.page();
		await page.locator(".sidebar").waitFor();
		await page
			.locator(".bot-row")
			.filter({ has: page.getByText("Lifecycle", { exact: true }) })
			.click();
		await page.getByText("Completed after window close.", { exact: true }).waitFor();
		expect(
			await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((w) => !w.isVisible() && !w.isFocused())),
		).toBe(true);
	});
});
