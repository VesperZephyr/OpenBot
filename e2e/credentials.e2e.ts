/** B14e: native storage in main, explicit migration and redacted failures, using synthetic accounts only. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { launchApp, type AppHarness } from "./harness.ts";
let h: AppHarness;
const api = (name: string, params = {}) =>
	h.page().evaluate(({ name, params }) => (window as any).openbot.methods[name](params), { name, params });
afterEach(async () => {
	await h?.close();
});
it("uses main-owned model and search keys, keeps them out of IPC projections, and survives Host and desktop restarts", async () => {
	h = await launchApp("credentials");
	const sentinel = "B14E_SYNTHETIC_MODEL_KEY";
	h.model.acceptAuthorization = (header) => header === `Bearer ${sentinel}`;
	await api("credentials.set", { providerId: "scripted", apiKey: sentinel });
	await api("credentials.set", { providerId: "search:tavily", apiKey: "B14E_SEARCH" });
	expect(await api("credentials.status")).toMatchObject({
		owner: "desktop-main",
		availability: "ready",
		configuredCount: 2,
		legacyCount: 0,
	});
	expect(await h.page().evaluate(() => Object.keys((window as any).openbot.methods))).not.toContain("credentials.get");
	await api("settings.update", { defaultModel: { provider: "scripted", modelId: "scripted" } });
	h.model.script({ text: "Broker model request complete." });
	await h.send("Reply briefly.");
	await h.page().getByText("Broker model request complete.", { exact: true }).waitFor();
	expect(h.model.authorizationChecks).toEqual([true]);
	expect(JSON.stringify(h.model.requests)).not.toContain(sentinel);
	expect(JSON.stringify(await api("settings.get"))).not.toContain(sentinel);
	expect(await readFile(join(h.dataDirectory, "logs/host.log"), "utf8")).not.toContain(sentinel);
	await h.crashHost();
	await h.relaunch();
	expect(await api("credentials.status")).toMatchObject({ configuredCount: 2 });
	await api("credentials.delete", { providerId: "scripted" });
	await api("credentials.delete", { providerId: "search:tavily" });
	expect(await api("credentials.status")).toMatchObject({ configuredCount: 0 });
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
	await api("settings.update", { defaultModel: { provider: "scripted", modelId: "scripted" } });
	await h
		.page()
		.getByRole("button", { name: /^Settings/ })
		.click();
	await h.page().getByRole("button", { name: "Migrate saved credentials", exact: true }).scrollIntoViewIfNeeded();
	await h.shot("01-migration-en");
	expect(await api("credentials.status")).toMatchObject({ migrationRequired: 1 });
	await h.relaunch();
	expect(await api("credentials.status")).toMatchObject({ migrationRequired: 1 });
	await h
		.page()
		.getByRole("button", { name: /^Settings/ })
		.click();
	await h.page().getByRole("button", { name: "Migrate saved credentials", exact: true }).click();
	await h.page().getByText("Migrated: 1. Blocked: 0. Cleanup pending: 0.", { exact: true }).waitFor();
	expect((await api("settings.get")).defaultModel).toEqual({ provider: "scripted", modelId: "scripted" });
	expect(await readFile(join(h.dataDirectory, "credentials-v2.json"), "utf8")).toContain("migration-model");
	expect(await readFile(join(h.dataDirectory, "credentials.json"), "utf8")).not.toContain("migration-model");
	await api("settings.update", { language: "zh-CN" });
	await h.page().getByRole("heading", { name: "凭据存储", exact: true }).scrollIntoViewIfNeeded();
	await h.shot("02-migration-zh");
	await api("credentials.delete", { providerId: "migration-model" });
});
it("reports denied native access without changing Keychain state or exposing a value", async () => {
	h = await launchApp("credential-denied", { env: { OPENBOT_TEST_KEYCHAIN_DENIED: "1" } });
	await expect(api("credentials.set", { providerId: "scripted", apiKey: "B14E_DENIED_SENTINEL" })).rejects.toThrow(
		"Keychain access was denied",
	);
	expect(await api("credentials.status")).toMatchObject({ availability: "unavailable", configuredCount: 0 });
	await h
		.page()
		.getByRole("button", { name: /^Settings/ })
		.click();
	await h
		.page()
		.getByText("Keychain access is unavailable. Unlock your Keychain or re-enter affected credentials.", { exact: true })
		.scrollIntoViewIfNeeded();
	await h.shot("03-denied-en");
	expect(await h.page().locator("body").innerText()).not.toContain("B14E_DENIED_SENTINEL");
});
