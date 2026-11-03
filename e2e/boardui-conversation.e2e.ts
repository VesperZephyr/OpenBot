import { afterAll, beforeAll, expect, it } from "vitest";
import { type AppHarness, launchApp } from "./harness.ts";

let h: AppHarness;
const poll = (fn: () => Promise<unknown>) => expect.poll(fn, { timeout: 15000 });

beforeAll(async () => {
	h = await launchApp("boardui-conversation");
	await h.api("settings.update", { defaultModel: { provider: "scripted", modelId: "scripted" }, language: "en" });
	await h.api("bots.create", {
		requestId: "atlas-ui",
		name: "Atlas",
		role: "Research",
		instructions: "Atlas keeps research concise.\nExample: Summarize the notes from today",
	});
	await h.page().locator(".bot-row").filter({ has: h.page().getByText("Atlas", { exact: true }) }).click();
	await h.page().getByRole("textbox", { name: "Message Atlas" }).waitFor();
}, 60000);

afterAll(async () => {
	await h?.close();
});

async function appearance(name: "Light" | "Dark" | "浅色" | "深色") {
	await h.page().getByRole("button", { name: /^Settings|^设置/ }).click();
	await h.page().getByRole("radio", { name, exact: true }).check();
	await h.page().getByRole("button", { name: /Back to chat|返回聊天/ }).click();
}

it("shows the empty conversation, detail panel and themes", async () => {
	await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1280, 820));
	const empty = h.page().locator(".empty-conversation");
	await empty.getByRole("heading", { name: "Atlas", exact: true }).waitFor();
	await empty.getByRole("button", { name: "Summarize the notes from today", exact: true }).waitFor();
	await h.page().locator(".bot-identity").getByText("Research", { exact: true }).waitFor();
	await h.page().locator(".conversation-status").getByText("Idle", { exact: true }).waitFor();
	await h.shot("01-empty-light");
	await h.shot("02-detail-light");
	await appearance("Dark");
	await h.page().locator(".conversation-status").getByText("Idle", { exact: true }).waitFor();
	await h.shot("03-empty-dark");
	await h.shot("04-detail-dark");
	await h.api("settings.update", { language: "zh-CN" });
	await h.page().locator(".conversation-status").getByText("空闲", { exact: true }).waitFor();
	await h.shot("05-empty-zh-dark");
	await appearance("浅色");
	await h.shot("06-empty-zh-light");
	await h.api("settings.update", { language: "en" });
	h.model.script({ text: "Today's notes are in three short points." });
	await empty.getByRole("button", { name: "Summarize the notes from today", exact: true }).click();
	await h.page().getByText("Today's notes are in three short points.", { exact: true }).waitFor();
	await h.shot("07-conversation-light");
	await appearance("Dark");
	await h.shot("08-conversation-dark");
	await appearance("Light");
});

it("shows a textual working indicator when motion is reduced", async () => {
	await h.page().emulateMedia({ reducedMotion: "reduce" });
	h.model.script({ text: "Still working", delayMs: 8000 });
	await h.send("Keep going");
	await h.page().getByRole("button", { name: "Stop", exact: true }).waitFor();
	await poll(() => h.page().locator(".conversation-status").textContent()).toBe("Working");
	await h.page().locator(".activity-reduced", { hasText: "Working" }).waitFor();
	await h.shot("09-working-reduced-motion");
	await h.page().getByRole("button", { name: "Stop", exact: true }).click();
	await h.page().getByRole("button", { name: "Stop", exact: true }).waitFor({ state: "hidden" });
});
