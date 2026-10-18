/**
 * End-to-end: Bot memory and New topic. A scripted `memory_update` shows in the Memory tab and in the next request's
 * system prompt; New topic leaves a divider and drops earlier messages from the next request but keeps memory.
 * Screenshots land in e2e/.run/bot-quality/.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AppHarness, createBot, launchApp } from "./harness.ts";
import type { ModelRequest } from "./scripted-model.ts";

let h: AppHarness;

beforeAll(async () => {
	h = await launchApp("bot-quality");
	await createBot(h, "Mira");
}, 90_000);

afterAll(async () => {
	await h?.close();
});

const systemText = (request: ModelRequest | undefined): string =>
	JSON.stringify((request?.messages ?? []).filter((message) => message.role === "system" || message.role === "developer"));

const userTexts = (request: ModelRequest | undefined): string[] =>
	(request?.messages ?? []).filter((message) => message.role === "user").map((message) => JSON.stringify(message.content));

describe("Bot quality", () => {
	it("memory_update shows in the Memory tab and the next system prompt", async () => {
		const page = h.page();
		h.model.script(
			{ tool: "memory_update", args: { expectedRevision: 0, action: "append", section: "Preferences", content: "- Always answer in Chinese." } },
			{ text: "好的,我记住了。" },
		);
		await h.send("Always answer in Chinese.");
		await page.locator(".tool-card.tool-succeeded", { hasText: "Updated memory" }).waitFor();
		await page.locator(".transcript").getByText("好的,我记住了。").waitFor();
		expect(systemText(h.model.requests.at(-1))).toContain("Always answer in Chinese.");

		await page.getByRole("button", { name: "•••" }).click();
		await page.getByRole("menuitem", { name: "Edit profile" }).click();
		await page.getByRole("tab", { name: "Memory" }).click();
		const memory = page.getByRole("textbox", { name: "Memory" });
		await expect.poll(() => memory.inputValue()).toBe("## Preferences\n- Always answer in Chinese.");
		await h.shot("01-memory-tab");

		// The user's own edit reaches the next request too.
		await memory.fill("## Preferences\n- Always answer in Chinese.\n- Keep answers short.");
		await page.getByRole("button", { name: "Save memory" }).click();
		await memory.waitFor({ state: "detached" });
		h.model.script({ text: "短的。" });
		await h.send("Hello");
		await page.locator(".transcript").getByText("短的。").waitFor();
		expect(systemText(h.model.requests.at(-1))).toContain("Keep answers short.");
	});

	it("New topic shows a divider and drops earlier messages but keeps memory", async () => {
		const page = h.page();
		await page.getByRole("button", { name: "•••" }).click();
		await page.getByRole("menuitem", { name: "New topic" }).click();
		await page.getByRole("separator", { name: "New topic" }).waitFor();

		h.model.script({ text: "新话题。" });
		await h.send("Fresh question");
		await page.locator(".transcript").getByText("新话题。").waitFor();
		const request = h.model.requests.at(-1);
		expect(userTexts(request)).toEqual([JSON.stringify("Fresh question")]);
		expect(systemText(request)).toContain("Always answer in Chinese.");
		// Earlier messages stay visible above the divider.
		await page.getByText("Always answer in Chinese.", { exact: true }).waitFor();
		await h.shot("02-new-topic");
	});

	it("Retry resubmits the last message after a model error", async () => {
		const page = h.page();
		h.model.script({ error: "The model is unavailable for this key" }, { text: "Second try worked." });
		await h.send("Try this");
		const failed = page.locator(".message-error", { hasText: "The model is unavailable for this key" });
		await failed.waitFor();
		const before = h.model.requests.length;
		await failed.getByRole("button", { name: "Retry" }).click();
		await page.locator(".transcript").getByText("Second try worked.").waitFor();
		expect(h.model.requests.length).toBe(before + 1);
		expect(userTexts(h.model.requests.at(-1)).filter((text) => text === JSON.stringify("Try this"))).toHaveLength(2);
		await expect.poll(() => page.getByRole("button", { name: "Retry" }).count()).toBe(0);
		await h.shot("03-retry");
	});
});
