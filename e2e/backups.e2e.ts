import { BotRuntime } from "../packages/agent-runtime/src/index.ts";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { mkdir, readdir, readFile, writeFile, rm, cp, rename } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { launchApp, createBot, type AppHarness, repo } from "./harness.ts";
let h: AppHarness,
	bot: any,
	core: string,
	skill: any,
	routine: any,
	artifact: any,
	archive: string,
	localMemory: unknown,
	sharedMemory: unknown;
const api = (name: string, params: unknown = {}): Promise<any> =>
	h.page().evaluate(({ name, params }) => (window as any).openbot.methods[name](params), { name, params });
const button = (name: string) => h.page().getByRole("button", { name, exact: true });
const poll = (fn: () => Promise<any>) => expect.poll(fn, { timeout: 30000 });
async function dialogs(path: string, cancel = false, confirm = true) {
	await h.app().evaluate(
		({ dialog }, { path, cancel, confirm }) => {
			dialog.showOpenDialog = (async () => ({ canceled: cancel, filePaths: [path] })) as any;
			dialog.showMessageBox = (async () => ({ response: confirm ? 1 : 0, checkboxChecked: false })) as any;
		},
		{ path, cancel, confirm },
	);
}
async function settings() {
	await h
		.page()
		.getByRole("button", { name: /^Settings/ })
		.click();
	await button("Create backup").scrollIntoViewIfNeeded();
}
beforeAll(async () => {
	h = await launchApp("backups");
	h.page().setDefaultTimeout(15000);
	await createBot(h, "Archive Researcher");
	bot = (await api("bots.list")).find((b: any) => b.name === "Archive Researcher");
	core = (await api("bots.list")).find((b: any) => b.kind === "core").botId;
	await api("bots.memory.update", { botId: bot.botId, expectedRevision: 0, content: "## Preference\nTea 茶" });
	await api("memory.shared.update", { expectedRevision: 0, content: "## Format\nCite original sources" });
	localMemory = await api("bots.memory.get", { botId: bot.botId });
	sharedMemory = await api("memory.shared.get");
	skill = await api("skills.save", {
		requestId: "backup-skill",
		name: "source-review",
		expectedRevision: 0,
		document: {
			name: "source-review",
			description: "Check sources",
			inputs: "Sources",
			requirements: "Public pages",
			steps: "Review dates and evidence",
			validation: "Preserve uncertainty",
			output: "Markdown",
			approvalBoundaries: "Existing policy applies",
		},
	});
	await api("bots.update", {
		botId: bot.botId,
		expectedRevision: bot.revision,
		defaultSkills: [{ name: skill.name, revision: skill.revision, sha256: skill.sha256 }],
	});
	await api("groups.change", {
		action: "create",
		requestId: "backup-group",
		groupId: "group_backup",
		expectedRevision: 0,
		fields: { name: "Archive room", objective: "Research together", memberIds: [core, bot.botId], leadBotId: core },
	});
	routine = await api("routines.change", {
		action: "create",
		requestId: "backup-routine",
		botId: bot.botId,
		fields: {
			name: "Weekly archive report",
			instructions: "Summarize sources",
			schedule: { kind: "interval", minutes: 10080 },
			catchUpHours: 1,
			skills: [],
			reportTo: { groupId: "group_backup", groupRevision: 1 },
		},
	});
	h.model.script(
		{ tool: "local_write", args: { path: "archive-report.md", content: "# Backup evidence\n\nExact saved artifact 茶" } },
		{ tool: "artifact_publish", args: { path: "archive-report.md" } },
		{ text: "ARCHIVE_REPORT_READY" },
	);
	await h.send("Create the report");
	await h.page().getByText("ARCHIVE_REPORT_READY", { exact: true }).waitFor();
	while ((await api("conversations.snapshot", { botId: bot.botId })).run) await new Promise((resolve) => setTimeout(resolve, 50));
	artifact = (await api("conversations.snapshot", { botId: bot.botId })).items.find(
		(i: any) => i.kind === "tool" && i.tool === "artifact_publish",
	).artifact;
	await mkdir(join(h.run, "backups"));
	await writeFile(join(h.dataDirectory, "credentials-backup-canary.json"), "LOCAL_SECRET_CANARY");
});
afterEach(async ({ task }) => {
	if (task.result?.state === "fail") await h.shot("failure");
});
afterAll(async () => {
	await h?.close();
});
it("cancels without pausing or creating files and refuses a live Host owner", async () => {
	await settings();
	const before = await api("lifecycle.get");
	await dialogs(join(h.run, "backups"), true);
	await button("Create backup").click();
	await poll(() => button("Create backup").isEnabled()).toBe(true);
	expect(await api("lifecycle.get")).toEqual(before);
	await dialogs(join(h.run, "backups"), false, false);
	await button("Create backup").click();
	await poll(() => button("Create backup").isEnabled()).toBe(true);
	expect(await readdir(join(h.run, "backups"))).toEqual([]);
	expect(await api("lifecycle.get")).toEqual(before);
	const child = spawnSync(process.execPath, [join(repo, "apps/local-server/src/maintenance.ts")], {
		env: { ...process.env, OPENBOT_DATA_DIR: h.dataDirectory },
		input: JSON.stringify({ action: "export", directory: join(h.run, "backups") }),
		encoding: "utf8",
	});
	expect(child.status).not.toBe(0);
	expect(child.stderr).toContain("Close the running Host");
});
it("exports through Settings, preserving paused state and excluding secrets, profiles and source files", async () => {
	await api("lifecycle.pause");
	await h.relaunch(async () => {
		const runtime = await BotRuntime.open({ databasePath: join(h.dataDirectory, "openbot.sqlite") });
		try {
			await runtime.routines().change((state) => {
				const r = state.routines[routine.routineId]!;
				state.routines[routine.routineId] = { ...r, anchor: Date.now() - 604800000, nextAt: Date.now() - 1000 };
			});
		} finally {
			await runtime.close();
		}
	});
	await settings();
	await dialogs(join(h.run, "backups"));
	await button("Create backup").click();
	await h.page().getByText("Backup saved. Work remains paused; resume when ready.", { exact: true }).waitFor({ timeout: 30000 });
	archive = join(h.run, "backups", (await readdir(join(h.run, "backups")))[0]!);
	const m = JSON.parse(await readFile(join(archive, "manifest.json"), "utf8"));
	const ledger = new DatabaseSync(join(archive, "data/executor/receipts.sqlite"), { readOnly: true });
	expect((ledger.prepare("select count(*) as n from receipts where status='succeeded'").get() as any).n).toBeGreaterThanOrEqual(2);
	ledger.close();
	expect(m.files.some((f: any) => f.path === "openbot.sqlite")).toBe(true);
	expect(m.files.some((f: any) => /credentials|models.json|logs|electron|artifacts\//.test(f.path))).toBe(false);
	expect((await api("lifecycle.get")).userPaused).toBe(true);
	await h.shot("01-backup-exported");
});
it("restores deleted fixture originals, exact report bytes, skills, group and routine identities without running a model", async () => {
	const count = h.model.requests.length;
	const config = await readFile(join(h.run, "home/models.json"), "utf8");
	await h.relaunch(async () => {
		for (const root of ["openbot.sqlite", "openbot.sqlite-wal", "openbot.sqlite-shm", "attachments", "skills", "executor"])
			await rm(join(h.dataDirectory, root), { recursive: true, force: true });
		await rm(join(h.workspace, "archive-report.md"));
	});
	expect((await api("bots.list")).some((b: any) => b.botId === bot.botId)).toBe(false);
	await settings();
	await dialogs(archive);
	await button("Restore backup").click();
	await h.page().getByText("Backup restored. Work remains paused; review before resuming.", { exact: true }).waitFor({ timeout: 30000 });
	expect((await api("bots.list")).find((b: any) => b.botId === bot.botId).defaultSkills).toEqual([
		{ name: skill.name, revision: skill.revision, sha256: skill.sha256 },
	]);
	expect(await api("bots.memory.get", { botId: bot.botId })).toEqual(localMemory);
	expect(await api("memory.shared.get")).toEqual(sharedMemory);
	expect(JSON.stringify(await api("groups.snapshot", { groupId: "group_backup" }))).toContain(bot.botId);
	expect((await api("routines.get", { routineId: routine.routineId })).routine.reportTo.groupId).toBe("group_backup");
	expect((await api("artifacts.read", { artifactId: artifact.artifactId })).text).toBe("# Backup evidence\n\nExact saved artifact 茶");
	expect(JSON.stringify(await api("skills.get", { name: skill.name, revision: skill.revision }))).toContain("Review dates and evidence");
	expect(JSON.stringify(await api("conversations.snapshot", { botId: bot.botId }))).toContain("ARCHIVE_REPORT_READY");
	expect((await api("lifecycle.get")).userPaused).toBe(true);
	expect(h.model.requests).toHaveLength(count);
	expect(await readFile(join(h.dataDirectory, "credentials-backup-canary.json"), "utf8")).toBe("LOCAL_SECRET_CANARY");
	expect(await readFile(join(h.run, "home/models.json"), "utf8")).toBe(config);
	await h.shot("02-restored-paused");
	await h.relaunch();
	expect((await api("lifecycle.get")).userPaused).toBe(true);
	expect(h.model.requests).toHaveLength(count);
});
it("rejects corrupted snapshots visibly and keeps restored data available", async () => {
	const broken = join(h.run, "broken.openbot-backup");
	await cp(archive, broken, { recursive: true });
	await writeFile(join(broken, "data/openbot.sqlite"), "damaged");
	await settings();
	await dialogs(broken);
	await button("Restore backup").click();
	await h.page().getByRole("alert").filter({ hasText: "manifest" }).waitFor({ timeout: 30000 });
	expect((await api("bots.list")).some((b: any) => b.botId === bot.botId)).toBe(true);
	expect((await api("artifacts.read", { artifactId: artifact.artifactId })).text).toContain("Exact saved artifact");
	await h.shot("03-invalid-keeps-data");
});
it("expires native selection after navigation and presents Chinese controls at minimum window size", async () => {
	await h.app().evaluate(({ dialog }) => {
		dialog.showOpenDialog = (() =>
			new Promise((resolve) => {
				(globalThis as any).__backupPicker = resolve;
			})) as any;
	});
	await button("Create backup").click();
	await poll(() => h.app().evaluate(() => typeof (globalThis as any).__backupPicker)).toBe("function");
	await h.page().reload();
	await h.app().evaluate((_e, path) => (globalThis as any).__backupPicker({ canceled: false, filePaths: [path] }), join(h.run, "backups"));
	await settings();
	await api("settings.update", { language: "zh-CN" });
	await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(880, 560));
	await button("创建备份").scrollIntoViewIfNeeded();
	expect(await button("恢复备份").isEnabled()).toBe(true);
	await h.shot("04-chinese-small");
	expect(await readdir(join(h.run, "backups"))).toHaveLength(1);
});

it("recovers a process-interrupted replacement before Host startup and fails closed on a damaged journal", async () => {
	const count = h.model.requests.length;
	const id = "11111111-1111-4111-8111-111111111111";
	await h.relaunch(async () => {
		const old = join(h.dataDirectory, `.restore-${id}`, "old");
		await mkdir(old, { recursive: true });
		await rename(join(h.dataDirectory, "openbot.sqlite"), join(old, "openbot.sqlite"));
		await writeFile(join(h.dataDirectory, "openbot.sqlite"), "interrupted replacement");
		await writeFile(
			join(h.dataDirectory, ".restore-journal.json"),
			JSON.stringify({ version: 1, id, committed: false, original: ["openbot.sqlite", "executor", "attachments", "skills"] }),
		);
	});
	expect(await api("bots.memory.get", { botId: bot.botId })).toEqual(localMemory);
	expect((await api("lifecycle.get")).userPaused).toBe(true);
	expect(h.model.requests).toHaveLength(count);
	expect((await readdir(h.dataDirectory)).includes(".restore-journal.json")).toBe(false);
	await h.relaunch(async () => {
		await writeFile(join(h.dataDirectory, ".restore-journal.json"), "invalid journal");
	});
	await h.page().locator(".banner-stopped").filter({ hasText: "Restore recovery failed" }).waitFor({ timeout: 30000 });
	expect(await h.page().evaluate(() => (window as any).openbot.hostState())).toMatchObject({ status: "stopped" });
	expect((await readdir(h.dataDirectory)).includes("host.lock")).toBe(false);
	expect(h.model.requests).toHaveLength(count);
	await h.shot("05-recovery-blocked");
	await h.relaunch(async () => {
		await rm(join(h.dataDirectory, ".restore-journal.json"));
	});
	expect(await api("bots.memory.get", { botId: bot.botId })).toEqual(localMemory);
});
it("interrupts a real approved command for backup and retains its settled receipt without replay", async () => {
	await api("settings.update", { language: "en" });
	const stored = (await api("routines.get", { routineId: routine.routineId })).routine;
	await api("routines.change", {
		action: "pause",
		requestId: "pause-before-command",
		routineId: routine.routineId,
		expectedRevision: stored.revision,
	});
	await api("lifecycle.resume");
	h.model.script({
		tool: "local_exec",
		args: {
			command: "printf 'once\\n' >> backup-command.txt; sleep 30; printf 'late\\n' >> backup-command.txt",
			description: "Backup interruption fixture",
		},
	});
	await api("messages.submit", { botId: bot.botId, requestId: "backup-command", text: "Run the interruption fixture" });
	await poll(async () => (await api("conversations.snapshot", { botId: bot.botId })).approvals.length).toBe(1);
	const approval = (await api("conversations.snapshot", { botId: bot.botId })).approvals[0];
	await api("approvals.decide", { approvalId: approval.approvalId, decision: "allow_once" });
	await poll(() => readFile(join(h.workspace, "backup-command.txt"), "utf8").catch(() => "")).toBe("once\n");
	const count = h.model.requests.length;
	const folder = join(h.run, "active-backups");
	await mkdir(folder);
	await settings();
	await dialogs(folder);
	await button("Create backup").click();
	await h.page().getByText("Backup saved. Work remains paused; resume when ready.", { exact: true }).waitFor({ timeout: 30000 });
	const saved = join(folder, (await readdir(folder))[0]!);
	const db = new DatabaseSync(join(saved, "data/executor/receipts.sqlite"), { readOnly: true });
	try {
		expect(db.prepare("select status from receipts where tool='local_exec'").get()).toMatchObject({ status: "cancelled" });
	} finally {
		db.close();
	}
	expect((await api("lifecycle.get")).userPaused).toBe(true);
	await h.relaunch();
	expect(await readFile(join(h.workspace, "backup-command.txt"), "utf8")).toBe("once\n");
	expect(h.model.requests).toHaveLength(count);
});
