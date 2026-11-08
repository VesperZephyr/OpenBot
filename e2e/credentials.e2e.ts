/** B14e: native storage in main, explicit migration and redacted failures, using synthetic accounts only. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { Locator } from "playwright-core";
import { launchApp, type AppHarness } from "./harness.ts";
let h: AppHarness;
/**
 * Credential copy renders in the placeholder section, then again after the settings snapshot replaces that node.
 * `scrollIntoViewIfNeeded` keeps the detached node and throws instead of retrying. Scroll only once `#settings-language` exists.
 */
async function scrollSettledCredential(locator: Locator): Promise<void> {
	await h.page().locator("#settings-language").waitFor();
	await locator.waitFor();
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			await locator.scrollIntoViewIfNeeded();
			return;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (!message.includes("not attached to the DOM") || attempt === 2) throw error;
		}
	}
}
afterEach(async () => {
	await h?.close();
});
it("uses main-owned model and search keys, keeps them out of IPC projections, and survives Host and desktop restarts", async () => {
	h = await launchApp("credentials");
	const sentinel = "B14E_SYNTHETIC_MODEL_KEY";
	h.model.acceptAuthorization = (header) => header === `Bearer ${sentinel}`;
	await h.api("credentials.set", { providerId: "scripted", apiKey: sentinel });
	await h.api("credentials.set", { providerId: "search:tavily", apiKey: "B14E_SEARCH" });
	expect(await h.api("credentials.status")).toMatchObject({
		owner: "desktop-main",
		availability: "ready",
		configuredCount: 2,
		legacyCount: 0,
	});
	expect(await h.page().evaluate(() => Object.keys((window as any).openbot.methods))).not.toContain("credentials.get");
	await h.api("settings.update", { defaultModel: { provider: "scripted", modelId: "scripted" } });
	h.model.script({ text: "Broker model request complete." });
	await h.send("Reply briefly.");
	await h.page().getByText("Broker model request complete.", { exact: true }).waitFor();
	expect(h.model.authorizationChecks).toEqual([true]);
	expect(JSON.stringify(h.model.requests)).not.toContain(sentinel);
	expect(JSON.stringify(await h.api("settings.get"))).not.toContain(sentinel);
	expect(await readFile(join(h.dataDirectory, "logs/host.log"), "utf8")).not.toContain(sentinel);
	await h.crashHost();
	await h.relaunch();
	expect(await h.api("credentials.status")).toMatchObject({ configuredCount: 2 });
	await h.api("credentials.delete", { providerId: "scripted" });
	await h.api("credentials.delete", { providerId: "search:tavily" });
	expect(await h.api("credentials.status")).toMatchObject({ configuredCount: 0 });
});
it("requires explicit migration, preserves model selection and shows bilingual results", async () => {
	h = await launchApp("credential-migration", {
		prepare: async (run) => {
			await mkdir(join(run, "data"), { recursive: true });
			await writeFile(join(run, "data/credentials.json"), '["migration-model"]');
			return {};
		},
	});
	await h.app().evaluate(async ({ app }) => {
		const require = process.getBuiltinModule("module").createRequire(`${app.getAppPath()}/package.json`);
		const path = require("node:path");
		const native = require(path.join(app.getAppPath(), "out/native/keychain.node"));
		await native.access("set", process.env.OPENBOT_KEYCHAIN_SERVICE!, "migration-model", "B14E_LEGACY_SYNTHETIC");
	});
	await h.api("settings.update", { defaultModel: { provider: "scripted", modelId: "scripted" } });
	await h
		.page()
		.getByRole("button", { name: /^Settings/ })
		.click();
	// Settings swaps in a second credential section once its snapshot arrives. Wait for that section before scrolling.
	await h.page().getByRole("heading", { name: "Default model", exact: true }).waitFor();
	await scrollSettledCredential(h.page().getByRole("button", { name: "Migrate saved credentials", exact: true }));
	await h.shot("01-migration-en");
	expect(await h.api("credentials.status")).toMatchObject({ migrationRequired: 1 });
	await h.relaunch();
	expect(await h.api("credentials.status")).toMatchObject({ migrationRequired: 1 });
	await h
		.page()
		.getByRole("button", { name: /^Settings/ })
		.click();
	await h.page().getByRole("heading", { name: "Default model", exact: true }).waitFor();
	await h.page().getByRole("button", { name: "Migrate saved credentials", exact: true }).click();
	await h.page().getByText("Migrated: 1. Blocked: 0. Cleanup pending: 0.", { exact: true }).waitFor();
	expect((await h.api("settings.get")).defaultModel).toEqual({ provider: "scripted", modelId: "scripted" });
	expect(await readFile(join(h.dataDirectory, "credentials-v2.json"), "utf8")).toContain("migration-model");
	expect(await readFile(join(h.dataDirectory, "credentials.json"), "utf8")).not.toContain("migration-model");
	await h.api("settings.update", { language: "zh-CN" });
	await scrollSettledCredential(h.page().getByRole("heading", { name: "凭据存储", exact: true }));
	await h.shot("02-migration-zh");
	await h.api("credentials.delete", { providerId: "migration-model" });
});
it("reports denied native access without changing Keychain state or exposing a value", async () => {
	h = await launchApp("credential-denied", { env: { OPENBOT_TEST_KEYCHAIN_DENIED: "1" } });
	await expect(h.api("credentials.set", { providerId: "scripted", apiKey: "B14E_DENIED_SENTINEL" })).rejects.toThrow(
		"Keychain access was denied",
	);
	expect(await h.api("credentials.status")).toMatchObject({ availability: "unavailable", configuredCount: 0 });
	await h
		.page()
		.getByRole("button", { name: /^Settings/ })
		.click();
	await h.page().getByRole("heading", { name: "Settings", exact: true }).waitFor();
	await scrollSettledCredential(
		h.page().getByText("Keychain access is unavailable. Unlock your Keychain or re-enter affected credentials.", { exact: true }),
	);
	await h.shot("03-denied-en");
	expect(await h.page().locator("body").innerText()).not.toContain("B14E_DENIED_SENTINEL");
});
