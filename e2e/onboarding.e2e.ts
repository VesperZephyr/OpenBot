/**
 * First-run wizard: each step, set-up-later, a restart that drops back to step 1, connection recovery,
 * and a canary key that must not leak.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AppHarness, launchApp, repo } from "./harness.ts";

const CANARY = "sk-test-CANARY-xxx";
const captured: string[] = [];

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

function watch(app: AppHarness): void {
	const page = app.page();
	page.on("console", (message) => captured.push(message.text()));
	page.on("pageerror", (error) => captured.push(error.message));
	const proc = app.app().process();
	proc.stdout?.on("data", (chunk: Buffer) => captured.push(chunk.toString()));
	proc.stderr?.on("data", (chunk: Buffer) => captured.push(chunk.toString()));
}

async function traceBlob(app: AppHarness): Promise<string> {
	const page = app.page();
	const hostLog = await readFile(join(app.dataDirectory, "logs/host.log"), "utf8").catch(() => "");
	const dom = await page.content();
	const text = await page.locator("body").innerText();
	const aria = await page.locator(".onboarding-wizard, body").first().ariaSnapshot().catch(() => "");
	const models = await readFile(join(app.run, "home", "models.json"), "utf8").catch(() => "");
	let audit = "";
	const files = await readdir(join(repo, "e2e/.run/audit")).catch(() => []);
	for (const file of files) {
		if (file.endsWith(".jsonl")) audit += await readFile(join(repo, "e2e/.run/audit", file), "utf8").catch(() => "");
	}
	return [hostLog, dom, text, aria, models, audit, ...captured].join("\n");
}

it("screenshots each step and restarts at the first step without new settings keys", async () => {
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
	for (const mode of ["light", "dark"] as const) {
		await theme(h, mode);
		await h.shot(`04-welcome-${mode}`);
	}
	await h.relaunch();
	await h.page().getByRole("heading", { name: "Welcome to OpenBot" }).waitFor();
	expect(await h.page().getByRole("heading", { name: "Connect one model" }).count()).toBe(0);
	expect(await settingsKeys(h)).toEqual(keys);
	} finally {
		await h.close();
	}
}, 120_000);

it("set up later from every step opens the main window and stays dismissed", async () => {
	const steps = ["language", "model", "bot", "welcome"] as const;
	for (const step of steps) {
		const app = await launchApp(`onboarding-later-${step}`, { firstLaunch: true, locale: "en" });
		try {
			const page = app.page();
			await page.getByRole("heading", { name: "Welcome to OpenBot" }).waitFor();
			if (step !== "language") await page.getByRole("button", { name: "Continue", exact: true }).click();
			if (step === "model") await page.getByRole("heading", { name: "Connect one model" }).waitFor();
			if (step === "bot" || step === "welcome") {
				await page.getByRole("button", { name: "Continue without a model" }).click();
				await page.getByRole("heading", { name: "Meet your first Bot" }).waitFor();
			}
			if (step === "welcome") {
				await page.getByRole("button", { name: "Looks good" }).click();
				await page.getByRole("heading", { name: "Hello, I'm OpenBot" }).waitFor();
			}
			await page.getByRole("button", { name: "Set up later" }).click();
			await page.getByRole("textbox", { name: "Message OpenBot" }).waitFor();
			await app.relaunch();
			await app.page().getByRole("textbox", { name: "Message OpenBot" }).waitFor();
			expect(await app.page().getByRole("heading", { name: "Welcome to OpenBot" }).count()).toBe(0);
		} finally {
			await app.close();
		}
	}
}, 180_000);

describe("connection", () => {
	let app!: AppHarness;
	beforeAll(async () => {
		app = await launchApp("onboarding-connect", { firstLaunch: true, locale: "en" });
		await writeFile(join(app.run, "home", "models.json"), JSON.stringify({ providers: { deepseek: { baseUrl: app.modelBaseUrl } } }));
		await app.relaunch();
		watch(app);
		await app.page().getByRole("heading", { name: "Welcome to OpenBot" }).waitFor();
		await app.page().getByRole("button", { name: "Continue", exact: true }).click();
		await app.page().getByRole("heading", { name: "Connect one model" }).waitFor();
	}, 120_000);
	afterAll(async () => {
		const blob = await traceBlob(app).catch(() => captured.join("\n"));
		await app.close();
		expect(blob).not.toContain(CANARY);
	});

	async function failConnection(): Promise<void> {
		const page = app.page();
		await page.getByRole("button", { name: /^DeepSeek/ }).click();
		app.model.script({ error: "private-response-sentinel" });
		const input = page.getByLabel("API key", { exact: true });
		expect(await input.getAttribute("type")).toBe("password");
		await input.fill(CANARY);
		await page.getByRole("button", { name: "Connect", exact: true }).click();
		const alert = page.getByRole("alert");
		await alert.waitFor();
		expect(await alert.innerText()).not.toContain("private-response-sentinel");
		expect(await alert.innerText()).not.toContain(CANARY);
	}

	it("clears and focuses the key after a failed connection", async () => {
		await failConnection();
		const input = app.page().getByLabel("API key", { exact: true });
		await app.page().getByRole("button", { name: "Check key" }).click();
		await expect.poll(() => input.evaluate((node) => document.activeElement === node)).toBe(true);
		expect(await input.inputValue()).toBe("");
		await failConnection();
		expect(await input.inputValue()).toBe("");
	});

	it("focuses the model list when trying another model", async () => {
		await failConnection();
		await app.page().getByRole("button", { name: "Try another model" }).click();
		const model = app.page().getByLabel("Model", { exact: true });
		await expect.poll(() => model.evaluate((node) => document.activeElement === node)).toBe(true);
	});

	it("opens the custom provider form from a failed connection", async () => {
		await failConnection();
		await app.page().getByRole("button", { name: "Use custom or local" }).click();
		await app.page().getByRole("radio", { name: /^Custom provider/ }).waitFor();
	});

	it("leaves models.json and the model list unchanged when verify fails", async () => {
		const page = app.page();
		const file = join(app.run, "home", "models.json");
		const before = await readFile(file, "utf8");
		const listed = (await app.api("models.list")).map((model: { provider: string; modelId: string }) => `${model.provider}/${model.modelId}`);
		const custom = page.getByRole("radio", { name: /^Custom provider/ });
		if (!(await custom.isVisible().catch(() => false))) await page.getByRole("button", { name: "More providers or a custom or local model" }).click();
		await custom.click();
		await page.getByLabel("Name", { exact: true }).fill("Local gateway");
		await page.getByLabel("Base URL", { exact: true }).fill("http://127.0.0.1:1/v1");
		await page.getByLabel("Model ID", { exact: true }).fill("nope");
		const input = page.getByLabel("API key", { exact: true });
		expect(await input.getAttribute("type")).toBe("password");
		await input.fill(CANARY);
		await page.getByRole("button", { name: "Test and continue" }).click();
		await page.getByRole("alert").waitFor();
		expect(await page.getByRole("alert").innerText()).not.toContain(CANARY);
		expect(await readFile(file, "utf8")).toBe(before);
		expect((await app.api("models.list")).map((model: { provider: string; modelId: string }) => `${model.provider}/${model.modelId}`).sort()).toEqual([...listed].sort());
		expect(listed.join("\n")).not.toContain("local-gateway");
	}, 90_000);

	it("retries the canary key and connects", async () => {
		const page = app.page();
		if (await page.getByRole("radio", { name: /^Custom provider/ }).isVisible().catch(() => false)) {
			await page.getByRole("button", { name: "More providers or a custom or local model" }).click();
		}
		app.model.script({ text: "OK" });
		await page.getByRole("button", { name: /^DeepSeek/ }).click();
		await page.getByLabel("API key", { exact: true }).fill(CANARY);
		await page.getByRole("button", { name: "Connect", exact: true }).click();
		await page.getByRole("heading", { name: "Meet your first Bot" }).waitFor();
		expect(await page.locator("input[type=password]").evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value))).not.toContain(CANARY);
		expect(await traceBlob(app)).not.toContain(CANARY);
	});
});

it("reviews the built-in research template and imports it only after confirmation", async () => {
	const app = await launchApp("onboarding-template", { firstLaunch: true, locale: "en" });
	try {
		const page = app.page();
		await page.getByRole("heading", { name: "Welcome to OpenBot" }).waitFor();
		await page.getByRole("button", { name: "Continue", exact: true }).click();
		await page.getByRole("button", { name: "Continue without a model" }).click();
		await page.getByRole("button", { name: "Looks good" }).click();
		await page.getByRole("heading", { name: "Hello, I'm OpenBot" }).waitFor();
		await app.api("settings.update", { defaultModel: { provider: "openai", modelId: "gpt-4o-mini" } });
		await page.getByRole("button", { name: "Review and create" }).waitFor();
		const before = (await app.api("bots.list")).length;
		await page.getByRole("button", { name: "Review and create" }).click();
		const dialog = page.getByRole("dialog", { name: "Import template", exact: true });
		await dialog.getByText("Research a question the user names.", { exact: false }).waitFor();
		await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
		await dialog.waitFor({ state: "detached" });
		expect(await app.api("bots.list")).toHaveLength(before);
		await page.getByRole("button", { name: "Review and create" }).click();
		await dialog.getByRole("button", { name: "Import Bot", exact: true }).click();
		await dialog.waitFor({ state: "detached" });
		await expect.poll(async () => (await app.api("bots.list")).some((bot: { name: string }) => bot.name === "Research")).toBe(true);
		expect(app.model.requests).toHaveLength(0);
	} finally {
		await app.close();
	}
}, 120_000);
