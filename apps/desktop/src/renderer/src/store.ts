/**
 * Renderer state. Every Host-owned value is a snapshot fetched through the preload API and replaced by events; the
 * renderer never keeps its own copy of the transcript or settings.
 */
import type { BotSummary, ConversationSnapshot, ModelSummary, RedactedSettings } from "@openbot/protocol";
import { create } from "zustand";
import { ERROR_PREFIX, type HostState } from "../../shared/api";

export type View = { readonly kind: "bot"; readonly botId: string } | { readonly kind: "settings" } | { readonly kind: "home" };

type State = {
	host: HostState;
	bots: readonly BotSummary[];
	conversations: Readonly<Record<string, ConversationSnapshot>>;
	settings: RedactedSettings | undefined;
	models: readonly ModelSummary[];
	view: View;
	showHidden: boolean;
	notice: string | undefined;
	/** First-launch setup: `undefined` until the first roster and settings arrive, then decided once. */
	onboarding: boolean | undefined;
};

export const useStore = create<State>(() => ({
	host: { status: "starting" },
	bots: [],
	conversations: {},
	settings: undefined,
	models: [],
	view: { kind: "home" },
	showHidden: false,
	notice: undefined,
	onboarding: undefined,
}));

const api = window.openbot.methods;

/** Show a Host error as a notice, without the protocol code prefix. */
export function report(error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	useStore.setState({ notice: message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "").replace(ERROR_PREFIX, "") });
}

export async function refreshBots(): Promise<void> {
	useStore.setState({ bots: await api["bots.list"]({}) });
}

export async function refreshSettings(): Promise<void> {
	const [settings, models] = await Promise.all([api["settings.get"]({}), api["models.list"]({})]);
	useStore.setState({ settings, models });
}

/** Select a Bot: its conversation becomes the one the Host streams to this window, then it is fetched fresh. */
export async function openBot(botId: string): Promise<void> {
	useStore.setState({ view: { kind: "bot", botId } });
	await api["conversations.subscribe"]({ botId });
	const snapshot = await api["conversations.snapshot"]({ botId });
	useStore.setState((state) => ({ conversations: { ...state.conversations, [botId]: snapshot } }));
	await api["conversations.markRead"]({ botId });
}

export async function createBot(name: string): Promise<void> {
	const bot = await api["bots.create"]({ requestId: crypto.randomUUID(), name, role: "New Bot" });
	await refreshBots();
	await openBot(bot.botId);
}

export async function sendMessage(botId: string, text: string): Promise<void> {
	await api["messages.submit"]({ botId, requestId: crypto.randomUUID(), text });
}

export function connect(): () => void {
	const stopEvents = window.openbot.onEvent((event) => {
		switch (event.type) {
			case "bots.changed":
				void refreshBots().catch(report);
				return;
			case "conversation.updated": {
				const snapshot = event.payload;
				useStore.setState((state) => ({ conversations: { ...state.conversations, [snapshot.botId]: snapshot } }));
				const { view } = useStore.getState();
				if (view.kind === "bot" && view.botId === snapshot.botId && snapshot.live === undefined && document.hasFocus()) {
					void api["conversations.markRead"]({ botId: snapshot.botId }).catch(report);
				}
			}
		}
	});
	const stopHost = window.openbot.onHostState((host) => {
		useStore.setState({ host });
		// A restarted Host has a new event stream; reload every snapshot.
		if (host.status === "ready") void loadAll();
	});
	void window.openbot.hostState().then((host) => {
		useStore.setState({ host });
		if (host.status === "ready") void loadAll();
	});
	// A clicked notification: main showed the window, the renderer opens the Bot.
	const stopOpenBot = window.openbot.onOpenBot((botId) => void openBot(botId).catch(report));
	return () => {
		stopEvents();
		stopHost();
		stopOpenBot();
	};
}

async function loadAll(): Promise<void> {
	try {
		await Promise.all([refreshBots(), refreshSettings()]);
		const { view, onboarding, settings, bots } = useStore.getState();
		// Decided once per window: later Host restarts never interrupt or restart the flow.
		if (onboarding === undefined && settings !== undefined) useStore.setState({ onboarding: needsOnboarding(settings, bots) });
		// A restarted Host has no subscription; opening the Bot again subscribes and fetches it fresh.
		if (view.kind === "bot") await openBot(view.botId);
	} catch (error) {
		report(error);
	}
}

/**
 * First launch: no default model, no Bot, and no provider with a key or a configuration that makes it usable. A model
 * configuration file with a provider (for example one the development setup wrote) skips the setup screen.
 */
export function needsOnboarding(settings: RedactedSettings, bots: readonly BotSummary[]): boolean {
	return settings.defaultModel === undefined && bots.length === 0 && !settings.providers.some((provider) => provider.configured);
}

export { api };
