import { beforeAll, afterAll, afterEach, it, expect } from "vitest";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { launchApp, createBot, type AppHarness } from "./harness.ts";
import type { BotSummary, SkillDocument, BotTemplateV1 } from "../packages/protocol/src/index.ts";
let h: AppHarness, sourceId: string, path: string, template: BotTemplateV1;
const api = (name: string, params: unknown = {}): Promise<any> =>
	h.page().evaluate(({ name, params }) => (window as any).openbot.methods[name](params), { name, params });
const poll = expect.poll;
const instructions = "TEMPLATE_PROMPT_SENTINEL\n\n" + "Review original sources and preserve uncertainty. ".repeat(40);
const dialog = () => h.page().getByRole("dialog", { name: "Import template", exact: true });
const skill: SkillDocument = {
	name: "template-report",
	description: "Template procedure",
	inputs: "Local facts",
	requirements: "None",
	steps: "TEMPLATE_METHOD_SENTINEL",
	validation: "Check facts",
	output: "A short report",
	approvalBoundaries: "Existing permissions always apply",
};
async function pick(file: string, cancel = false) {
	await h.app().evaluate(
		({ dialog }, { file, cancel }) => {
			dialog.showOpenDialog = async () => ({ canceled: cancel, filePaths: [file] });
		},
		{ file, cancel },
	);
}
async function importFile(file = path) {
	await pick(file);
	await h.page().getByRole("button", { name: "New", exact: true }).click();
	await h.page().getByRole("button", { name: "Import template", exact: true }).click();
	await dialog().getByLabel("Template Bot name").waitFor();
}
async function exportSource(destination: string) {
	await h
		.page()
		.getByRole("button", { name: /Template Source/ })
		.first()
		.click();
	await h.page().getByRole("button", { name: "•••" }).click();
	await h.page().getByRole("menuitem", { name: "Export template" }).click();
	await h.page().getByRole("button", { name: "Save template", exact: true }).waitFor();
	await h.app().evaluate(({ dialog }, path) => {
		dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
	}, destination);
}
beforeAll(async () => {
	h = await launchApp("bot-templates");
	h.page().setDefaultTimeout(10000);
	await createBot(h, "Template Source");
	sourceId = (await api("bots.list")).find((b: BotSummary) => b.name === "Template Source").botId;
	const saved = await api("skills.save", {
		requestId: "template-method",
		name: skill.name,
		expectedRevision: 0,
		document: skill,
	});
	const source = (await api("bots.list")).find((b: BotSummary) => b.botId === sourceId);
	await api("bots.update", {
		botId: sourceId,
		expectedRevision: source.revision,
		instructions,
		defaultSkills: [{ name: saved.name, revision: saved.revision, sha256: saved.sha256 }],
	});
	path = join(h.run, "export.openbot.json");
}, 90000);
afterEach(async ({ task }) => {
	if (task.result?.state === "fail") await h.shot("failure");
});
afterAll(async () => {
	await h?.close();
});
it("exports the reviewed snapshot and imports exact defaults with empty history before any model call", async () => {
	const calls = h.model.requests.length;
	await exportSource(path);
	await h.shot("01-export-preview");
	const source = (await api("bots.list")).find((b: BotSummary) => b.botId === sourceId);
	await api("bots.update", {
		botId: sourceId,
		expectedRevision: source.revision,
		instructions: "Changed after review",
	});
	await h.page().getByRole("button", { name: "Save template", exact: true }).click();
	await h.page().getByText("Template saved", { exact: true }).waitFor();
	template = JSON.parse(await readFile(path, "utf8"));
	expect(template.profile.instructions).toBe(instructions);
	expect(JSON.stringify(template)).not.toContain(sourceId);
	await h.page().keyboard.press("Escape");
	await expect.poll(() => h.page().getByRole("dialog", { name: "Export template", exact: true }).count()).toBe(0);
	expect(
		await h
			.page()
			.getByRole("button", { name: "•••" })
			.evaluate((el) => el === document.activeElement),
	).toBe(true);
	await importFile();
	await dialog().getByLabel("Template Bot name").fill("Imported Researcher");
	await h.shot("02-import-resolved");
	await dialog().getByRole("button", { name: "Import Bot", exact: true }).click();
	await h.page().getByRole("button", { name: "Save profile", exact: true }).waitFor();
	const imported = (await api("bots.list")).find((b: BotSummary) => b.name === "Imported Researcher");
	expect(imported.kind).toBe("specialist");
	expect(imported.defaultSkills).toEqual(template.profile.defaultSkills);
	expect((await api("bots.memory.get", { botId: imported.botId })).content).toBe("");
	expect((await api("conversations.snapshot", { botId: imported.botId })).items).toEqual([]);
	expect(h.model.requests.length).toBe(calls);
	await h.page().getByRole("button", { name: "Cancel", exact: true }).click();
	h.model.script({ text: "Template method applied." });
	await h.send("Use the imported method.");
	await h.page().getByText("Template method applied.", { exact: true }).waitFor();
	expect(JSON.stringify(h.model.requests.at(-1))).toContain("TEMPLATE_METHOD_SENTINEL");
	expect(JSON.stringify(h.model.requests.at(-1))).toContain("TEMPLATE_PROMPT_SENTINEL");
	await h.shot("03-imported-chat");
});
it("requires missing dependencies to be resolved explicitly and previews the local skill revision", async () => {
	const missing = structuredClone(template);
	missing.profile.model = { provider: "unconfigured", modelId: "missing" };
	missing.profile.defaultSkills = [{ ...missing.profile.defaultSkills[0]!, sha256: "a".repeat(64) }];
	const file = join(h.run, "missing.json");
	await writeFile(file, JSON.stringify(missing));
	await importFile(file);
	await expect.poll(() => dialog().getByLabel("Model choice", { exact: true }).locator("option").count()).toBe(3);
	expect(await dialog().getByRole("button", { name: "Import Bot", exact: true }).isDisabled()).toBe(true);
	await h.shot("04-missing-dependencies");
	await dialog().getByLabel("Model choice", { exact: true }).selectOption("default");
	await dialog().getByLabel(`Skill choice ${skill.name}`, { exact: true }).selectOption("local");
	await dialog().getByRole("region", { name: "Role skill preview" }).waitFor();
	await dialog().getByRole("button", { name: "Use this revision" }).click();
	await dialog().getByLabel("Template Bot name").fill("Resolved Copy");
	await dialog().getByRole("button", { name: "Import Bot", exact: true }).click();
	await h.page().getByRole("button", { name: "Save profile", exact: true }).waitFor();
	expect((await api("bots.list")).find((b: BotSummary) => b.name === "Resolved Copy").defaultSkills).toEqual(
		template.profile.defaultSkills,
	);
	await h.page().getByRole("button", { name: "Cancel", exact: true }).click();
});
it("recovers a lost import response after renderer reload and restart without a second Bot", async () => {
	await h.app().evaluate(({ ipcMain }) => {
		const original = (ipcMain as any)._invokeHandlers.get("openbot:call");
		(globalThis as any).__templateOriginal = original;
		(globalThis as any).__templateStatusReads = 0;
		let lost = false;
		ipcMain.removeHandler("openbot:call");
		ipcMain.handle("openbot:call", async (event, method, params) => {
			if (method === "bots.templates.status") {
				(globalThis as any).__templateStatusReads++;
				return null;
			}
			const result = await original(event, method, params);
			if (method === "bots.templates.import" && !lost) {
				lost = true;
				throw Error("[host_unavailable] Lost import response");
			}
			return result;
		});
	});
	await importFile();
	await dialog().getByLabel("Template Bot name").fill("Recovered Copy");
	await h.page().clock.install();
	try {
		await dialog().getByRole("button", { name: "Import Bot", exact: true }).click();
		await h.page().clock.pauseAt(new Date());
		// Exercise every recovery query without racing nine real seconds against a ten-second UI timeout.
		await poll(async () => {
			await h.page().clock.fastForward(1000);
			return dialog().getByText("Import result is unconfirmed. Check again or retry the same reviewed import.", { exact: true }).isVisible();
		}, { timeout: 10000, interval: 20 }).toBe(true);
		expect(await h.app().evaluate(() => (globalThis as any).__templateStatusReads)).toBe(10);
	} finally {
		await h.page().clock.resume();
		await h.app().evaluate(({ ipcMain }) => {
			ipcMain.removeHandler("openbot:call");
			ipcMain.handle("openbot:call", (globalThis as any).__templateOriginal);
		});
	}
	await h.shot("05-unconfirmed");
	const id = await h.page().evaluate(() => localStorage.getItem("openbot.pending-template-import.v1"));
	expect(id).toBeTruthy();
	await h.relaunch();
	await importFile();
	await dialog().getByRole("button", { name: "Check again", exact: true }).click();
	await h.page().getByRole("button", { name: "Save profile", exact: true }).waitFor();
	expect((await api("bots.list")).filter((b: BotSummary) => b.name === "Recovered Copy")).toHaveLength(1);
	expect(await h.page().evaluate(() => localStorage.getItem("openbot.pending-template-import.v1"))).toBeNull();
	await h.page().getByRole("button", { name: "Cancel", exact: true }).click();
});
it("round trips PNG artwork, preserves create-only saves and rejects renderer paths", async () => {
	const image = await h.page().evaluate(() => {
		const canvas = document.createElement("canvas");
		canvas.width = canvas.height = 256;
		return canvas.toDataURL("image/png").split(",")[1]!;
	});
	const source = (await api("bots.list")).find((b: BotSummary) => b.botId === sourceId);
	await api("bots.update", {
		botId: sourceId,
		expectedRevision: source.revision,
		avatar: { kind: "upload", base64: image },
	});
	const pngPath = join(h.run, "png.json");
	await exportSource(pngPath);
	await h.page().getByRole("button", { name: "Save template", exact: true }).click();
	await h.page().getByText("Template saved", { exact: true }).waitFor();
	const before = await readFile(pngPath, "utf8");
	await h.page().getByRole("button", { name: "Save template", exact: true }).click();
	await h.page().getByRole("alert").filter({ hasText: "already exists" }).waitFor();
	expect(await readFile(pngPath, "utf8")).toBe(before);
	await h.page().getByRole("button", { name: "Cancel", exact: true }).click();
	await importFile(pngPath);
	await dialog().getByLabel("Template Bot name").fill("Image Copy");
	await h.shot("06-png-preview");
	await dialog().getByRole("button", { name: "Import Bot", exact: true }).click();
	await h.page().getByRole("button", { name: "Save profile", exact: true }).waitFor();
	const imported = (await api("bots.list")).find((b: BotSummary) => b.name === "Image Copy");
	expect(await api("bots.avatar.get", { botId: imported.botId })).toEqual(
		await api("bots.avatar.get", { botId: sourceId }),
	);
	await expect(api("templates.file.read", { path: pngPath })).rejects.toThrow();
	await h.page().getByRole("button", { name: "Cancel", exact: true }).click();
});
it("preserves the reviewed document when a dependency disappears and requires an explicit correction", async () => {
	const saved = await api("skills.save", {
		requestId: "volatile-method",
		name: "volatile-method",
		expectedRevision: 0,
		document: { ...skill, name: "volatile-method" },
	});
	const changing = structuredClone(template);
	changing.profile.defaultSkills = [{ name: saved.name, revision: saved.revision, sha256: saved.sha256 }];
	const file = join(h.run, "changing.json");
	await writeFile(file, JSON.stringify(changing));
	await importFile(file);
	await dialog().getByLabel("Template Bot name").fill("Corrected Copy");
	await api("skills.delete", { requestId: "remove-volatile", name: saved.name, expectedRevision: saved.revision });
	await dialog().getByRole("button", { name: "Import Bot", exact: true }).click();
	await dialog().getByRole("alert").waitFor();
	expect(await dialog().getByLabel("Template Bot name").inputValue()).toBe("Corrected Copy");
	expect(await dialog().getByRole("button", { name: "Import Bot", exact: true }).isDisabled()).toBe(true);
	expect((await api("bots.list")).some((b: BotSummary) => b.name === "Corrected Copy")).toBe(false);
	await h.shot("08-dependency-changed");
	await dialog().getByLabel("Skill choice volatile-method").selectOption("omit");
	await dialog().getByRole("button", { name: "Import Bot", exact: true }).click();
	await h.page().getByRole("button", { name: "Save profile", exact: true }).waitFor();
	expect((await api("bots.list")).find((b: BotSummary) => b.name === "Corrected Copy").defaultSkills).toEqual([]);
	await h.page().getByRole("button", { name: "Cancel", exact: true }).click();
});
it("rejects guest-frame and extra-key IPC and expires a native picker across Host replacement", async () => {
	const results = await h.app().evaluate(async ({ ipcMain, BrowserWindow }) => {
		const sender = BrowserWindow.getAllWindows()[0]!.webContents,
			handlers = (ipcMain as any)._invokeHandlers;
		const pick = handlers.get("openbot:template-pick"),
			save = handlers.get("openbot:template-save");
		const caught = async (fn: () => Promise<unknown>) => {
			try {
				await fn();
				return "accepted";
			} catch (error) {
				return (error as Error).message;
			}
		};
		return [
			await caught(() => pick({ sender, senderFrame: { url: sender.mainFrame.url } })),
			await caught(() => pick({ sender, senderFrame: sender.mainFrame }, { path: "/forged" })),
			await caught(() => save({ sender, senderFrame: sender.mainFrame }, { path: "/forged" })),
		];
	});
	expect(results).toEqual([
		expect.stringContaining("untrusted frame"),
		expect.stringContaining("Invalid template selection"),
		expect.stringContaining("Invalid Bot template"),
	]);
	await h.app().evaluate(({ dialog }) => {
		dialog.showOpenDialog = () =>
			new Promise((resolve) => {
				(globalThis as any).__hostPicker = resolve;
			});
	});
	const request = h
		.page()
		.evaluate(() => (window as any).openbot.pickBotTemplate().catch((error: Error) => error.message));
	await poll(() => h.app().evaluate(() => typeof (globalThis as any).__hostPicker)).toBe("function");
	await h.crashHost();
	await h.app().evaluate((_e, file) => (globalThis as any).__hostPicker({ canceled: false, filePaths: [file] }), path);
	expect(await request).toContain("The file selection expired");
});
it("cancels without mutation, expires navigation selections, and renders narrow Chinese dark review", async () => {
	const before = (await api("bots.list")).length;
	await pick(path, true);
	await h.page().getByRole("button", { name: "New", exact: true }).click();
	await h.page().getByRole("button", { name: "Import template", exact: true }).click();
	await poll(() => dialog().count()).toBe(0);
	expect((await api("bots.list")).length).toBe(before);
	await h.app().evaluate(({ dialog }) => {
		dialog.showOpenDialog = () =>
			new Promise((resolve) => {
				(globalThis as any).__templatePick = resolve;
			});
	});
	const request = h
		.page()
		.evaluate(() => (window as any).openbot.pickBotTemplate().catch(() => null))
		.catch(() => null);
	await poll(() => h.app().evaluate(() => typeof (globalThis as any).__templatePick)).toBe("function");
	await h.page().reload();
	await h
		.app()
		.evaluate((_e, path) => (globalThis as any).__templatePick({ canceled: false, filePaths: [path] }), path);
	await request;
	expect((await api("bots.list")).length).toBe(before);
	await api("settings.update", { language: "zh-CN" });
	await h.page().evaluate(() => {
		localStorage.setItem("openbot.theme", "dark");
		document.documentElement.dataset.theme = "dark";
	});
	await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(880, 560));
	await pick(path);
	await h.page().getByRole("button", { name: "新建", exact: true }).click();
	await h.page().getByRole("button", { name: "导入模板", exact: true }).click();
	const chinese = h.page().getByRole("dialog", { name: "导入模板", exact: true });
	await chinese.getByLabel("模板 Bot 名称").waitFor();
	expect(await chinese.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
	expect(
		await chinese.evaluate((el) => {
			const r = el.getBoundingClientRect();
			return r.top >= 0 && r.bottom <= innerHeight;
		}),
	).toBe(true);
	await h.shot("07-chinese-small");
	await chinese.getByRole("button", { name: "取消", exact: true }).click();
	expect(
		await h
			.page()
			.getByRole("button", { name: "新建", exact: true })
			.evaluate((el) => el === document.activeElement),
	).toBe(true);
	expect((await api("bots.list")).length).toBe(before);
});
