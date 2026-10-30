import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { launchApp, type AppHarness } from "./harness.ts";
import type { BotSummary } from "../packages/protocol/src/index.ts";
let h: AppHarness, core: string, specialist: string;
const poll = (fn: () => Promise<any>) => expect.poll(fn, { timeout: 15000 });
const profile = (botId = core): Promise<BotSummary> =>
	h.api("bots.list").then((bots) => bots.find((b: BotSummary) => b.botId === botId));
const edit = async () => {
	await h.page().getByRole("button", { name: "Conversation details", exact: true }).click();
	await h.page().getByRole("dialog", { name: "Conversation details" }).waitFor();
};
const cancel = () => h.page().getByRole("button", { name: "Close details", exact: true }).click();
async function pick(path: string) {
	await h.app().evaluate(({ dialog }, path) => {
		dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as any;
	}, path);
	await h.page().getByRole("button", { name: "Upload image", exact: true }).click();
}
beforeAll(async () => {
	h = await launchApp("personal-design");
	h.page().setDefaultTimeout(10000);
	await h.api("settings.update", { defaultModel: { provider: "scripted", modelId: "scripted" } });
	core = (await h.api("bots.list"))[0].botId;
	specialist = (await h.api("bots.create", { requestId: "atlas", name: "Atlas", role: "Research & reports" })).botId;
	await h.api("bots.create", { requestId: "scribe", name: "Scribe", role: "Writing & editing" });
	await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 920));
	await h.page().emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
});
afterEach(async ({ task }) => {
	if (task.result?.state === "fail") await h.shot(`failure-${task.name.slice(0, 30).replaceAll(" ", "-")}`);
});
afterAll(async () => {
	await h?.close();
});

it("customizes Core with a stable avatar, keeps tab drafts, cancels changes and protects its identity", async () => {
	const page = h.page(),
		original = await profile();
	await page.getByRole("textbox", { name: "Message OpenBot", exact: true }).fill("A thought for later.");
	await edit();
	await page.getByLabel("Name", { exact: true }).fill("Nova");
	await page.getByLabel("Label", { exact: true }).fill("Everyday thinking partner");
	await page.getByRole("button", { name: "Generate options", exact: true }).click();
	const options = page.locator(".avatar-choice");
	expect(await options.count()).toBe(6);
	expect(new Set(await options.evaluateAll((nodes) => nodes.map((n) => n.innerHTML))).size).toBe(6);
	await options.nth(2).click();
	const selected = await page.locator(".avatar-stage").innerHTML();
	await page.getByRole("tab", { name: "Memory", exact: true }).click();
	await page.getByRole("tab", { name: "Profile", exact: true }).click();
	expect(await page.getByLabel("Name", { exact: true }).inputValue()).toBe("Nova");
	expect(await page.locator(".avatar-stage").innerHTML()).toBe(selected);
	await h.shot("01-profile-picker");
	await cancel();
	expect((await profile()).name).toBe("OpenBot");
	expect((await profile()).avatar).toEqual(original.avatar);
	await edit();
	await page.getByLabel("Name", { exact: true }).fill("Nova");
	await page.getByRole("button", { name: "Generate options", exact: true }).click();
	await options.nth(2).click();
	await page.getByRole("button", { name: "Save profile", exact: true }).click();
	await page.getByRole("textbox", { name: "Message Nova", exact: true }).waitFor();
	expect(await page.locator(".compose-area textarea").inputValue()).toBe("A thought for later.");
	expect(await page.locator(".conversation-name .personal-star").count()).toBe(1);
	expect(await page.locator(".sidebar .personal-star").count()).toBe(1);
	expect(await page.locator(".sidebar .core-badge").count()).toBe(0);
	expect(
		await page
			.locator(".bot-row")
			.evaluateAll((rows) => new Set(rows.map((row) => row.getBoundingClientRect().height)).size),
	).toBe(1);
	const saved = (await profile()).avatar;
	await edit();
	await page.getByLabel("Label", { exact: true }).fill("Research");
	await page.getByRole("button", { name: "Save profile", exact: true }).click();
	expect((await profile()).avatar).toEqual(saved);
	await expect(h.api("bots.delete", { botId: core })).rejects.toThrow("cannot be deleted");
	await expect(h.api("bots.update", { botId: core, status: "hidden" })).rejects.toThrow("cannot be");
	await h.relaunch();
	expect((await profile()).avatar).toEqual(saved);
	await h.page().locator(".sidebar .bot-row").filter({ hasText: "Nova" }).first().click();
	await h.page().getByRole("textbox", { name: "Message Nova", exact: true }).waitFor();
});

it("imports local PNG JPEG and WebP, saves only explicitly, survives source removal and never sends image data to the model", async () => {
	const page = h.page();
	const fixtures = await page.evaluate(() => {
		const canvas = document.createElement("canvas");
		canvas.width = 64;
		canvas.height = 32;
		const ctx = canvas.getContext("2d")!;
		ctx.fillStyle = "#cc987b";
		ctx.fillRect(0, 0, 64, 32);
		ctx.fillStyle = "#42344f";
		ctx.fillRect(15, 8, 7, 7);
		ctx.fillRect(35, 8, 7, 7);
		return ["png", "jpeg", "webp"].map((type) => ({ type, base64: canvas.toDataURL(`image/${type}`).split(",")[1]! }));
	});
	await edit();
	for (const { type, base64 } of fixtures) {
		const path = join(h.run, `avatar.${type}`);
		await writeFile(path, Buffer.from(base64, "base64"));
		await pick(path);
		await page.locator(".avatar-stage img").waitFor();
		await poll(() => page.getByRole("button", { name: "Upload image", exact: true }).isEnabled()).toBe(true);
		expect((await profile()).avatar?.kind).toBe("generated");
	}
	await cancel();
	expect((await profile()).avatar?.kind).toBe("generated");
	await edit();
	await pick(join(h.run, "avatar.png"));
	await page.locator(".avatar-stage img").waitFor();
	await page.getByRole("button", { name: "Save profile", exact: true }).click();
	await page.locator(".conversation-header .avatar img").waitFor();
	const saved = await h.api("bots.avatar.get", { botId: core });
	expect(saved.sha256).toMatch(/^[a-f0-9]{64}$/);
	expect(JSON.stringify(await h.api("bots.list"))).not.toContain(saved.base64);
	await rm(join(h.run, "avatar.png"));
	await h.relaunch();
	await h.page().locator(".sidebar .bot-row").filter({ hasText: "Nova" }).first().click();
	await h.page().locator(".conversation-header .avatar img").waitFor();
	expect(await h.api("bots.avatar.get", { botId: core })).toEqual(saved);
	h.model.script({
		text: "## A little room to think\n\nProtect one clear morning for the proposal. Leave the afternoon open.\n\n- Draft the opening\n- Check the two key numbers\n- Decide what can wait",
	});
	await h.send("Turn my notes into a simple plan.");
	await h.page().getByRole("heading", { name: "A little room to think" }).waitFor();
	expect(JSON.stringify(h.model.requests.at(-1)?.messages)).not.toContain(saved.base64);
	await h.shot("02-personal-chat-light");
	const copy = await h.api("bots.duplicate", { botId: core, requestId: "nova-copy" });
	expect(copy.kind).toBe("specialist");
	expect(copy.avatar).toEqual((await profile()).avatar);
	expect(await h.api("bots.avatar.get", { botId: copy.botId })).toEqual(saved);
	expect((await h.api("conversations.snapshot", { botId: copy.botId })).items).toEqual([]);
});

it("rejects malformed uploads, keeps conflicting drafts and treats duplicate names as distinct Bots", async () => {
	const page = h.page();
	await edit();
	await writeFile(join(h.run, "bad.png"), "not an image");
	await pick(join(h.run, "bad.png"));
	await page.locator(".avatar-editor [role=alert]").waitFor();
	const previous = (await profile()).avatar;
	await expect(
		h.api("bots.update", {
			botId: core,
			expectedRevision: (await profile()).revision,
			avatar: { kind: "upload", base64: "bm90LWFuLWltYWdl" },
		}),
	).rejects.toThrow();
	expect((await profile()).avatar).toEqual(previous);
	await page.getByRole("button", { name: "Generate options", exact: true }).click();
	await page.locator(".avatar-choice").first().click();
	await h.api("bots.update", { botId: core, role: "Changed elsewhere" });
	await page.getByLabel("Name", { exact: true }).fill("Keep this draft");
	await page.getByRole("button", { name: "Save profile", exact: true }).click();
	await page.getByRole("alert").filter({ hasText: "Profile changed" }).waitFor();
	expect(await page.getByLabel("Name", { exact: true }).inputValue()).toBe("Keep this draft");
	expect((await profile()).avatar).toEqual(previous);
	await page.getByRole("button", { name: "Reload profile", exact: true }).click();
	await poll(() => page.getByLabel("Name", { exact: true }).inputValue()).toBe("Nova");
	await cancel();
	await page.locator(".sidebar .bot-row").filter({ hasText: "Atlas" }).click();
	await edit();
	await page.getByLabel("Name", { exact: true }).fill("Nova");
	await page.getByRole("button", { name: "Save profile", exact: true }).click();
	expect(await page.locator(".conversation-name .personal-star").count()).toBe(0);
	await page.getByRole("button", { name: "•••", exact: true }).click();
	await page.getByRole("menuitem", { name: "Delete…", exact: true }).waitFor();
	await page.keyboard.press("Escape");
	await h.api("bots.update", { botId: specialist, name: "Atlas" });
});

it("renders bilingual compact profiles, dark conversations and approval decisions without overflow", async () => {
	await h.page().locator(".sidebar .bot-row").filter({ hasText: "Nova" }).first().click();
	await h.page().getByRole("button", {name: /^Settings/}).click();
	await h.page().getByRole("radio", {name: "System", exact:true}).check();
	await h.page().getByRole("button", {name: "Back to chat", exact:true}).click();
	await h.page().emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
	await h.shot("03-personal-chat-dark");
	await h.api("settings.update", { language: "zh-CN" });
	await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(880, 700));
	await h.page().getByRole("button", { name: "会话详情", exact: true }).click();
	await h.page().getByRole("button", { name: "生成头像", exact: true }).click();
	await h.page().getByRole("button", { name: "保存资料", exact: true }).scrollIntoViewIfNeeded();
	expect(
		await h
			.page()
			.locator(".profile-details")
			.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
	).toBe(true);
	expect(await h.page().evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	const selectedTabContrast = await h
		.page()
		.getByRole("tab", { selected: true })
		.evaluate((el) => {
			const luminance = (color: string) =>
				color
					.match(/[\d.]+/g)!
					.slice(0, 3)
					.map(Number)
					.map((value) => {
						const channel = value / 255;
						return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
					})
					.reduce((sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i]!, 0);
			const foreground = luminance(getComputedStyle(el).color);
			const background = luminance(getComputedStyle(el.closest(".profile-details")!).backgroundColor);
			return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
		});
	expect(selectedTabContrast).toBeGreaterThanOrEqual(4.5);
	await h.shot("04-profile-compact-zh-dark");
	await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(2));
	await h.page().getByRole("button", { name: "保存资料", exact: true }).scrollIntoViewIfNeeded();
	expect(
		await h
			.page()
			.locator(".profile-details")
			.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
	).toBe(true);
	const saveBounds = await h
		.page()
		.getByRole("button", { name: "保存资料", exact: true })
		.evaluate((el) => {
			const rect = el.getBoundingClientRect();
			return {
				visible: rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth,
				width: innerWidth,
			};
		});
	expect(saveBounds).toEqual({ visible: true, width: 440 });
	// Electron's native capture includes the full window at non-default zoom; CDP screenshots crop it.
	const zoomCapture = await h
		.app()
		.evaluate(async ({ BrowserWindow }) =>
			(await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString("base64"),
		);
	await writeFile(join(h.run, "04b-profile-zoom-200.png"), Buffer.from(zoomCapture, "base64"));
	await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1));
	await h.page().keyboard.press("Escape");
	await h.api("settings.update", { language: "en" });
	h.model.script(
		{
			tool: "local_exec",
			args: { command: "printf 'design verification'", description: "Run the local design verification" },
		},
		{ text: "Stopped at your decision." },
	);
	await h.send("Run the verification command.");
	await h.page().getByRole("button", { name: "Deny", exact: true }).waitFor();
	await h.page().getByRole("button", { name: "Deny", exact: true }).scrollIntoViewIfNeeded();
	await h.shot("05-approval-compact");
	await h.page().getByRole("button", { name: "Deny", exact: true }).click();
	await h.page().getByText("Stopped at your decision.", { exact: true }).waitFor();
});

it("shows the approved welcome and conversation composition using real local profiles", async () => {
	await h.close();
	h = await launchApp("design-reference");
	await h.api("settings.update", { language: "en", defaultModel: { provider: "scripted", modelId: "scripted" } });
	core = (await h.api("bots.list"))[0].botId;
	await h.api("bots.create", { requestId: "atlas", name: "Atlas", role: "Research & reports" });
	await h.api("bots.create", { requestId: "scribe", name: "Scribe", role: "Writing & editing" });
	await h.api("settings.update", { language: "en" });
	const current = await profile();
	await h.api("bots.update", {
		botId: core,
		expectedRevision: current.revision,
		name: "OpenBot",
		role: "Personal assistant",
		avatar: { kind: "generated", version: 1, seed: 0, motif: "leaf" },
	});
	await h
		.page()
		.locator(".sidebar .bot-row")
		.filter({ has: h.page().getByText("OpenBot", { exact: true }) })
		.click();
	await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1280, 820));
	await h.page().emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
	await h
		.page()
		.getByRole("heading", { name: /Good to see you/ })
		.waitFor();
	await h.page().getByText("Scribe", { exact: true }).waitFor();
	await poll(() => h.page().locator(".conversation-header .avatar path").first().getAttribute("d")).toMatch(/^M37 31/);
	await h.shot("06-reference-welcome");
	h.model.script({
		text: "## Let’s make a little space.\n\nFrom your notes, **the proposal is the one thing to protect**. I’d give it your first clear morning and fit the smaller tasks around it.\n\n> THE SIMPLE VERSION\n>\n> One focused morning for the proposal.  \n> One short block for the loose ends.  \n> A little room for whatever comes up.\n\nYou can adjust this plan as you go. Nothing has been added to your calendar.",
	});
	await h.send(
		"This week is starting to feel a bit much. Can you turn my notes into a simple plan? Keep some breathing room.",
	);
	await h.page().getByRole("heading", { name: "Let’s make a little space." }).waitFor();
	await poll(async () => (await h.api("conversations.snapshot", { botId: core })).run).toBeUndefined();
	await h.page().locator(".sidebar").getByText("Working", { exact: true }).waitFor({ state: "hidden" });
	await h.shot("07-reference-conversation");
	await edit();
	await h.page().getByRole("button", { name: "Generate options", exact: true }).click();
	await h.shot("08-reference-profile");
	await cancel();
	expect(await h.page().getByRole("textbox", { name: "Message OpenBot", exact: true }).isEnabled()).toBe(true);
});
