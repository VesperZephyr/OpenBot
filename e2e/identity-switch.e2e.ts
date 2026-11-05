/**
 * Switching Bots asks before dropping an open profile draft, and never saves that draft onto the other Bot.
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
