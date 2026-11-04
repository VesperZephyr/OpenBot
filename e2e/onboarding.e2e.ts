/**
 * First-run wizard. Each connection case starts from step 1 after a relaunch so they do not share UI state.
 * Screenshots: e2e/.run/onboarding-steps/01-language-*.png through 04-welcome-*.png.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type AppHarness, launchApp } from "./harness.ts";

const CANARY = "sk-test-CANARY-xxx";

async function settingsKeys(app: AppHarness): Promise<string[]> {
	return Object.keys(await app.api("settings.get")).sort();
}

async function theme(app: AppHarness, mode: "light" | "dark"): Promise<void> {
	await app.page().evaluate((next) => {
		localStorage.setItem("openbot.appearance", next);
		document.documentElement.dataset.theme = next;
	}, mode);
	await app.nextFrame();
}

/** Main-process output, Host audit, recorded model requests, the page, and the supplied error text. */
async function leaks(app: AppHarness, logs: readonly string[], requests: unknown, extra: string): Promise<void> {
	const hostLog = await readFile(join(app.dataDirectory, "logs/host.log"), "utf8").catch(() => "");
	const text = await app.page().locator("body").innerText();
	const config = await readFile(join(app.run, "home", "models.json"), "utf8").catch(() => "");
	expect([hostLog, text, config, JSON.stringify(requests), logs.join("\n"), extra].join("\n")).not.toContain(CANARY);
}

it("screenshots each step, hides set up later on the last step, and can reopen the wizard", async () => {
	const h = await launchApp("onboarding-steps", { firstLaunch: true, locale: "en" });
	try {
		const page = h.page();
		const keys = await settingsKeys(h);
		await page.getByRole("heading", { name: "Welcome to OpenBot" }).waitFor();
		for (const mode of ["light", "dark"] as const) {
			await theme(h, mode);
			await h.shot(`01-language-${mode}`);
		}
		await theme(h, "light");
		await page.getByRole("button", { name: "Continue", exact: true }).click();
		await page.getByRole("heading", { name: "Connect one model" }).waitFor();
		for (const mode of ["light", "dark"] as const) {
			await theme(h, mode);
			await h.shot(`02-model-${mode}`);
		}
		await theme(h, "light");
		await page.getByRole("button", { name: "Continue without a model" }).click();
		await page.getByRole("heading", { name: "Meet your first Bot" }).waitFor();
		for (const mode of ["light", "dark"] as const) {
			await theme(h, mode);
			await h.shot(`03-bot-${mode}`);
		}
		await theme(h, "light");
		await page.getByRole("button", { name: "Looks good" }).click();
		await page.getByRole("heading", { name: "Hello, I'm OpenBot" }).waitFor();
		expect(await page.getByRole("button", { name: "Set up later" }).count()).toBe(0);
		for (const mode of ["light", "dark"] as const) {
			await theme(h, mode);
			await h.shot(`04-welcome-${mode}`);
		}
		await theme(h, "light");
		await page.getByRole("button", { name: "Go back" }).click();
		await page.getByRole("button", { name: "Go back" }).click();
		await page.getByRole("button", { name: "Go back" }).click();
		await page.getByRole("heading", { name: "Welcome to OpenBot" }).waitFor();
		await page.getByRole("button", { name: "Set up later" }).click();
		await page.getByRole("textbox", { name: "Message OpenBot" }).waitFor();
		await page.getByRole("button", { name: /^Settings/ }).click();
		await page.getByRole("button", { name: "Open the setup wizard again" }).click();
		await page.getByRole("heading", { name: "Welcome to OpenBot" }).waitFor();
		await page.getByRole("button", { name: "Set up later" }).click();
		await page.getByRole("textbox", { name: "Message OpenBot" }).waitFor();
		await h.relaunch();
		await h.page().getByRole("textbox", { name: "Message OpenBot" }).waitFor();
		expect(await h.page().getByRole("heading", { name: "Welcome to OpenBot" }).count()).toBe(0);
		expect(await settingsKeys(h)).toEqual(keys);
	} finally {
		await h.close();
	}
}, 120_000);

describe("connection", () => {
	let app: AppHarness;
	let overlay = "";
	let requestMark = 0;
	const logs: string[] = [];

	function collect(target: AppHarness): void {
		const page = target.page();
		page.on("console", (message) => logs.push(message.text()));
		page.on("pageerror", (error) => logs.push(error.message));
		const child = target.app().process();
		const take = (chunk: Buffer | string) => logs.push(String(chunk));
		child.stdout?.on("data", take);
		child.stderr?.on("data", take);
	}

	let booted = false;

	beforeAll(async () => {
		app = await launchApp("onboarding-connect", {
			firstLaunch: true,
			locale: "en",
			prepare: async (run, baseUrl) => {
				overlay = JSON.stringify({ providers: { deepseek: { baseUrl } } });
				await writeFile(join(run, "home", "models.json"), overlay);
				return {};
			},
		});
	}, 120_000);
	beforeEach(async () => {
		logs.length = 0;
		if (booted) {
			await writeFile(join(app.run, "home", "models.json"), overlay);
			await app.relaunch();
		}
		booted = true;
		app.model.clear();
		collect(app);
		for (const id of ["deepseek", "local-gateway"]) await app.api("credentials.delete", { providerId: id }).catch(() => {});
		await app.api("settings.update", { defaultModel: null });
		requestMark = app.model.requests.length;
	});
	afterAll(async () => {
		await app?.close();
	});

	async function modelStep(): Promise<void> {
		const page = app.page();
		await page.getByRole("heading", { name: "Welcome to OpenBot" }).waitFor();
		await page.getByRole("button", { name: "Continue", exact: true }).click();
		await page.getByRole("heading", { name: "Connect one model" }).waitFor();
		await page.getByRole("button", { name: /^DeepSeek/ }).click();
	}

	it("keeps the typed key after a failed connection, then clears it when asked", async () => {
		await modelStep();
		const page = app.page();
		app.model.script({ error: "invalid api key" });
		const input = page.getByLabel("API key", { exact: true });
		expect(await input.getAttribute("type")).toBe("password");
		await input.fill(CANARY);
		await page.getByRole("button", { name: "Connect", exact: true }).click();
		const alert = page.getByRole("alert");
		await alert.waitFor();
		expect(await alert.innerText()).not.toContain(CANARY);
		expect(await alert.innerText()).not.toContain("invalid api key");
		expect(await input.inputValue()).toBe(CANARY);
		expect(await page.getByText("Key saved · not tested").count()).toBe(0);
		await page.getByRole("button", { name: "Check key" }).click();
		await expect.poll(() => input.evaluate((node) => document.activeElement === node)).toBe(true);
		expect(await input.inputValue()).toBe("");
		await leaks(app, logs, app.model.requests.slice(requestMark), await alert.innerText());
	});

	it("focuses the model list when trying another model", async () => {
		await modelStep();
		const page = app.page();
		app.model.script({ error: "invalid api key" });
		const input = page.getByLabel("API key", { exact: true });
		await input.fill(CANARY);
		await page.getByRole("button", { name: "Connect", exact: true }).click();
		await page.getByRole("alert").waitFor();
		await page.getByRole("button", { name: "Try another model" }).click();
		const model = page.getByLabel("Model", { exact: true });
		await expect.poll(() => model.evaluate((node) => document.activeElement === node)).toBe(true);
		await leaks(app, logs, app.model.requests.slice(requestMark), "");
	});

	it("opens the custom provider form from a failed connection", async () => {
		await modelStep();
		const page = app.page();
		app.model.script({ error: "invalid api key" });
		await page.getByLabel("API key", { exact: true }).fill(CANARY);
		await page.getByRole("button", { name: "Connect", exact: true }).click();
		await page.getByRole("alert").waitFor();
		await page.getByRole("button", { name: "Use custom or local" }).click();
		await page.getByRole("radio", { name: /^Custom provider/ }).waitFor();
		await leaks(app, logs, app.model.requests.slice(requestMark), "");
	});

	it("leaves models.json and the model list unchanged when verify fails", async () => {
		const page = app.page();
		await page.getByRole("heading", { name: "Welcome to OpenBot" }).waitFor();
		await page.getByRole("button", { name: "Continue", exact: true }).click();
		await page.getByRole("button", { name: "More providers or a custom or local model" }).click();
		await page.getByRole("radio", { name: /^Custom provider/ }).click();
		const file = join(app.run, "home", "models.json");
		const before = await readFile(file, "utf8");
		const listed = (await app.api("models.list")).map((model: { provider: string; modelId: string }) => `${model.provider}/${model.modelId}`).sort();
		await page.getByLabel("Name", { exact: true }).fill("Local gateway");
		await page.getByLabel("Base URL", { exact: true }).fill("http://127.0.0.1:1/v1");
		await page.getByLabel("Model ID", { exact: true }).fill("nope");
		const input = page.getByLabel("API key", { exact: true });
		expect(await input.getAttribute("type")).toBe("password");
		await input.fill(CANARY);
		await page.getByRole("button", { name: "Test and continue" }).click();
		const alert = page.getByRole("alert");
		await alert.waitFor();
		expect(await alert.innerText()).not.toContain(CANARY);
		expect(await input.inputValue()).toBe(CANARY);
		expect(await readFile(file, "utf8")).toBe(before);
		expect((await app.api("models.list")).map((model: { provider: string; modelId: string }) => `${model.provider}/${model.modelId}`).sort()).toEqual(listed);
		await leaks(app, logs, app.model.requests.slice(requestMark), await alert.innerText());
	}, 90_000);

	it("connects after a failed attempt without leaving the canary in logs", async () => {
		await modelStep();
		const page = app.page();
		app.model.script({ error: "invalid api key" });
		const input = page.getByLabel("API key", { exact: true });
		await input.fill(CANARY);
		await page.getByRole("button", { name: "Connect", exact: true }).click();
		await page.getByRole("alert").waitFor();
		expect(await input.inputValue()).toBe(CANARY);
		app.model.script({ text: "OK" });
		await page.getByRole("button", { name: "Connect", exact: true }).click();
		await page.getByRole("heading", { name: "Meet your first Bot" }).waitFor();
		expect(await page.locator("input[type=password]").count()).toBe(0);
		await leaks(app, logs, app.model.requests.slice(requestMark), "");
	});
});

it("imports the built-in research template only after confirmation and then leaves the wizard", async () => {
	const app = await launchApp("onboarding-template", { firstLaunch: true, locale: "en" });
	try {
		const page = app.page();
		await page.getByRole("heading", { name: "Welcome to OpenBot" }).waitFor();
		await page.getByRole("button", { name: "Continue", exact: true }).click();
		await page.getByRole("button", { name: "Continue without a model" }).click();
		await page.getByRole("button", { name: "Looks good" }).click();
		await page.getByRole("heading", { name: "Hello, I'm OpenBot" }).waitFor();
		const models = await app.api("models.list");
		const openai = models.find((model: { provider: string }) => model.provider === "openai");
		await app.api("settings.update", { defaultModel: { provider: "openai", modelId: openai.modelId } });
		await page.getByRole("button", { name: "Review and create" }).waitFor();
		const before = (await app.api("bots.list")).length;
		await page.getByRole("button", { name: "Review and create" }).click();
		const dialog = page.getByRole("dialog", { name: "Import template", exact: true });
		await dialog.getByText("Research a question the user names.").waitFor();
		await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
		await dialog.waitFor({ state: "detached" });
		await page.getByRole("heading", { name: "Hello, I'm OpenBot" }).waitFor();
		expect(await app.api("bots.list")).toHaveLength(before);
		await page.getByRole("button", { name: "Review and create" }).click();
		await dialog.getByRole("button", { name: "Import Bot", exact: true }).click();
		await page.getByRole("textbox", { name: "Message Research" }).waitFor();
		expect(await page.getByRole("heading", { name: "Hello, I'm OpenBot" }).count()).toBe(0);
		expect(app.model.requests).toHaveLength(0);
	} finally {
		await app.close();
	}
}, 120_000);
