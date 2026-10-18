import { access } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { type AppHarness, launchApp } from "./harness.ts";
let h: AppHarness;
let core: string;
const groupId = "group_team";
const api = (name: string, params = {}): Promise<any> =>
	h.page().evaluate(({ name, params }) => (window as any).openbot.methods[name](params), { name, params });
const snapshot = () => api("groups.snapshot", { groupId });
const until = (fn: () => Promise<any>) => expect.poll(fn, { timeout: 15000 });
const send = async (text: string) => {
	const box = h.page().getByRole("textbox", { name: /^(Message group|群消息)$/ });
	await box.fill(text);
	await box.press("Enter");
};
const open = async () => {
	await h.page().locator(".group-nav").filter({ hasText: "Research team" }).click();
	await h.page().getByRole("heading", { name: "Research team", exact: true }).waitFor();
};
beforeAll(async () => {
	h = await launchApp("collaboration", { env: { OPENBOT_MAX_ACTIVE_RUNS: "1" } });
	h.page().setDefaultTimeout(8000);
	await api("settings.update", { defaultModel: { provider: "scripted", modelId: "scripted" } });
	core = (await api("bots.list")).find((b: any) => b.kind === "core").botId;
	for (const name of ["Alpha", "Beta"]) await api("bots.create", { requestId: name.toLowerCase(), name });
	await api("groups.change", {
		requestId: "create",
		action: "create",
		groupId,
		expectedRevision: 0,
		fields: {
			name: "Research team",
			objective: "Research, review, and report",
			memberIds: ["bot_alpha", "bot_beta"],
			leadBotId: "bot_beta",
		},
	});
	await open();
});
afterEach(async ({ task }) => {
	if (task.result?.state === "fail") await h.shot("failure");
});
afterAll(async () => {
	await h?.close();
});
it("Core delegates, a member transfers ownership, and results return once with no management escalation", async () => {
	h.model.script(
		{ tool: "bot_delegate", args: { botId: "bot_alpha", task: "Research the answer", expectedResult: "Verified answer" } },
		{ text: "I assigned the research." },
		{ tool: "bot_handoff", args: { botId: "bot_beta", task: "Finish the research", expectedResult: "Verified answer" } },
		{ tool: "local_write", args: { path: join(h.workspace, "must-not-exist.txt"), content: "late side effect" } },
		{ text: "Beta owns the work now." },
		{ text: "Verified result: 42." },
		{ text: "The final answer is 42." },
	);
	await send("Find and verify the answer.");
	await until(async () => (await snapshot()).roots[0]?.state).toBe("completed");
	const result = await snapshot();
	expect(result.posts[0].recipientIds).toEqual([core]);
	expect(result.tasks).toHaveLength(4);
	expect(result.tasks.map((d: any) => d.origin)).toEqual(["user", "peer", "peer", "result"]);
	expect(result.posts.filter((p: any) => p.text === "The final answer is 42.")).toHaveLength(1);
	await expect(access(join(h.workspace, "must-not-exist.txt"))).rejects.toThrow();
	expect(h.model.requests).toHaveLength(7);
	expect(JSON.stringify(h.model.requests.map((r) => r.tools))).not.toContain('"name":"group_create"');
	expect(JSON.stringify(h.model.requests.at(-1)?.messages)).toContain("Verified result: 42.");
	await h.page().getByText("The final answer is 42.", { exact: true }).waitFor();
	await h.shot("01-collaboration-results");
	await h.relaunch();
	await open();
	expect((await snapshot()).posts).toEqual(result.posts);
	expect(h.model.requests).toHaveLength(7);
});
it("structured @ chooses a member, while cycles pause durably in Chinese", async () => {
	h.model.script({ text: "Only Beta replied." });
	const box = h.page().getByRole("textbox", { name: "Message group", exact: true });
	await box.fill("@Be");
	await h.page().getByRole("option", { name: "@Beta", exact: true }).click();
	await send("Review directly.");
	await until(async () => (await snapshot()).posts.at(-1)?.text).toBe("Only Beta replied.");
	expect((await snapshot()).posts.at(-2).recipientIds).toEqual(["bot_beta"]);
	await h.page().getByRole("button", { name: "Core · automatic", exact: true }).click();
	h.model.script(
		{ tool: "bot_delegate", args: { botId: "bot_alpha", task: "Review", expectedResult: "Review" } },
		{ text: "Assigned." },
		{ tool: "bot_handoff", args: { botId: core, task: "Please acknowledge", expectedResult: "Thanks" } },
	);
	await send("Start a bounded task.");
	await until(async () => (await snapshot()).roots.at(-1)?.state).toBe("paused");
	await api("settings.update", { language: "zh-CN" });
	await h.relaunch();
	await open();
	await h.page().getByText("需要你的指示", { exact: true }).waitFor();
	await h.page().getByText("已阻止向自身或上游负责人循环转派", { exact: true }).waitFor();
	await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(900, 700));
	await h.page().getByRole("group", { name: "协作任务" }).scrollIntoViewIfNeeded();
	await h.shot("02-chinese-paused-chain");
	const before = h.model.requests.length;
	await h.relaunch();
	await open();
	expect(h.model.requests.length).toBe(before);
	expect((await snapshot()).tasks.filter((d: any) => d.state === "pending")).toHaveLength(0);
});
it("stops the full tree and approval after restart while preserving an unrelated task", async () => {
	await api("settings.update", { language: "en" });
	await h.relaunch();
	await open();
	h.model.script(
		{ tool: "bot_delegate", args: { botId: "bot_alpha", task: "Run a command", expectedResult: "Command result" } },
		{ text: "Assigned command." },
		{ tool: "local_exec", args: { command: "echo should-not-run", description: "Await tree approval" } },
	);
	await send("Do the command task.");
	await h.page().getByRole("group", { name: "Approval request" }).waitFor();
	const taskRoot = (await snapshot()).roots.at(-1).rootId;
	await h.relaunch();
	await open();
	await h.page().getByRole("group", { name: "Approval request" }).waitFor();
	// A separate user request waits for the active Bot; stopping this tree must preserve it.
	await api("groups.send", { groupId, requestId: "r".repeat(256), text: "Unrelated work", recipientIds: ["bot_alpha"] });
	h.model.script({ text: "Unrelated work survived." });
	await h
		.page()
		.getByRole("group", { name: "Collaboration task" })
		.filter({ hasText: "Do the command task." })
		.getByRole("button", { name: "Stop task chain", exact: true })
		.click();
	await until(async () => (await snapshot()).roots.find((r: any) => r.rootId === taskRoot)?.state).toBe("cancelled");
	await until(async () => (await snapshot()).posts.some((p: any) => p.text === "Unrelated work survived.")).toBe(true);
	expect((await snapshot()).tasks.filter((d: any) => d.rootId === taskRoot).every((d: any) => !d.conversation?.approvals?.length)).toBe(
		true,
	);
	await api("collaboration.stop", { rootId: (await snapshot()).roots.at(-1).rootId });
	await h.shot("03-scoped-stop");
});

it("tree stop preserves another root's background command in the same Bot and group", async () => {
	await api("policy.update", { commandSetting: "allow" });
	let firstTask = "";
	let secondTask = "";
	const capture = (which: "first" | "second") => (request: any) => {
		const id = /as task (task_[0-9a-f]+)/.exec(JSON.stringify(request.messages.at(-1)))?.[1];
		if (!id) throw Error("Background task ID missing");
		if (which === "first") firstTask = id;
		else secondTask = id;
		return { taskId: id, wait_seconds: 0 };
	};
	h.model.script(
		{ tool: "local_exec", args: { command: "sleep 60", description: "Independent background work", background: true } },
		{ tool: "task_output", args: capture("first") },
		{ text: "Independent background task started." },
	);
	await api("groups.send", {
		groupId,
		requestId: "background-first",
		text: "Start unrelated background work",
		recipientIds: ["bot_alpha"],
	});
	await until(async () => (await snapshot()).posts.at(-1)?.text).toBe("Independent background task started.");
	await api("policy.update", { commandSetting: "ask" });
	h.model.script(
		{ tool: "local_exec", args: { command: "sleep 60", description: "Tree background work", background: true } },
		{ tool: "task_output", args: capture("second") },
		{ tool: "bot_delegate", args: { botId: "bot_beta", task: "Wait for command approval", expectedResult: "Approved result" } },
		{ text: "Tree background work assigned." },
		{ tool: "local_exec", args: { command: "echo tree-pending", description: "Tree pending approval" } },
	);
	await api("groups.send", {
		groupId,
		requestId: "background-second",
		text: "Start a task tree with background work",
		recipientIds: ["bot_alpha"],
	});
	await h.page().getByRole("group", { name: "Approval request" }).getByRole("button", { name: "Allow once", exact: true }).click();
	await until(async () => (await snapshot()).tasks.some((d: any) => d.botId === "bot_beta" && d.conversation?.approvals.length)).toBe(true);
	await h
		.page()
		.getByRole("group", { name: "Collaboration task" })
		.filter({ hasText: "Start a task tree with background work" })
		.getByRole("button", { name: "Stop task chain", exact: true })
		.click();
	await until(async () => (await snapshot()).roots.at(-1)?.state).toBe("cancelled");
	h.model.script(
		{ tool: "task_output", args: { taskId: firstTask, wait_seconds: 0 } },
		{ tool: "task_output", args: { taskId: secondTask, wait_seconds: 0 } },
		{ text: "Background status checked." },
	);
	const before = h.model.requests.length;
	await api("groups.send", {
		groupId,
		requestId: "background-inspect",
		text: "Inspect both command statuses",
		recipientIds: ["bot_alpha"],
	});
	await until(async () => (await snapshot()).posts.at(-1)?.text).toBe("Background status checked.");
	expect(JSON.stringify(h.model.requests[before + 1]?.messages.at(-1))).toContain(": running,");
	expect(JSON.stringify(h.model.requests[before + 2]?.messages.at(-1))).toContain("stopped");
	h.model.script({ tool: "task_stop", args: { taskId: firstTask } }, { text: "Background cleanup done." });
	await api("groups.send", {
		groupId,
		requestId: "background-cleanup",
		text: "Stop the remaining test command",
		recipientIds: ["bot_alpha"],
	});
	await until(async () => (await snapshot()).posts.at(-1)?.text).toBe("Background cleanup done.");
});
