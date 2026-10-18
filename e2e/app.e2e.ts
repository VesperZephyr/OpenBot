/**
 * End-to-end: the real Electron app, Host, and executor, driven through the window. A scripted model stands in for
 * the provider so runs are free and deterministic. Screenshots land in e2e/.run/app/.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AppHarness, createBot, launchApp } from "./harness.ts";

let h: AppHarness;

beforeAll(async () => {
	h = await launchApp("app");
	await h.page().getByRole("textbox", { name: "Message OpenBot" }).waitFor();
}, 60_000);

afterAll(async () => {
	await h?.close();
});

describe("OpenBot desktop", () => {
	it("chooses a configured model and creates a Bot", async () => {
		await createBot(h, "Scout");
		await h.shot("01-bot");
	});

	it("writes in the workspace without asking and renders Markdown", async () => {
		const page = h.page();
		h.model.script({ tool: "local_write", args: { path: "hello.md", content: "Hello from Scout\n" } }, { text: "Created **hello.md**." });
		await h.send("Create hello.md");
		await page.locator(".tool-card", { hasText: "Wrote" }).waitFor();
		await page.locator(".markdown strong", { hasText: "hello.md" }).waitFor();
		expect(await readFile(join(h.workspace, "hello.md"), "utf8")).toBe("Hello from Scout\n");
		await h.shot("02-write");
	});

	it("runs a command only after Allow once", async () => {
		const page = h.page();
		h.model.script({ tool: "local_exec", args: { command: "wc -c hello.md | tee size.txt", description: "Count bytes" } }, { text: "It is 17 bytes." });
		await h.send("How big is it?");
		const card = page.getByRole("group", { name: "Approval request" });
		await card.waitFor();
		await expect.poll(() => card.locator(".approval-args").textContent()).toContain("wc -c hello.md | tee size.txt");
		await expect.poll(() => page.locator(".bot-row").filter({ has: page.getByText("Scout", { exact: true }) }).textContent()).toContain("Needs attention");
		await h.shot("03-approval");

		await card.getByRole("button", { name: "Allow once" }).click();
		await page.locator(".tool-card.tool-succeeded", { hasText: "Count bytes" }).waitFor();
		await page.locator(".transcript").getByText("It is 17 bytes.").waitFor();
		expect(await page.locator(".tool-card", { hasText: "Count bytes" }).locator(".tool-output").textContent()).toContain("17");
		await h.shot("04-approved");
	});

	it("tells the model when the user denies a command", async () => {
		const page = h.page();
		h.model.script({ tool: "local_exec", args: { command: "rm hello.md", description: "Delete file" } }, { text: "Understood, I left it." });
		await h.send("Delete it");
		const card = page.getByRole("group", { name: "Approval request" });
		await card.getByRole("button", { name: "Deny" }).click();
		await page.locator(".transcript").getByText("Understood, I left it.").waitFor();
		await page.locator(".tool-card.tool-failed", { hasText: "Delete file" }).waitFor();
		expect(await readFile(join(h.workspace, "hello.md"), "utf8")).toBe("Hello from Scout\n");
		const lastToolResult = JSON.stringify(h.model.requests.at(-1)?.messages.at(-1));
		expect(lastToolResult).toContain("denied");
		await h.shot("05-denied");
	});
});
