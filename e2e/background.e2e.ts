import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AppHarness, createBot, launchApp } from "./harness.ts";

let h: AppHarness;
const headed = process.env.OPENBOT_E2E_HEADED === "1";

async function assertPresentation(): Promise<void> {
	const state = await h.app().evaluate(({ app, BrowserWindow }) => ({
		windows: BrowserWindow.getAllWindows().map((window) => ({ visible: window.isVisible(), focusable: window.isFocusable(), focused: window.isFocused() })),
		dock: app.dock?.isVisible() ?? false,
	}));
	expect(state.windows).toHaveLength(1);
	expect(state.windows[0]?.visible).toBe(headed);
	expect(state.windows[0]?.focusable).toBe(headed);
	if (!headed) {
		expect(state.windows[0]?.focused).toBe(false);
		expect(state.dock).toBe(false);
	}
}

beforeAll(async () => {
	h = await launchApp("background");
	await createBot(h, "Quiet Scout");
}, 60_000);
afterAll(async () => { await h?.close(); });

describe("desktop test presentation", () => {
	it("keeps background windows hidden across activation and relaunch", async () => {
		await assertPresentation();
		await h.app().evaluate(({ app }) => {
			app.emit("activate");
			app.emit("second-instance", {}, [], "", {});
		});
		await assertPresentation();
		await h.shot("01-background-renderer");
		await h.relaunch();
		await assertPresentation();
	});

	it("handles approvals and completion without native attention effects", async () => {
		await h.app().evaluate(({ app, Notification, powerSaveBlocker }) => {
			const state = globalThis as typeof globalThis & { testNativeEffects: string[] };
			state.testNativeEffects = [];
			// Trap regressions before they can notify or change the user's desktop.
			Notification.prototype.show = () => { state.testNativeEffects.push("notification"); };
			if (app.dock) app.dock.setBadge = () => { state.testNativeEffects.push("badge"); };
			powerSaveBlocker.start = () => { state.testNativeEffects.push("power"); return -1; };
		});
		await h.page().locator(".bot-row").filter({ has: h.page().getByText("Quiet Scout", { exact: true }) }).click();
		h.model.script({ tool: "local_exec", args: { command: "printf quiet", description: "Quiet command" } }, { text: "Quietly completed." });
		await h.send("Run a quiet command");
		await h.page().getByRole("group", { name: "Approval request" }).getByRole("button", { name: "Allow once" }).click();
		await h.page().locator(".transcript").getByText("Quietly completed.").waitFor();
		await h.page().locator(".tool-card.tool-succeeded", { hasText: "Quiet command" }).waitFor();
		await assertPresentation();
		expect(await h.app().evaluate(() => (globalThis as typeof globalThis & { testNativeEffects: string[] }).testNativeEffects)).toEqual([]);
		await h.shot("02-quiet-completion");
	});
});
