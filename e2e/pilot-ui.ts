import type { Page } from "playwright-core";

/** Settings language is a React Aria listbox. */
export async function chooseSettingsLanguage(page: Page, language: "en" | "zh-CN"): Promise<void> {
	// React Aria names the trigger "English Language" / "简体中文 语言": the value id comes before the label id.
	const trigger = page.locator("#settings-language").getByRole("button", { name: /Language|语言/ });
	await page.locator("#settings-language").evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
	await trigger.click();
	const listbox = page.getByRole("listbox");
	await listbox.waitFor();
	await listbox.getByRole("option", { name: language === "en" ? "English" : "简体中文", exact: true }).click();
}

export async function viewportSize(page: Page): Promise<{ width: number; height: number }> {
	return page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
}
