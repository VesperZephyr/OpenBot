/** Native selections and confirmations stay in main; data operations run in the offline Host helper. */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { BrowserWindow, dialog } from "electron";
import type { BackupRequest, BackupResult } from "@openbot/protocol";
import type { HostProcess } from "./host";
import { translate, type Language } from "../shared/i18n";
export class DesktopBackups {
	#busy = false;
	#working = false;
	#closing = false;
	#finished: Promise<void> = Promise.resolve();
	async shutdown(): Promise<void> {
		this.#closing = true;
		if (this.#working) await this.#finished;
	}
	private readonly options: {
		host: HostProcess;
		node: string;
		entry: string;
		dataDirectory: string;
		env: NodeJS.ProcessEnv;
		language: () => Language;
	};
	constructor(options: DesktopBackups["options"]) {
		this.options = options;
	}
	async idle(): Promise<void> {
		await this.#finished;
	}
	get busy() {
		return this.#working;
	}
	async recover(): Promise<void> {
		if (existsSync(join(this.options.dataDirectory, ".restore-journal.json"))) await this.#worker({ action: "recover" });
	}
	#worker(request: BackupRequest): Promise<BackupResult> {
		return new Promise((resolve, reject) => {
			const child = spawn(this.options.node, ["--disable-warning=ExperimentalWarning", this.options.entry], {
				env: { ...this.options.env, OPENBOT_DATA_DIR: this.options.dataDirectory },
				stdio: ["pipe", "pipe", "pipe"],
			});
			let out = "",
				error = "";
			child.stdout.on("data", (b) => {
				out += String(b);
				if (out.length > 16384) child.kill();
			});
			child.stderr.on("data", (b) => {
				error = (error + String(b)).slice(-4000);
			});
			child.once("error", reject);
			child.once("exit", (code) => {
				if (code !== 0) {
					reject(Error(error || "Backup maintenance failed"));
					return;
				}
				try {
					resolve(JSON.parse(out) as BackupResult);
				} catch {
					reject(Error("Invalid maintenance response"));
				}
			});
			child.stdin.on("error", () => {});
			child.stdin.end(JSON.stringify(request));
		});
	}
	async run(window: BrowserWindow, action: "export" | "restore"): Promise<BackupResult | null> {
		if (this.#busy || this.#closing) throw Error("Backup maintenance is unavailable");
		this.#busy = true;
		let finish!: () => void;
		this.#finished = new Promise((resolve) => {
			finish = resolve;
		});
		let expired = false;
		const navigated = (_event: unknown, _url: string, _inPlace: boolean, main: boolean) => {
			if (main) expired = true;
		};
		window.webContents.on("did-start-navigation", navigated);
		const checkSelection = () => {
			if (expired || this.#closing || window.isDestroyed()) throw Error("Backup selection expired");
		};
		let stopped = false;
		const t = (s: string) => translate(this.options.language(), s);
		try {
			const picked = await dialog.showOpenDialog(window, {
				title: t(action === "export" ? "Choose where to save the backup" : "Choose an OpenBot backup folder"),
				properties: action === "export" ? ["openDirectory", "createDirectory"] : ["openDirectory"],
			});
			if (picked.canceled) return null;
			checkSelection();
			if (picked.filePaths.length !== 1) throw Error("Backup selection expired");
			const confirmation = await dialog.showMessageBox(window, {
				type: "warning",
				title: t(action === "export" ? "Create backup" : "Restore backup"),
				message: t(action === "export" ? "Pause work and create a local backup?" : "Replace local OpenBot data with this backup?"),
				detail: t(
					action === "export"
						? "Running work will be interrupted. The backup contains private conversations and files without encryption. Work stays paused afterward."
						: "Running work will be interrupted. Current data is saved as a recovery backup. Credentials and workspace originals stay on this Mac. Restored work stays paused.",
				),
				buttons: [t("Cancel"), t(action === "export" ? "Create backup" : "Restore backup")],
				defaultId: 0,
				cancelId: 0,
				noLink: true,
			});
			if (confirmation.response !== 1) return null;
			checkSelection();
			this.#working = true;
			await this.options.host.call("lifecycle.pause", {});
			await this.options.host.stop();
			stopped = true;
			if (existsSync(join(this.options.dataDirectory, "host.lock")))
				throw Error("Host shutdown could not be confirmed. Restart and try again.");
			const result = await this.#worker({ action, directory: picked.filePaths[0]! });
			await this.recover();
			return result;
		} finally {
			try {
				if (stopped) {
					await this.recover();
					this.options.host.start();
					await this.options.host.call("host.status", {});
				}
			} finally {
				if (!window.isDestroyed()) window.webContents.removeListener("did-start-navigation", navigated);
				this.#busy = false;
				this.#working = false;
				finish();
			}
		}
	}
}
