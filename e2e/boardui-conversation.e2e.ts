import { afterAll, beforeAll, expect, it } from "vitest";
import { type AppHarness, launchApp } from "./harness.ts";

let h: AppHarness;
let atlasId: string;
const poll = (fn: () => Promise<unknown>) => expect.poll(fn, { timeout: 15000 });

function opaqueDarkShadow(shadow: string): boolean {
	if (!shadow || shadow === "none") return false;
	const layers = shadow.match(/(?:rgba?|hsla?|color)\([^)]+\)/g) ?? [];
	if (!layers.length) return false;
	return layers.some((layer) => {
		const parts = layer.match(/[\d.]+/g)?.map(Number) ?? [];
		const alpha = layer.startsWith("rgb") && parts.length < 4 ? 1 : (parts.at(-1) ?? 1);
		const channels = parts.slice(0, 3);
		const dark = channels.length >= 3 && channels.every((channel) => channel <= 40);
		return alpha >= 1 && dark;
	});
}

beforeAll(async () => {
	h = await launchApp("boardui-conversation");
	await h.api("settings.update", { defaultModel: { provider: "scripted", modelId: "scripted" }, language: "en" });
	const created = await h.api("bots.create", {
		requestId: "atlas-ui",
		name: "Atlas",
		role: "Research",
		instructions: "Atlas keeps research concise.\nExample: Summarize the notes from today",
	});
	atlasId = created.botId;
	await h.page().locator(".bot-row").filter({ has: h.page().getByText("Atlas", { exact: true }) }).click();
	await h.page().getByRole("textbox", { name: "Message Atlas" }).waitFor();
}, 60000);

afterAll(async () => {
	await h?.close();
});

async function appearance(name: "Light" | "Dark" | "浅色" | "深色") {
	await h.page().getByRole("button", { name: /^Settings|^设置/ }).click();
	await h.page().getByRole("radio", { name, exact: true }).check();
	await h.page().getByRole("button", { name: /Back to chat|返回聊天/ }).click();
}

it("shows the empty conversation, detail panel and themes", async () => {
	await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1280, 820));
	const empty = h.page().locator(".empty-conversation");
	await empty.getByRole("heading", { name: "Atlas", exact: true }).waitFor();
	await empty.getByRole("button", { name: "Summarize the notes from today", exact: true }).waitFor();
	await h.page().getByRole("button", { name: "View details", exact: true }).click();
	await h.page().locator(".bot-identity").getByText("Research", { exact: true }).waitFor();
	await h.page().locator(".identity-kicker").getByText("Prompt", { exact: true }).waitFor();
	expect(await h.page().locator(".identity-avatar .avatar-ground").count()).toBe(1);
	expect(await h.page().locator(".sidebar .avatar-ground").count()).toBe(0);
	expect(await h.page().locator(".empty-conversation .avatar-ground").count()).toBe(0);
	await h.page().locator(".conversation-status").getByText("Idle", { exact: true }).waitFor();
	await h.shot("01-empty-light");
	await h.shot("02-detail-light");
	await appearance("Dark");
	await h.page().locator(".conversation-status").getByText("Idle", { exact: true }).waitFor();
	const shadow = await h.page().locator(".identity-avatar .avatar").first().evaluate((element) => getComputedStyle(element).boxShadow);
	expect(opaqueDarkShadow(shadow)).toBe(false);
	const ground = await h.page().locator(".identity-avatar .avatar-ground").evaluate((element) => {
		const style = getComputedStyle(element);
		return { fill: style.fill, opacity: Number(style.opacity) };
	});
	expect(lightTranslucent(ground.fill, ground.opacity), JSON.stringify(ground)).toBe(true);
	await h.shot("03-empty-dark");
	await h.shot("04-detail-dark");
	await h.api("settings.update", { language: "zh-CN" });
	await h.page().locator(".conversation-status").getByText("空闲", { exact: true }).waitFor();
	await h.shot("05-empty-zh-dark");
	await appearance("浅色");
	await h.shot("06-empty-zh-light");
	await h.api("settings.update", { language: "en" });
	const panel = h.page().locator(".bot-identity");
	await panel.getByRole("button", { name: "Edit", exact: true }).click();
	await panel.getByRole("button", { name: "Save", exact: true }).waitFor();
	await panel.getByRole("button", { name: "Cancel", exact: true }).click();
	await panel.getByRole("button", { name: "Edit", exact: true }).waitFor();
	h.model.script({ text: "Today's notes are in three short points." });
	await empty.getByRole("button", { name: "Summarize the notes from today", exact: true }).click();
	await h.page().getByText("Today's notes are in three short points.", { exact: true }).waitFor();
	expect(await h.page().locator(".message-author .avatar-ground").count()).toBe(0);
	await h.shot("07-conversation-light");
	await appearance("Dark");
	await h.shot("08-conversation-dark");
	await appearance("Light");
});

it("shows a textual working indicator when motion is reduced", async () => {
	await h.page().emulateMedia({ reducedMotion: "reduce" });
	h.model.script({ text: "Still working", delayMs: 8000 });
	await h.send("Keep going");
	await h.page().getByRole("button", { name: "Stop", exact: true }).waitFor();
	await poll(() => h.page().locator(".conversation-status").textContent()).toBe("Working");
	await h.page().locator(".activity-text", { hasText: "Working" }).waitFor();
	expect(await h.page().locator(".activity-working").count()).toBe(0);
	await h.shot("09-working-reduced-motion");
	await h.page().getByRole("button", { name: "Stop", exact: true }).click();
	await h.page().getByRole("button", { name: "Stop", exact: true }).waitFor({ state: "hidden" });
});

it("saves a renamed Bot from the detail form", async () => {
	const panel = h.page().locator(".bot-identity");
	await panel.getByRole("button", { name: "Edit", exact: true }).click();
	await panel.getByLabel("Name", { exact: true }).fill("Atlas kept");
	await panel.getByRole("button", { name: "Save", exact: true }).click();
	await panel.locator(".identity-name").getByText("Atlas kept", { exact: true }).waitFor();
	await poll(async () => (await h.api("bots.list")).find((bot: { botId: string }) => bot.botId === atlasId).name).toBe("Atlas kept");
});

it("shows an external profile change without a conflict notice", async () => {
	const panel = h.page().locator(".bot-identity");
	await panel.getByRole("button", { name: "Edit", exact: true }).waitFor();
	expect(await panel.locator(".identity-form").count()).toBe(0);
	const current = (await h.api("bots.list")).find((bot: { botId: string; revision: number }) => bot.botId === atlasId);
	await h.api("bots.update", { botId: atlasId, expectedRevision: current.revision, name: "Atlas synced", role: "Field notes" });
	await panel.locator(".identity-name").getByText("Atlas synced", { exact: true }).waitFor();
	await panel.getByText("Field notes", { exact: true }).waitFor();
	await h.page().locator(".conversation-name").getByText("Atlas synced", { exact: true }).waitFor();
	await h.page().locator(".conversation-role").getByText("Field notes", { exact: true }).waitFor();
	expect(await h.page().getByText("Profile changed. Reload before saving your draft.").count()).toBe(0);
});

it("reports a revision conflict instead of overwriting the name", async () => {
	const panel = h.page().locator(".bot-identity");
	await panel.getByRole("button", { name: "Edit", exact: true }).click();
	await panel.getByLabel("Name", { exact: true }).fill("Atlas local");
	const current = (await h.api("bots.list")).find((bot: { botId: string; revision: number }) => bot.botId === atlasId);
	await h.api("bots.update", { botId: atlasId, expectedRevision: current.revision, name: "Atlas remote" });
	await panel.getByRole("button", { name: "Save", exact: true }).click();
	await panel.locator(".identity-alert").getByText("Profile changed. Reload before saving your draft.").waitFor();
	expect(await panel.getByLabel("Name", { exact: true }).inputValue()).toBe("Atlas local");
	expect((await h.api("bots.list")).find((bot: { botId: string }) => bot.botId === atlasId).name).toBe("Atlas remote");
	await h.page().locator(".toast").getByRole("button", { name: "Dismiss", exact: true }).click();
	await h.page().locator(".toast").waitFor({ state: "hidden" });
	await panel.getByRole("button", { name: "Reload profile", exact: true }).click();
	await poll(() => panel.getByLabel("Name", { exact: true }).inputValue()).toBe("Atlas remote");
	await panel.getByRole("button", { name: "Cancel", exact: true }).click();
	await panel.getByRole("button", { name: "Edit", exact: true }).waitFor();
});

it("switches the composer model twice", async () => {
	await h.page().locator(".conversation-name").getByText("Atlas remote", { exact: true }).waitFor();
	const model = h.page().getByRole("combobox", { name: "Model", exact: true });
	await model.waitFor();
	await poll(async () => model.locator("option").count()).toBeGreaterThan(1);
	expect(await model.locator("option").first().textContent()).toBe("Default (Scripted)");
	expect(await h.page().locator(".composer-model-note").textContent()).toBe("This Bot uses this model from now on.");
	await model.selectOption("scripted/scripted");
	await poll(async () => (await h.api("bots.list")).find((bot: { botId: string }) => bot.botId === atlasId).model).toEqual({
		provider: "scripted",
		modelId: "scripted",
	});
	await model.selectOption("");
	await poll(async () => (await h.api("bots.list")).find((bot: { botId: string }) => bot.botId === atlasId).model).toBeUndefined();
	const revision = (await h.api("bots.list")).find((bot: { botId: string; revision: number }) => bot.botId === atlasId).revision;
	await h.api("bots.update", { botId: atlasId, expectedRevision: revision, model: { provider: "missing", modelId: "nope" } });
	await h.page().locator(".composer-model").getByText("Model unavailable", { exact: true }).waitFor();
	await h.page().locator(".composer-model").getByRole("button", { name: "Model settings", exact: true }).click();
	await h.page().getByRole("heading", { name: "Settings", exact: true }).waitFor();
	await h.page().getByRole("button", { name: "Back to chat" }).click();
	await h.page().getByRole("textbox", { name: /Message / }).waitFor();
	const again = (await h.api("bots.list")).find((bot: { botId: string; revision: number }) => bot.botId === atlasId);
	await h.api("bots.update", { botId: atlasId, expectedRevision: again.revision, model: null });
	await h.page().getByRole("combobox", { name: "Model", exact: true }).waitFor();
});

it("closes the detail form when the conversation editor opens", async () => {
	const panel = h.page().locator(".bot-identity");
	await panel.getByRole("button", { name: "Edit", exact: true }).click();
	await panel.getByLabel("Name", { exact: true }).waitFor();
	await h.page().getByRole("button", { name: "•••", exact: true }).click();
	await h.page().getByRole("menuitem", { name: "Edit profile", exact: true }).click();
	const dialog = h.page().getByRole("dialog", { name: "Conversation details" });
	await dialog.waitFor();
	expect(await panel.locator(".identity-form").count()).toBe(0);
	expect(await dialog.getByLabel("Name", { exact: true }).count()).toBe(1);
	await h.page().keyboard.press("Escape");
	await poll(async () => dialog.count()).toBe(0);
});

it("captures the review states in light and dark", async () => {
	await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1280, 820));
	await h.api("settings.update", { language: "en" });
	expect(await h.page().getByText("Profile changed. Reload before saving your draft.").count()).toBe(0);
	const panel = h.page().locator(".bot-identity");
	const atlas = async () => (await h.api("bots.list")).find((bot: { botId: string; revision: number }) => bot.botId === atlasId);

	await h.page().locator(".sidebar .roster-name").getByText("Atlas remote", { exact: true }).click();
	await h.page().getByRole("textbox", { name: /Message / }).waitFor();
	const beforePrompt = await atlas();
	await h.api("bots.update", {
		botId: atlasId,
		expectedRevision: beforePrompt.revision,
		instructions: "Atlas keeps research concise. The standing prompt continues onto another line so the detail card can expand it.\nExample: Summarize the notes from today",
	});
	await panel.getByText("standing prompt continues").waitFor();
	await panel.locator(".identity-kicker").getByText("Prompt", { exact: true }).waitFor();
	await panel.getByRole("button", { name: "Show more", exact: true }).click();
	await panel.locator(".identity-bio.is-open").waitFor();
	await h.shot("prompt-expanded-light");
	await appearance("Dark");
	await panel.getByRole("button", { name: "Show more", exact: true }).click();
	await panel.locator(".identity-bio.is-open").waitFor();
	await h.shot("prompt-expanded-dark");
	await appearance("Light");

	await panel.getByRole("button", { name: "Edit", exact: true }).click();
	await panel.getByLabel("Name", { exact: true }).fill("Atlas draft");
	await panel.getByRole("button", { name: "Cancel", exact: true }).click();
	await panel.getByRole("alertdialog", { name: "Discard these edits?" }).waitFor();
	expect(await panel.getByLabel("Name", { exact: true }).inputValue()).toBe("Atlas draft");
	expect(await panel.getByRole("button", { name: "Save", exact: true }).count()).toBe(0);
	expect(await panel.getByRole("button", { name: "Cancel", exact: true }).count()).toBe(0);
	expect(await panel.getByRole("button", { name: "Discard", exact: true }).evaluate((element) => element.classList.contains("primary"))).toBe(false);
	await h.shot("cancel-confirm-light");
	await panel.getByRole("button", { name: "Keep editing", exact: true }).click();
	await appearance("Dark");
	await panel.getByRole("button", { name: "Edit", exact: true }).click();
	await panel.getByLabel("Name", { exact: true }).fill("Atlas draft");
	await panel.getByRole("button", { name: "Cancel", exact: true }).click();
	await panel.getByRole("alertdialog", { name: "Discard these edits?" }).waitFor();
	expect(await panel.getByRole("button", { name: "Save", exact: true }).count()).toBe(0);
	expect(await panel.getByRole("button", { name: "Cancel", exact: true }).count()).toBe(0);
	expect(await panel.getByRole("button", { name: "Discard", exact: true }).evaluate((element) => element.classList.contains("primary"))).toBe(false);
	await h.shot("cancel-confirm-dark");
	await panel.getByRole("button", { name: "Discard", exact: true }).click();
	await panel.getByRole("button", { name: "Edit", exact: true }).waitFor();
	expect((await atlas()).name).toBe("Atlas remote");
	await appearance("Light");

	h.model.script({ tool: "local_exec", args: { command: "echo review", description: "Preview a command" } }, { text: "The command was not run." });
	await h.send("Preview a command");
	const card = h.page().getByRole("group", { name: "Approval request" });
	await card.waitFor();
	expect(await h.page().locator(".conversation-status").textContent()).toBe("Working");
	expect(await h.page().locator(".live-reply .reply-activity").count()).toBe(0);
	expect(await h.page().locator(".tool-verb").last().textContent()).toBe("Running");
	const actions = card.locator(".approval-actions button");
	expect(await actions.nth(0).textContent()).toBe("Allow once");
	expect(await actions.nth(1).textContent()).toBe("Deny");
	await card.getByRole("button", { name: "Always allow", exact: true }).waitFor();
	await h.shot("approval-light");
	await appearance("Dark");
	await card.waitFor();
	expect(await card.locator(".approval-actions button").nth(0).textContent()).toBe("Allow once");
	expect(await card.locator(".approval-actions button").nth(1).textContent()).toBe("Deny");
	await h.shot("approval-dark");
	await appearance("Light");
	await card.getByRole("button", { name: "Deny", exact: true }).click();
	await card.waitFor({ state: "hidden" });
	await h.page().getByText("The command was not run.", { exact: true }).waitFor();
	const denied = h.page().locator(".tool-card", { hasText: "echo review" });
	expect(await denied.locator(".tool-verb").textContent()).toBe("Denied");
	expect(await denied.locator(".tool-output").textContent()).toBe("Denied");
	expect(await h.page().getByText("Do not retry it", { exact: false }).count()).toBe(0);

	const beforeModel = await atlas();
	await h.api("bots.update", { botId: atlasId, expectedRevision: beforeModel.revision, model: { provider: "missing", modelId: "nope" } });
	await h.page().locator(".composer-model").getByRole("button", { name: "Model settings", exact: true }).waitFor();
	await h.shot("model-settings-light");
	await appearance("Dark");
	await h.page().locator(".composer-model").getByText("Model unavailable", { exact: true }).waitFor();
	await h.shot("model-settings-dark");
	await appearance("Light");
	const afterModel = await atlas();
	await h.api("bots.update", { botId: atlasId, expectedRevision: afterModel.revision, model: null });
	await h.page().getByRole("combobox", { name: "Model", exact: true }).waitFor();
});

it("hides group more-actions when nothing is unread", async () => {
	const bots = await h.api("bots.list");
	const core = bots.find((bot: { kind: string; botId: string }) => bot.kind === "core");
	await h.api("groups.change", {
		requestId: "boardui-group",
		groupId: "group_boardui",
		action: "create",
		expectedRevision: 0,
		fields: { name: "Studio", objective: "Shared notes", memberIds: [core.botId, atlasId], leadBotId: core.botId },
	});
	await h.page().locator(".group-nav").filter({ hasText: "Studio" }).click();
	await h.page().locator(".conversation-header").getByRole("heading", { name: "Studio", exact: true }).waitFor();
	expect(await h.page().getByRole("button", { name: "More actions", exact: true }).count()).toBe(0);
	await h.shot("menu-hidden-light");
	await appearance("Dark");
	expect(await h.page().getByRole("button", { name: "More actions", exact: true }).count()).toBe(0);
	await h.shot("menu-hidden-dark");
	await appearance("Light");
});

function lightTranslucent(fill: string, opacity: number): boolean {
	const match = fill.match(/rgba?\(([^)]+)\)/) ?? fill.match(/color\(([^)]+)\)/);
	if (!match?.[1]) return false;
	const body = match[1];
	const percent = body.match(/\/\s*([\d.]+)%/);
	const nums = body.match(/[\d.]+/g)?.map(Number) ?? [];
	const channels = nums.slice(0, 3);
	const parsed = percent ? Number(percent[1]) / 100 : nums.length >= 4 ? (nums[3]! > 1 ? nums[3]! / 100 : nums[3]!) : 1;
	const alpha = parsed * (Number.isFinite(opacity) ? opacity : 1);
	return channels.length >= 3 && channels.every((channel) => channel >= 180) && alpha < 1;
}
