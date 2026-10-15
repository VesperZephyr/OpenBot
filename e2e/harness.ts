/**
 * Shared launcher for end-to-end suites. Each suite gets its own state directory under e2e/.run/<name>/ (data,
 * workspace, models.json, screenshots), a scripted model, and the real Electron app, Host, and executor.
 * `relaunch()` restarts the app on the same state, for recovery tests.
 */
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { _electron as electron, type ElectronApplication, type Page } from "playwright-core";
import { ScriptedModel } from "./scripted-model.ts";

export const repo = resolve(import.meta.dirname, "..");
// One Keychain service per checkout, so suites in parallel worktrees never share stored keys.
const keychainService = `ai.openbot.e2e.${createHash("sha256").update(repo).digest("hex").slice(0, 8)}`;

export type AppHarness = {
	readonly model: ScriptedModel;
	/** State root of this suite: data/, home/, workspace/, and screenshots. */
	readonly run: string;
	readonly dataDirectory: string;
	readonly workspace: string;
	readonly app: () => ElectronApplication;
	readonly page: () => Page;
	shot(name: string): Promise<void>;
	/** Type into the composer of the open Bot and press Enter. */
	send(text: string): Promise<void>;
	/** Close the app (clean quit) and start it again on the same state. */
	relaunch(): Promise<void>;
	close(): Promise<void>;
};

export type HarnessOptions = {
	/** Extra environment for the app, for example `OPENBOT_MAX_ACTIVE_RUNS`. */
	readonly env?: Readonly<Record<string, string>>;
};

export async function launchApp(name: string, options: HarnessOptions = {}): Promise<AppHarness> {
	const run = join(repo, "e2e", ".run", name);
	const dataDirectory = join(run, "data");
	const workspace = join(run, "workspace");
	await rm(run, { recursive: true, force: true });
	await mkdir(join(run, "home"), { recursive: true });
	await mkdir(workspace, { recursive: true });
	const model = new ScriptedModel();
	const baseUrl = await model.start();
	await writeFile(
		join(run, "home", "models.json"),
		JSON.stringify({
			providers: { scripted: { baseUrl, api: "openai-completions", apiKey: "test", models: [{ id: "scripted", name: "Scripted" }] } },
		}),
	);

	let app: ElectronApplication | undefined;
	let page: Page | undefined;
	const start = async (): Promise<void> => {
		app = await electron.launch({
			args: [join(repo, "apps/desktop")],
			cwd: join(repo, "apps/desktop"),
			env: {
				...process.env,
				OPENBOT_DATA_DIR: dataDirectory,
				OPENBOT_HOME: join(run, "home"),
				OPENBOT_WORKSPACE: workspace,
				OPENBOT_KEYCHAIN_SERVICE: keychainService,
				...options.env,
			},
		});
		page = await app.firstWindow();
		await page.locator(".sidebar").waitFor();
	};
	await start();

	const requirePage = (): Page => {
		if (page === undefined) throw new Error("The app is not running");
		return page;
	};
	return {
		model,
		run,
		dataDirectory,
		workspace,
		app: () => {
			if (app === undefined) throw new Error("The app is not running");
			return app;
		},
		page: requirePage,
		shot: async (shotName) => {
			await requirePage().screenshot({ path: join(run, `${shotName}.png`) });
		},
		send: async (text) => {
			const composer = requirePage().getByRole("textbox", { name: /^Message / });
			await composer.fill(text);
			await composer.press("Enter");
		},
		relaunch: async () => {
			await app?.close();
			await start();
		},
		close: async () => {
			await app?.close();
			app = undefined;
			page = undefined;
			await model.stop();
		},
	};
}

/** Pick the scripted model as the default and create a Bot; leaves its conversation open. */
export async function createBot(harness: AppHarness, name: string): Promise<void> {
	const page = harness.page();
	await page.getByRole("button", { name: /^Settings/ }).click();
	await page.locator(".settings-group select").first().selectOption("scripted/scripted");
	await page.waitForFunction(
		() => (document.querySelector(".settings-group select") as HTMLSelectElement | null)?.value === "scripted/scripted",
	);
	await page.getByRole("button", { name: /^New/ }).click();
	await page.getByPlaceholder("Piper").fill(name);
	await page.getByPlaceholder("Piper").press("Enter");
	await page.getByRole("textbox", { name: `Message ${name}` }).waitFor();
}
