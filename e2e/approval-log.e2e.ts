/**
 * An allow decision stays in the conversation that made it. Another conversation does not show it.
 * This fails until the renderer reads `approvals.list` for that conversation.
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
