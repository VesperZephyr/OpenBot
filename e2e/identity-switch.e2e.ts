/**
 * Switching Bots asks before dropping an open profile draft, and never saves that draft onto the other Bot.
 * A narrow window hides that confirm dialog; the draft stays and the switch still happens.
 * Widening onto the next Bot still edits and closes that Bot, and the first draft remains.
 */
import { expect, it } from "vitest";
import { type AppHarness, launchApp } from "./harness.ts";

type ListedBot = { botId: string; name: string; role: string; instructions: string; revision: number };

const profile = (bot: ListedBot) => ({
	name: bot.name,
	role: bot.role,
	instructions: bot.instructions,
	revision: bot.revision,
});

it("does not save A's open profile draft onto B", async () => {
	let h: AppHarness | undefined;
	try {
		h = await launchApp("identity-switch");
		await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900));
		await h.api("settings.update", { defaultModel: { provider: "scripted", modelId: "scripted" }, language: "en" });
		const ada = (await h.api("bots.create", { requestId: "ada-identity", name: "Ada", role: "Writer", instructions: "Write clearly." })) as ListedBot;
		const bee = (await h.api("bots.create", { requestId: "bee-identity", name: "Bee", role: "Editor", instructions: "Edit carefully." })) as ListedBot;
		expect(ada.revision).toBe(1);
		expect(bee.revision).toBe(1);
		const before = [ada, bee];
		const page = h.page();
		const row = (name: string) => page.locator(".bot-row").filter({ has: page.getByText(name, { exact: true }) });
		await row("Ada").click();
		await page.getByRole("textbox", { name: "Message Ada" }).waitFor();
		const panel = page.locator("aside.bot-identity");
		await page.getByRole("button", { name: "View details", exact: true }).click();
		await panel.getByRole("button", { name: "Edit", exact: true }).click();
		await panel.locator("form.identity-form input").first().fill("Ada renamed");
		await row("Bee").click();
		await panel.getByRole("alertdialog", { name: "Discard these edits?" }).waitFor();
		expect(await panel.getByLabel("Name", { exact: true }).inputValue()).toBe("Ada renamed");
		expect(await page.getByRole("textbox", { name: "Message Ada" }).count()).toBe(1);
		await panel.getByRole("button", { name: "Keep editing", exact: true }).click();
		await row("Bee").click();
		await panel.getByRole("button", { name: "Discard", exact: true }).click();
		await page.getByRole("textbox", { name: "Message Bee" }).waitFor();
		const shown = async (): Promise<string> => {
			const input = panel.locator("form.identity-form input").first();
			if (await input.count()) return input.inputValue();
			return panel.locator(".identity-name").innerText();
		};
		await expect.poll(shown).toBe("Bee");
		const save = panel.getByRole("button", { name: "Save", exact: true });
		if (await save.isVisible()) await save.click();
		const after = (await h.api("bots.list")) as ListedBot[];
		const current = (id: string) => profile(after.find((bot) => bot.botId === id)!);
		expect(current(ada.botId)).toEqual(profile(before[0]!));
		expect(current(bee.botId)).toEqual(profile(before[1]!));
	} finally {
		await h?.close();
	}
}, 90_000);

async function setContentSize(h: AppHarness, width: number, height: number): Promise<void> {
	await h.app().evaluate(
		({ BrowserWindow }, size: { width: number; height: number }) => {
			BrowserWindow.getAllWindows()[0]!.setContentSize(size.width, size.height);
		},
		{ width, height },
	);
	await h.nextFrame();
}

it("keeps a dirty profile draft when the window is too narrow to show the confirm dialog", async () => {
	let h: AppHarness | undefined;
	try {
		h = await launchApp("identity-narrow");
		await setContentSize(h, 1440, 900);
		await h.api("settings.update", { defaultModel: { provider: "scripted", modelId: "scripted" }, language: "en" });
		await h.api("bots.create", { requestId: "ada-narrow", name: "Ada", role: "Writer", instructions: "Write clearly." });
		await h.api("bots.create", { requestId: "bee-narrow", name: "Bee", role: "Editor", instructions: "Edit carefully." });
		const page = h.page();
		const row = (name: string) => page.locator(".bot-row").filter({ has: page.getByText(name, { exact: true }) });
		await row("Ada").click();
		await page.getByRole("textbox", { name: "Message Ada" }).waitFor();
		const panel = page.locator("aside.bot-identity");
		await page.getByRole("button", { name: "View details", exact: true }).click();
		await panel.getByRole("button", { name: "Edit", exact: true }).click();
		await panel.getByLabel("Name", { exact: true }).fill("Ada renamed");
		expect(await panel.getByLabel("Name", { exact: true }).inputValue()).toBe("Ada renamed");
		// Below the 1180px inspector breakpoint the confirm dialog is not mounted.
		await setContentSize(h, 1000, 720);
		await expect.poll(() => panel.count()).toBe(0);
		await row("Bee").click();
		await h.nextFrame();
		expect(await page.getByRole("alertdialog", { name: "Discard these edits?" }).count()).toBe(0);
		await page.getByRole("textbox", { name: "Message Bee" }).waitFor();
		await row("Ada").click();
		await page.getByRole("textbox", { name: "Message Ada" }).waitFor();
		await setContentSize(h, 1440, 900);
		await expect.poll(() => panel.getByLabel("Name", { exact: true }).inputValue()).toBe("Ada renamed");
	} finally {
		await h?.close();
	}
}, 90_000);

it("lets the next Bot edit and close after a narrow switch, and keeps the first draft", async () => {
	let h: AppHarness | undefined;
	try {
		h = await launchApp("identity-narrow-widen");
		await setContentSize(h, 1440, 900);
		await h.api("settings.update", { defaultModel: { provider: "scripted", modelId: "scripted" }, language: "en" });
		await h.api("bots.create", { requestId: "ada-widen", name: "Ada", role: "Writer", instructions: "Write clearly." });
		await h.api("bots.create", { requestId: "bee-widen", name: "Bee", role: "Editor", instructions: "Edit carefully." });
		const page = h.page();
		const row = (name: string) => page.locator(".bot-row").filter({ has: page.getByText(name, { exact: true }) });
		await row("Ada").click();
		await page.getByRole("textbox", { name: "Message Ada" }).waitFor();
		const panel = page.locator("aside.bot-identity");
		await page.getByRole("button", { name: "View details", exact: true }).click();
		await panel.getByRole("button", { name: "Edit", exact: true }).click();
		await panel.getByLabel("Name", { exact: true }).fill("Ada renamed");
		expect(await panel.getByLabel("Name", { exact: true }).inputValue()).toBe("Ada renamed");
		// The inspector unmounts below 1180px. Ada's dirty draft stays, with no confirm dialog.
		await setContentSize(h, 1000, 720);
		await expect.poll(() => panel.count()).toBe(0);
		await row("Bee").click();
		await h.nextFrame();
		expect(await page.getByRole("alertdialog", { name: "Discard these edits?" }).count()).toBe(0);
		await page.getByRole("textbox", { name: "Message Bee" }).waitFor();
		await setContentSize(h, 1440, 900);
		await panel.getByRole("button", { name: "Edit", exact: true }).waitFor();
		expect(await panel.locator(".identity-name").innerText()).toBe("Bee");
		await panel.getByRole("button", { name: "Edit", exact: true }).click();
		const beeName = async (): Promise<string> => {
			if ((await panel.locator("form.identity-form").count()) === 0) return "no form";
			return panel.getByLabel("Name", { exact: true }).inputValue();
		};
		await expect.poll(beeName).toBe("Bee");
		// Cancel leaves Bee's unchanged form so Close details can dismiss the card.
		await panel.getByRole("button", { name: "Cancel", exact: true }).click();
		await panel.getByRole("button", { name: "Close details", exact: true }).click();
		await expect.poll(() => panel.count()).toBe(0);
		await row("Ada").click();
		await page.getByRole("textbox", { name: "Message Ada" }).waitFor();
		await page.getByRole("button", { name: "View details", exact: true }).click();
		await expect.poll(() => panel.getByLabel("Name", { exact: true }).inputValue()).toBe("Ada renamed");
	} finally {
		await h?.close();
	}
}, 90_000);
