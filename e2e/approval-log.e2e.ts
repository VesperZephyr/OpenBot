/**
 * An allow decision stays in the conversation that made it, including after the run ends.
 * Restart still shows that decision from the Host log. Another conversation does not show it.
 * Always allow still reads as always allow after the run ends and after restart.
 */
import { expect, it } from "vitest";
import { type AppHarness, launchApp } from "./harness.ts";

it("keeps an allowed action in that conversation after restart", async () => {
	let h: AppHarness | undefined;
	try {
		h = await launchApp("approval-log");
		await h.api("settings.update", { defaultModel: { provider: "scripted", modelId: "scripted" }, language: "en" });
		await h.api("bots.create", { requestId: "ada-approval", name: "Ada", role: "Writer", instructions: "Write clearly." });
		await h.api("bots.create", { requestId: "bee-approval", name: "Bee", role: "Editor", instructions: "Edit carefully." });
		const page = h.page();
		const row = (name: string) => page.locator(".bot-row").filter({ has: page.getByText(name, { exact: true }) });
		await row("Ada").click();
		await page.getByRole("textbox", { name: "Message Ada" }).waitFor();
		h.model.script({ tool: "local_exec", args: { command: "echo kept", description: "Keep a note" } }, { text: "The note is kept." });
		await h.send("Keep a note");
		const card = page.getByRole("group", { name: "Approval request" });
		await card.waitFor();
		await card.getByRole("button", { name: "Allow once", exact: true }).click();
		await page.getByText("The note is kept.", { exact: true }).waitFor();
		const finished = page.getByRole("group", { name: "Approval record" });
		await finished.waitFor();
		expect(await finished.innerText()).toContain("Allowed once");
		await h.relaunch();
		const reopened = h.page();
		const again = (name: string) => reopened.locator(".bot-row").filter({ has: reopened.getByText(name, { exact: true }) });
		await again("Ada").click();
		await reopened.getByRole("textbox", { name: "Message Ada" }).waitFor();
		const record = reopened.getByRole("group", { name: "Approval record" });
		await record.waitFor();
		expect(await record.innerText()).toContain("Allowed once");
		await again("Bee").click();
		await reopened.getByRole("textbox", { name: "Message Bee" }).waitFor();
		expect(await reopened.getByRole("group", { name: "Approval record" }).count()).toBe(0);
	} finally {
		await h?.close();
	}
}, 90_000);

it("keeps always allow on the record after the run ends", async () => {
	let h: AppHarness | undefined;
	try {
		h = await launchApp("approval-log-always");
		await h.api("settings.update", { defaultModel: { provider: "scripted", modelId: "scripted" }, language: "en" });
		await h.api("bots.create", { requestId: "ada-always", name: "Ada", role: "Writer", instructions: "Write clearly." });
		const page = h.page();
		const row = (name: string) => page.locator(".bot-row").filter({ has: page.getByText(name, { exact: true }) });
		await row("Ada").click();
		await page.getByRole("textbox", { name: "Message Ada" }).waitFor();
		h.model.script({ tool: "local_exec", args: { command: "echo kept", description: "Keep a note" } }, { text: "The note is kept." });
		await h.send("Keep a note");
		const card = page.getByRole("group", { name: "Approval request" });
		await card.waitFor();
		await card.getByRole("button", { name: "Always allow", exact: true }).click();
		await card.getByRole("group", { name: "Always allow" }).getByRole("button", { name: "Save rule and allow" }).click();
		await page.getByText("The note is kept.", { exact: true }).waitFor();
		const finished = page.getByRole("group", { name: "Approval record" });
		await finished.waitFor();
		expect(await finished.innerText()).toContain("Set to always allow");
		expect(await finished.innerText()).not.toContain("Allowed once");
		await h.relaunch();
		const reopened = h.page();
		await reopened.locator(".bot-row").filter({ has: reopened.getByText("Ada", { exact: true }) }).click();
		await reopened.getByRole("textbox", { name: "Message Ada" }).waitFor();
		const record = reopened.getByRole("group", { name: "Approval record" });
		await record.waitFor();
		const text = await record.innerText();
		expect(text).toContain("Set to always allow");
		expect(text).not.toContain("Allowed once");
	} finally {
		await h?.close();
	}
}, 90_000);
