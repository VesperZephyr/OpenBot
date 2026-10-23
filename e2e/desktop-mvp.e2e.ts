/**
 * End-to-end: the desktop MVP. First launch walks through setup with the scripted model's endpoint as a custom
 * provider and a suggested first Bot; consecutive successful tool calls collapse into "Ran N steps"; code blocks copy
 * through main; a schema-invalid call is rejected by main; Duplicate and Delete from the Bot menu. Screenshots land in
 * e2e/.run/desktop-mvp/.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AppHarness, launchApp } from "./harness.ts";

let h: AppHarness;

beforeAll(async () => {
	h = await launchApp("desktop-mvp", { firstLaunch: true });
}, 90_000);

afterAll(async () => {
	await h?.close();
});

describe("Desktop MVP", () => {
	it("sets up a custom OpenAI-compatible provider, tests it, and meets a first Bot", async () => {
		const page = h.page();
		await page.getByRole("heading", { name: "Meet OpenBot" }).waitFor();
		await h.shot("01-onboarding");

		await page.getByRole("radio", { name: /^Custom provider/ }).click();
		await page.getByLabel("Name").fill("Scripted");
		await page.getByLabel("Base URL").fill(h.modelBaseUrl);
		await page.getByLabel("Model ID").fill("scripted");
		await page.getByLabel("API key").fill("sk-e2e-key");
		// The test request consumes one scripted turn.
		h.model.script({ text: "OK" });
		await page.getByRole("button", { name: "Test and continue" }).click();
		await page.getByRole("textbox", { name: "Message OpenBot" }).waitFor();
		expect(h.model.requests).toHaveLength(1);

		// The endpoint is in models.json, the key is not: it went to the Keychain under the provider ID.
		const config = await readFile(join(h.run, "home", "models.json"), "utf8");
		expect(JSON.parse(config).providers.scripted).toMatchObject({ baseUrl: h.modelBaseUrl, api: "openai-completions", models: [{ id: "scripted" }] });
		expect(config).not.toContain("sk-e2e-key");
		await h.shot("02-first-bot");

		await page.getByRole("textbox", { name: "Message OpenBot" }).waitFor();
		h.model.script({ text: "Hello from OpenBot." });
		await h.send("Hi");
		// The suggested role's instructions reach the model.
		await expect.poll(() => JSON.stringify(h.model.requests.at(-1)?.messages)).toContain("personal assistant");
		expect(JSON.stringify(h.model.requests.at(-1)?.messages)).toContain("OpenBot");
	});

	it("collapses consecutive successful tool calls and reveals written files", async () => {
		const page = h.page();
		h.model.script(
			{ tool: "local_write", args: { path: "notes/a.md", content: "A\n" } },
			{ tool: "local_write", args: { path: "notes/b.md", content: "B\n" } },
			{ tool: "local_read", args: { path: "notes/a.md" } },
			{ text: "Wrote **two notes**:\n\n```sh\ncat notes/a.md notes/b.md\n```" },
		);
		await h.send("Write two notes");
		const steps = page.locator(".steps-row", { hasText: "Ran 3 steps" });
		await steps.waitFor();
		await page.locator(".transcript").getByText("Wrote two notes:").waitFor();
		expect(await page.locator(".messages > .tool-card").count()).toBe(0);
		expect(await readFile(join(h.workspace, "notes/a.md"), "utf8")).toBe("A\n");
		expect(await readFile(join(h.workspace, "notes/b.md"), "utf8")).toBe("B\n");
		expect(await page.locator(".markdown strong", { hasText: "two notes" }).count()).toBe(1);
		expect(await page.getByRole("group", { name: "Approval request" }).count()).toBe(0);
		await h.shot("03-steps-collapsed");

		await steps.locator("summary").first().click();
		await expect.poll(() => steps.locator(".tool-card").count()).toBe(3);
		await expect.poll(() => steps.getByRole("button", { name: "Reveal in Finder" }).count()).toBe(2);
		await h.shot("04-steps-expanded");

		await page.locator(".code-block").hover();
		await page.getByRole("button", { name: "Copy" }).click();
		await page.getByRole("button", { name: "Copied" }).waitFor();
		const copied = await h.app().evaluate(({ clipboard }) => clipboard.readText());
		expect(copied).toBe("cat notes/a.md notes/b.md");
	});

	it("rejects a schema-invalid call in main before it reaches the Host", async () => {
		const page = h.page();
		const message = await page.evaluate(async () => {
			// The preload's API as a DevTools user sees it, without the app's types.
			const devTools = window as unknown as { openbot: { methods: Record<string, (params: unknown) => Promise<unknown>> } };
			try {
				// An extra field and a wrong type.
				await devTools.openbot.methods["messages.submit"]!({ botId: 1, requestId: "x", text: "hi", extra: true });
				return "accepted";
			} catch (error) {
				return String(error);
			}
		});
		expect(message).toContain("[invalid_request]");
		expect(message).toContain("extra: unknown property");
	});

	it("duplicates a Bot with its profile and deletes one after confirmation", async () => {
		const page = h.page();
		await page.getByRole("button", { name: "•••" }).click();
		await page.getByRole("menuitem", { name: "Duplicate" }).click();
		await page.getByRole("textbox", { name: "Message OpenBot (copy)" }).waitFor();
		expect(await page.locator(".conversation-role").textContent()).toBe("Personal assistant");
		// No history comes along.
		expect(await page.getByText("Hello from OpenBot.").count()).toBe(0);
		await expect.poll(() => page.locator(".bot-row").count()).toBe(2);
		await h.shot("05-duplicated");

		await page.getByRole("button", { name: "•••" }).click();
		await page.getByRole("menuitem", { name: "Delete…" }).click();
		const dialog = page.getByRole("alertdialog", { name: "Delete OpenBot (copy)?" });
		await dialog.waitFor();
		await h.shot("06-confirm-delete");
		await dialog.getByRole("button", { name: "Delete Bot" }).click();
		await dialog.waitFor({ state: "detached" });
		await expect.poll(() => page.locator(".bot-row").count()).toBe(1);
		expect(await page.locator(".bot-row").filter({ has: page.getByText("OpenBot (copy)", { exact: true }) }).count()).toBe(0);

		// Deleted stays deleted after a restart.
		await h.relaunch();
		await h.page().locator(".bot-row").filter({ has: h.page().getByText("OpenBot", { exact: true }) }).waitFor();
		expect(await h.page().locator(".bot-row").count()).toBe(1);
	});
});
