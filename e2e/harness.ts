/// <reference lib="dom" />
/**
 * Shared launcher for end-to-end suites. Each suite gets its own state directory under e2e/.run/<name>/ (data,
 * workspace, models.json, screenshots), a scripted model, and the real Electron app, Host, and executor.
 * `relaunch()` restarts the app on the same state, for recovery tests.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { _electron as electron, type ElectronApplication, type Page } from "playwright-core";
import { ScriptedModel } from "./scripted-model.ts";

export const repo = resolve(import.meta.dirname, "..");
// One Keychain service per checkout, so suites in parallel worktrees never share stored keys.
const keychainService = `ai.openbot.e2e.${createHash("sha256").update(repo).digest("hex").slice(0, 8)}`;

export type AppHarness = {
	readonly model: ScriptedModel;
	/** The scripted model's OpenAI-compatible base URL. */
	readonly modelBaseUrl: string;
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
	/** Simulate an unexpected Host crash, preserving the desktop session and durable pending approvals. */
	crashHost(): Promise<void>;
	close(): Promise<void>;
};

export type HarnessOptions = {
	/** Create launch fixtures after the suite directory is reset; return environment overrides for every relaunch. */
	readonly prepare?: (run: string) => Promise<Readonly<Record<string, string>>>;
	/** Extra environment for the app, for example `OPENBOT_MAX_ACTIVE_RUNS`. */
	readonly env?: Readonly<Record<string, string>>;
	/**
	 * Write no `models.json`, so the app starts as on a fresh Mac and shows the setup screen; the scripted model is then
	 * reachable at `modelBaseUrl` for the onboarding flow. By default the scripted provider is configured, which skips
	 * onboarding.
	 */
	readonly firstLaunch?: boolean;
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
	if (options.firstLaunch !== true) {
		await writeFile(
			join(run, "home", "models.json"),
			JSON.stringify({
				providers: { scripted: { baseUrl, api: "openai-completions", apiKey: "test", models: [{ id: "scripted", name: "Scripted" }] } },
			}),
		);
	}

	const preparedEnvironment = await options.prepare?.(run);
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
				OPENBOT_KEYCHAIN_SERVICE: `${keychainService}.${name}`,
				...options.env,
				...preparedEnvironment,
				OPENBOT_E2E_MODE: process.env.OPENBOT_E2E_HEADED === "1" ? "headed" : "background",
			},
		});
		page = await app.firstWindow();
		await page.locator(".sidebar").waitFor();
	};
	try {
		await start();
	} catch (error) {
		await app?.close().catch(() => {});
		await model.stop();
		throw error;
	}

	const requirePage = (): Page => {
		if (page === undefined) throw new Error("The app is not running");
		return page;
	};
	return {
		model,
		modelBaseUrl: baseUrl,
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
		crashHost: async () => {
			const lock = join(dataDirectory, "host.lock"),
				previous = Number((await readFile(lock, "utf8")).trim());
			process.kill(previous, "SIGKILL");
			const deadline = Date.now() + 20000;
			for (;;) {
				const current = Number((await readFile(lock, "utf8").catch(() => "0")).trim());
				if (current && current !== previous) break;
				if (Date.now() > deadline) throw Error("Host did not recover after the simulated crash");
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			await requirePage().evaluate(() =>
				(window as unknown as { openbot: { methods: { "host.status": (params: object) => Promise<unknown> } } }).openbot.methods[
					"host.status"
				]({}),
			);
		},

		close: async () => {
			// Delete only this suite's indexed synthetic accounts, using the same native owner identity.
			if (app)
				await app
					.evaluate(async ({ app }) => {
						const require = process.getBuiltinModule("module").createRequire(`${app.getAppPath()}/package.json`);
						const fs = require("node:fs/promises");
						const path = require("node:path");
						const service = process.env.OPENBOT_KEYCHAIN_SERVICE!;
						const data = process.env.OPENBOT_DATA_DIR!;
						if (!service.startsWith("ai.openbot.e2e.")) return;
						const native = require(path.join(app.getAppPath(), "out/native/keychain.node"));
						for (const [file, suffix] of [
							["credentials-v2.json", ".v2"],
							["credentials.json", ""],
						]) {
							const ids: string[] = await fs
								.readFile(path.join(data, file!), "utf8")
								.then(JSON.parse)
								.catch(() => []);
							if (!Array.isArray(ids) || ids.length > 256) continue;
							for (const id of ids) await native.access("delete", service + suffix, id);
						}
					})
					.catch(() => {});
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
	await page.getByRole("button", { name: /^Create new Bot/ }).click();
	await page.getByPlaceholder("Piper").fill(name);
	await page.getByPlaceholder("Piper").press("Enter");
	await page.getByRole("textbox", { name: `Message ${name}` }).waitFor();
}
