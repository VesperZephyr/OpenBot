/**
 * Applies `attention()` in main: after every `bots.changed` (and when the Host becomes ready) it fetches the roster and
 * updates the dock badge, the power assertion, and macOS notifications. Notifications show only while no OpenBot window
 * is focused; clicking one shows the window and opens that Bot.
 */
import { app, Notification, powerSaveBlocker } from "electron";
import type { BotSummary, HostEvent } from "@openbot/protocol";
import type { HostState } from "../shared/api";
import { attention } from "./attention";
import type { HostProcess } from "./host";

export type AttentionWatcherOptions = {
	readonly host: HostProcess;
	/** Whether the user is looking at OpenBot right now. */
	readonly focused: () => boolean;
	/** Show the window and open the Bot. */
	readonly openBot: (botId: string) => void;
};

export class AttentionWatcher {
	readonly #options: AttentionWatcherOptions;
	#roster: readonly BotSummary[] | undefined;
	#blocker: number | undefined;
	/** Fetches run one at a time; a change while one runs schedules exactly one more. */
	#fetching = false;
	#again = false;
	/** Notifications are kept referenced until closed; a collected Notification loses its click handler. */
	readonly #shown = new Set<Notification>();

	constructor(options: AttentionWatcherOptions) {
		this.#options = options;
	}

	onEvent(event: HostEvent): void {
		if (event.type === "bots.changed") this.#refresh();
	}

	onHostState(state: HostState): void {
		if (state.status === "ready") {
			// A new Host instance: the next roster is a fresh baseline.
			this.#roster = undefined;
			this.#refresh();
		} else if (state.status === "stopped") {
			this.#roster = undefined;
			this.#apply(0, false);
		}
	}

	stop(): void {
		this.#apply(0, false);
	}

	#refresh(): void {
		if (this.#fetching) {
			this.#again = true;
			return;
		}
		this.#fetching = true;
		void this.#options.host
			.call("bots.list", {})
			.then((roster) => {
				const result = attention(this.#roster, roster);
				this.#roster = roster;
				this.#apply(result.badge, result.keepAwake);
				if (!this.#options.focused()) for (const notice of result.notices) this.#notify(notice.botId, notice.title, notice.body);
			})
			.catch((error: unknown) => console.error("[openbot] Could not read the roster", error))
			.finally(() => {
				this.#fetching = false;
				if (this.#again) {
					this.#again = false;
					this.#refresh();
				}
			});
	}

	#apply(badge: number, keepAwake: boolean): void {
		app.dock?.setBadge(badge === 0 ? "" : String(badge));
		if (keepAwake && this.#blocker === undefined) {
			this.#blocker = powerSaveBlocker.start("prevent-app-suspension");
		} else if (!keepAwake && this.#blocker !== undefined) {
			powerSaveBlocker.stop(this.#blocker);
			this.#blocker = undefined;
		}
	}

	#notify(botId: string, title: string, body: string): void {
		if (!Notification.isSupported()) return;
		const notification = new Notification({ title, body });
		this.#shown.add(notification);
		notification.on("click", () => {
			this.#shown.delete(notification);
			this.#options.openBot(botId);
		});
		notification.on("close", () => this.#shown.delete(notification));
		notification.show();
	}
}
