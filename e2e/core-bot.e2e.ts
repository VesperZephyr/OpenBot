import { afterAll, beforeAll, expect, it } from "vitest";
import { type AppHarness, launchApp } from "./harness.ts";
let h: AppHarness;
beforeAll(async () => { h = await launchApp("core-bot", { firstLaunch: true }); }, 90_000);
afterAll(async () => { await h?.close(); });

it("starts with only the Core, permits setup later, and protects its identity", async () => {
	const page = h.page();
	await page.getByRole("heading", { name: "Meet OpenBot" }).waitFor();
	await expect.poll(() => page.locator(".bot-row").count()).toBe(1);
	expect(await page.getByRole("button", { name: /Atlas|Forge|Quill/ }).count()).toBe(0);
	await h.shot("01-only-core");
	await page.getByRole("button", { name: "Set up later" }).click();
	await page.getByRole("textbox", { name: "Message OpenBot" }).waitFor();
	expect(h.model.requests).toHaveLength(0);
	await page.getByRole("button", { name: "•••" }).click();
	expect(await page.getByRole("menuitem", { name: /Delete|Hide|Unpin/ }).count()).toBe(0);
	await h.shot("02-protected-menu");
	const results = await page.evaluate(async () => {
		const methods = (window as any).openbot.methods;
		const [core] = await methods["bots.list"]({});
		const denied: string[] = [];
		for (const [method, params] of [
			["bots.delete", { botId: core.botId }], ["bots.update", { botId: core.botId, pinned: false }],
			["bots.update", { botId: core.botId, status: "hidden" }], ["bots.create", { requestId: "forged", name: "Other", kind: "core" }],
		]) {
			try { await methods[method as string](params); denied.push("accepted"); } catch { denied.push("denied"); }
		}
		return { coreId: core.botId, denied };
	});
	expect(results.denied).toEqual(["denied", "denied", "denied", "denied"]);
	await h.relaunch();
	await h.page().getByRole("textbox", { name: "Message OpenBot" }).waitFor();
	const reopened = await h.page().evaluate(async () => (window as any).openbot.methods["bots.list"]({}));
	expect(reopened).toHaveLength(1);
	expect(reopened[0].botId).toBe(results.coreId);
});

it("creates a Specialist only when the user requests it and keeps the Core first", async () => {
	const page = h.page();
	await page.getByRole("button", { name: /^New/ }).click();
 await page.getByRole("button", { name: /^Create new Bot/ }).click();
	await page.getByPlaceholder("Piper").fill("Research partner");
	await page.getByPlaceholder("Piper").press("Enter");
	await page.getByRole("textbox", { name: "Message Research partner" }).waitFor();
	expect(await page.locator(".bot-row").count()).toBe(2);
	expect(await page.locator(".bot-row").first().textContent()).toContain("OpenBot");
	const bots = await page.evaluate(async () => (window as any).openbot.methods["bots.list"]({}));
	expect(bots.find((b: any) => b.name === "Research partner").kind).toBe("specialist");
	await h.shot("03-user-created");
});
