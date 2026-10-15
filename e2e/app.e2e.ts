/**
 * End-to-end: the real Electron app, Host, and executor, driven through the window. A scripted model stands in for
 * the provider so runs are free and deterministic. Every run gets fresh state under e2e/.run/ and leaves screenshots
 * there for review.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { _electron as electron, type ElectronApplication, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScriptedModel } from "./scripted-model.ts";

const repo = resolve(import.meta.dirname, "..");
const run = join(repo, "e2e", ".run");
const workspace = join(run, "workspace");
// One Keychain service per checkout, so suites in parallel worktrees never share stored keys.
const keychainService = `ai.openbot.e2e.${createHash("sha256").update(repo).digest("hex").slice(0, 8)}`;
const model = new ScriptedModel();
let app: ElectronApplication;
let page: Page;

async function shot(name: string): Promise<void> {
	await page.screenshot({ path: join(run, `${name}.png`) });
}

async function send(text: string): Promise<void> {
	const composer = page.getByRole("textbox", { name: /^Message / });
	await composer.fill(text);
	await composer.press("Enter");
}

beforeAll(async () => {
	await rm(run, { recursive: true, force: true });
	await mkdir(join(run, "home"), { recursive: true });
	await mkdir(workspace, { recursive: true });
	const baseUrl = await model.start();
	await writeFile(
		join(run, "home", "models.json"),
		JSON.stringify({
			providers: { scripted: { baseUrl, api: "openai-completions", apiKey: "test", models: [{ id: "scripted", name: "Scripted" }] } },
		}),
	);
	app = await electron.launch({
		args: [join(repo, "apps/desktop")],
		cwd: join(repo, "apps/desktop"),
		env: {
			...process.env,
			OPENBOT_DATA_DIR: join(run, "data"),
			OPENBOT_HOME: join(run, "home"),
			OPENBOT_WORKSPACE: workspace,
			OPENBOT_KEYCHAIN_SERVICE: keychainService,
		},
	});
	page = await app.firstWindow();
	await page.getByRole("heading", { name: "Meet your teammates" }).waitFor();
}, 60_000);

afterAll(async () => {
	await app?.close();
	await model.stop();
});

describe("OpenBot desktop", () => {
	it("chooses a configured model and creates a Bot", async () => {
		await page.getByRole("button", { name: /^Settings/ }).click();
		await page.locator(".settings-group select").first().selectOption("scripted/scripted");
		await expect.poll(() => page.locator(".settings-group select").first().inputValue()).toBe("scripted/scripted");
		await shot("01-settings");

		await page.getByRole("button", { name: /^New/ }).click();
		await page.getByPlaceholder("Piper").fill("Scout");
		await page.getByPlaceholder("Piper").press("Enter");
		await page.getByRole("textbox", { name: "Message Scout" }).waitFor();
	});

	it("writes in the workspace without asking and renders Markdown", async () => {
		model.script({ tool: "local_write", args: { path: "hello.md", content: "Hello from Scout\n" } }, { text: "Created **hello.md**." });
		await send("Create hello.md");
		await page.locator(".tool-card", { hasText: "Wrote" }).waitFor();
		await page.locator(".markdown strong", { hasText: "hello.md" }).waitFor();
		expect(await readFile(join(workspace, "hello.md"), "utf8")).toBe("Hello from Scout\n");
		await shot("02-write");
	});

	it("runs a command only after Allow once", async () => {
		model.script({ tool: "local_exec", args: { command: "wc -c hello.md", description: "Count bytes" } }, { text: "It is 17 bytes." });
		await send("How big is it?");
		const card = page.getByRole("group", { name: "Approval request" });
		await card.waitFor();
		await expect.poll(() => card.locator(".approval-args").textContent()).toContain("wc -c hello.md");
		await expect.poll(() => page.locator(".bot-row").first().textContent()).toContain("Needs attention");
		await shot("03-approval");

		await card.getByRole("button", { name: "Allow once" }).click();
		await page.locator(".tool-card.tool-succeeded", { hasText: "Count bytes" }).waitFor();
		await page.getByText("It is 17 bytes.").waitFor();
		expect(await page.locator(".tool-card", { hasText: "Count bytes" }).locator(".tool-output").textContent()).toContain("17");
		await shot("04-approved");
	});

	it("tells the model when the user denies a command", async () => {
		model.script({ tool: "local_exec", args: { command: "rm hello.md", description: "Delete file" } }, { text: "Understood, I left it." });
		await send("Delete it");
		const card = page.getByRole("group", { name: "Approval request" });
		await card.getByRole("button", { name: "Deny" }).click();
		await page.getByText("Understood, I left it.").waitFor();
		await page.locator(".tool-card.tool-failed", { hasText: "Delete file" }).waitFor();
		expect(await readFile(join(workspace, "hello.md"), "utf8")).toBe("Hello from Scout\n");
		const lastToolResult = JSON.stringify(model.requests.at(-1)?.messages.at(-1));
		expect(lastToolResult).toContain("denied");
		await shot("05-denied");
	});
});
