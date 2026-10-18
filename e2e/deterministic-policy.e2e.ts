import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { type AppHarness, createBot, launchApp } from "./harness.ts";
let h: AppHarness;
const api = (name: string, params: object = {}): Promise<any> =>
	h.page().evaluate(({ name, params }) => (window as any).openbot.methods[name](params), { name, params });
const select = async (name: string) => {
	await h
		.page()
		.locator(".bot-row")
		.filter({ has: h.page().getByText(name, { exact: true }) })
		.click();
};
const card = () => h.page().getByRole("group", { name: "Approval request", exact: true });
beforeAll(async () => {
	h = await launchApp("deterministic-policy");
	h.page().setDefaultTimeout(10000);
	await createBot(h, "Warden");
}, 60000);
afterAll(async () => {
	await h?.close();
});
describe("Deterministic policy", () => {
	it("Ask first overrides an allow and supports English and Chinese settings with preserved invalid drafts", async () => {
		await api("policy.update", { commandSetting: "allow" });
		await h
			.page()
			.getByRole("button", { name: /^Settings/ })
			.click();
		await h.page().getByLabel("Rule program", { exact: true }).fill("printf $");
		await h.page().getByRole("button", { name: "Add Ask first rule", exact: true }).click();
		await expect.poll(() => h.page().getByLabel("Rule program", { exact: true }).inputValue()).toBe("printf $");
		await h.page().getByLabel("Rule program", { exact: true }).fill("printf");
		await h.page().getByRole("button", { name: "Add Ask first rule", exact: true }).click();
		await expect.poll(async () => (await api("policy.get")).askFirst.length).toBe(1);
		await h.page().getByRole("heading", { name: "Ask first", exact: true }).scrollIntoViewIfNeeded();
		await h.shot("01-ask-first-settings");
		await select("Warden");
		h.model.script(
			{ tool: "local_exec", args: { command: "printf once >> ask-first.txt", description: "Ask first probe" } },
			{ text: "Confirmed once." },
		);
		await h.send("Run the Ask first probe");
		await card().waitFor();
		expect(await card().getByRole("button", { name: "Always allow", exact: true }).count()).toBe(0);
		await h.shot("02-exact-approval");
		await card().getByRole("button", { name: "Allow once", exact: true }).click();
		await h.page().getByText("Confirmed once.", { exact: true }).waitFor();
		expect(await readFile(join(h.workspace, "ask-first.txt"), "utf8")).toBe("once");
		await api("settings.update", { language: "zh-CN" });
		await h.relaunch();
		await h.page().getByRole("button", { name: /^设置/ }).click();
		await h.page().getByRole("heading", { name: "始终询问", exact: true }).waitFor();
		await h.page().getByRole("heading", { name: "始终询问", exact: true }).scrollIntoViewIfNeeded();
		await h.shot("03-ask-first-zh");
		await h.page().getByRole("button", { name: "删除 local_exec 的始终询问规则", exact: true }).click();
		await expect.poll(async () => (await api("policy.get")).askFirst.length).toBe(0);
		await api("settings.update", { language: "en" });
		await h.relaunch();
		await select("Warden");
	});
	it("a narrow revocation interrupts affected execution while an unrelated command continues", async () => {
		const other = await api("bots.create", { requestId: "unrelated", name: "Unrelated" });
		h.model.script({
			tool: "local_exec",
			args: { command: "printf 'once\\n' >> revoked.txt; sleep 30; printf late >> revoked.txt", description: "Revocation probe" },
		});
		await h.send("Run revocation probe");
		await expect.poll(() => readFile(join(h.workspace, "revoked.txt"), "utf8").catch(() => "")).toBe("once\n");
		h.model.script(
			{
				tool: "local_exec",
				args: { command: "printf start >> unrelated.txt; sleep 2; printf done >> unrelated.txt", description: "Independent probe" },
			},
			{ text: "Independent work completed." },
		);
		await api("messages.submit", { botId: other.botId, requestId: "independent", text: "Run independent probe" });
		await expect.poll(() => readFile(join(h.workspace, "unrelated.txt"), "utf8").catch(() => "")).toBe("start");
		const policy = await api("policy.get"),
			bot = (await api("bots.list")).find((b: any) => b.name === "Warden");
		await api("policy.ask.create", {
			requestId: "stop-warden",
			expectedRevision: policy.revision,
			botId: bot.botId,
			predicate: { tool: "local_exec", program: "sleep" },
		});
		await h.page().getByText("Permission revoked", { exact: true }).waitFor();
		await h.shot("04-scoped-interruption");
		expect(await readFile(join(h.workspace, "revoked.txt"), "utf8")).toBe("once\n");
		await expect.poll(() => readFile(join(h.workspace, "unrelated.txt"), "utf8"), { timeout: 10000 }).toBe("startdone");
		expect((await api("lifecycle.get")).blocked).toBe(false);
		await h.crashHost();
		await select("Warden");
		expect(await readFile(join(h.workspace, "revoked.txt"), "utf8")).toBe("once\n");
		expect((await api("policy.get")).reconciliation.state).toBe("complete");
	});
	it("revoking a folder grant terminates a previously backgrounded command", async () => {
		const folder = join(h.run, "granted");
		await mkdir(folder, { recursive: true });
		await h.app().evaluate(({ dialog }, path) => {
			dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
		}, folder);
		const selected = await h.page().evaluate(() => (window as any).openbot.pickFolder());
		const grants = await api("grants.add", { selection: selected!.selection, access: "readwrite" });
		await api("policy.update", { commandSetting: "allow" });
		await select("Unrelated");
		let taskId = "";
		h.model.script(
			{
				tool: "local_exec",
				args: {
					command: "printf once >> folder-effect.txt; sleep 30; printf late >> folder-effect.txt",
					cwd: folder,
					background: true,
					description: "Folder dependency",
				},
			},
			{
				tool: "task_output",
				args: (request: any) => {
					taskId = /as task (task_[0-9a-f]+)/.exec(JSON.stringify(request.messages.at(-1)))![1]!;
					return { taskId, wait_seconds: 0 };
				},
			},
			{ text: "Background folder work started." },
		);
		await h.send("Start folder-dependent background work");
		await h.page().getByText("Background folder work started.", { exact: true }).waitFor();
		expect(await readFile(join(folder, "folder-effect.txt"), "utf8")).toBe("once");
		await api("grants.revoke", { id: grants.find((g: any) => g.path === folder).id });
		expect((await api("policy.get")).reconciliation.state).toBe("complete");
		const before = h.model.requests.length;
		h.model.script({ tool: "task_output", args: { taskId, wait_seconds: 0 } }, { text: "Folder command stopped." });
		await h.send("Inspect the stopped command");
		await h.page().getByText("Folder command stopped.", { exact: true }).waitFor();
		expect(JSON.stringify(h.model.requests[before + 1]?.messages.at(-1))).toContain("stopped");
		expect(await readFile(join(folder, "folder-effect.txt"), "utf8")).toBe("once");
		await h.shot("05-folder-revoked");
	});

	it("shows unattended deadlines without extending them on Host replay and disables expired UI", async () => {
		await api("policy.update", { commandSetting: "ask", readOnlyDefault: false });
		const core = (await api("bots.list")).find((b: any) => b.kind === "core");
		await api("groups.change", {
			requestId: "expiry-group",
			action: "create",
			groupId: "group_expiry",
			expectedRevision: 0,
			fields: { name: "Expiry team", objective: "Approval deadlines", memberIds: [core.botId, "bot_unrelated"], leadBotId: core.botId },
		});
		h.model.script(
			{ tool: "bot_delegate", args: { botId: "bot_unrelated", task: "Run an approval probe", expectedResult: "Result" } },
			{ text: "Assigned." },
			{ tool: "local_exec", args: { command: "printf forbidden >> expiry.txt", description: "Unattended probe" } },
		);
		await api("groups.send", { groupId: "group_expiry", requestId: "expiry", text: "Delegate the probe" });
		const pending = async () => {
			const s = await api("groups.snapshot", { groupId: "group_expiry" });
			return s.tasks.flatMap((task: any) => task.conversation?.approvals ?? [])[0];
		};
		await expect.poll(pending).toBeTruthy();
		const first = await pending();
		expect(first.binding.origin).toBe("unattended");
		expect(first.deadline - first.createdAt).toBe(600000);
		await h.crashHost();
		await expect.poll(async () => (await pending())?.deadline).toBe(first.deadline);
		await h.page().locator(".group-nav").filter({ hasText: "Expiry team" }).click();
		await h
			.page()
			.getByText(/Unattended approval expires in/)
			.waitFor();
		await h.shot("05-unattended-deadline");
		// Renderer time only: Host expiry persistence is covered by fake-clock/store tests, without a production clock override.
		await h.page().clock.install({ time: new Date(first.deadline - 1000) });
		await h.page().clock.fastForward(2000);
		await h.page().getByText("Approval expired", { exact: true }).waitFor();
		expect(await card().getByRole("button", { name: "Allow once", exact: true }).isDisabled()).toBe(true);
		await h.shot("06-expired-controls");
		expect(await readFile(join(h.workspace, "expiry.txt"), "utf8").catch(() => "absent")).toBe("absent");
	});
});
