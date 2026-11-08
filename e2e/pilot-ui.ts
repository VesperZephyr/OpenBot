import type { Page } from "playwright-core";

/**
 * The settings page first paints a short credential placeholder, then swaps in the full snapshot.
 * Scroll anchoring and the language trigger's scroll-into-view both move `.settings-content` while that happens.
 * Wait until the loaded page and its credential status have stopped changing height.
 */
export async function settleSettingsContent(page: Page): Promise<void> {
	await page.locator("#settings-language").waitFor();
	await page.getByText(/Checking credential storage…|正在检查凭据存储…/).waitFor({ state: "hidden" });
	await page.evaluate(() => document.fonts.ready);
	await page.waitForFunction(() => {
		const scroller = document.querySelector(".settings-content");
		if (!(scroller instanceof HTMLElement)) return false;
		const first = scroller.scrollHeight;
		return new Promise<boolean>((resolve) => {
			requestAnimationFrame(() => requestAnimationFrame(() => resolve(scroller.scrollHeight === first)));
		});
	});
}

/** Scroll the settled settings page, then keep the language trigger inside it so opening the listbox is not preceded by another scroll. */
export async function settingsScrollBeforeLanguageOpen(page: Page, targetTop: number): Promise<number> {
	await settleSettingsContent(page);
	const scroller = page.locator(".settings-content");
	await scroller.evaluate((element, top) => {
		element.scrollTop = top;
	}, targetTop);
	await page.locator("#settings-language").getByRole("button", { name: /Language|语言/ }).evaluate((element) => {
		const frame = element.closest(".settings-content");
		if (!(frame instanceof HTMLElement)) return;
		const box = element.getBoundingClientRect();
		const bounds = frame.getBoundingClientRect();
		if (box.height === 0 || box.top < bounds.top || box.bottom > bounds.bottom) {
			element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
		}
	});
	return scroller.evaluate((element) => element.scrollTop);
}

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
