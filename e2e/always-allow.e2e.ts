/**
 * End-to-end: Always allow and the read-only default. **Always allow** on `git status` saves a rule, so a second
 * `git status` runs without a card; deleting the rule in Settings → Commands brings the card back. A read-only search
 * in the workspace runs without a card. Screenshots land in e2e/.run/always-allow/.
 */
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AppHarness, createBot, launchApp } from "./harness.ts";

const run = promisify(execFile);
let h: AppHarness;

const card = () => h.page().getByRole("group", { name: "Approval request" });

async function openBot(name: string): Promise<void> {
	await h.page().locator(".bot-row").filter({ has: h.page().getByText(name, { exact: true }) }).click();
	await h.page().getByRole("textbox", { name: `Message ${name}` }).waitFor();
}

beforeAll(async () => {
	h = await launchApp("always-allow");
	// A repository in the workspace, so `git status` succeeds.
	await run("git", ["init", "-q"], { cwd: h.workspace });
	await writeFile(join(h.workspace, "notes.txt"), "needle in the workspace\n");
	await createBot(h, "Warden");
}, 90_000);

afterAll(async () => {
	await h?.close();
});

describe("always allow", () => {
	it("a read-only search in the workspace runs without a card", async () => {
		h.model.script({ tool: "local_exec", args: { command: "grep -rn needle .", description: "Search notes" } }, { text: "Found it." });
		await h.send("Find the needle");
		await h.page().locator(".tool-card.tool-succeeded", { hasText: "Search notes" }).waitFor();
		await h.page().locator(".transcript").getByText("Found it.").waitFor();
		expect(await card().count()).toBe(0);
		await h.shot("01-read-only-search");
	});

	it("Always allow on git status saves a rule; deleting it brings the card back", async () => {
		// git is not in the read-only default; turning it off as well proves the rule alone lets git status through.
		await h.page().getByRole("button", { name: /^Settings/ }).click();
		const commands = h.page().getByLabel("Commands", { exact: true });
		// Controlled by the Host: the box changes once the policy update returns, which `uncheck()` does not wait for.
		await commands.getByRole("checkbox").click();
		await expect.poll(() => commands.getByRole("checkbox").isChecked()).toBe(false);
		await openBot("Warden");

		h.model.script({ tool: "local_exec", args: { command: "git status", description: "Check status" } }, { text: "Status one." });
		await h.send("Check the status");
		await card().waitFor();
		await card().getByRole("button", { name: "Always allow" }).click();
		const scopes = card().getByRole("group", { name: "Always allow" });
		await expect.poll(() => scopes.locator("code").allTextContents()).toEqual(["git status", "git status *"]);
		await h.shot("02-always-allow-scopes");
		await scopes.getByRole("button", { name: "Save rule and allow" }).click();
		await h.page().locator(".transcript").getByText("Status one.").waitFor();

		h.model.script({ tool: "local_exec", args: { command: "git status", description: "Check again" } }, { text: "Status two." });
		await h.send("Check it again");
		await h.page().locator(".tool-card.tool-succeeded", { hasText: "Check again" }).waitFor();
		await h.page().locator(".transcript").getByText("Status two.").waitFor();
		expect(await card().count()).toBe(0);
		await h.shot("03-ran-without-card");

		await h.page().getByRole("button", { name: /^Settings/ }).click();
		const rules = h.page().getByRole("list", { name: "Command rules" });
		await rules.getByText("git status", { exact: true }).waitFor();
		await h.shot("04-rule-in-settings");
		await rules.getByRole("button", { name: "Delete rule git status" }).click();
		await rules.getByText(/No rules yet/).waitFor();
		await openBot("Warden");

		h.model.script({ tool: "local_exec", args: { command: "git status", description: "Check a third time" } }, { text: "Status three." });
		await h.send("And once more");
		await card().waitFor();
		await h.shot("05-card-back");
		await card().getByRole("button", { name: "Allow once" }).click();
		await h.page().locator(".transcript").getByText("Status three.").waitFor();
	});
});
