import { LatestRead, observe } from "../../shared/observation";
import type { LifecycleState } from "@openbot/protocol";
/**
 * Renderer state. Every Host-owned value is a snapshot fetched through the preload API and refreshed by observation; the
 * renderer never keeps its own copy of the transcript or settings.
 */
import type {
	GroupSnapshot,
	ConversationKey,
	ConversationSummary,
	Group,
	BotSummary,
	ConversationSnapshot,
	ModelSummary,
	RedactedSettings,
} from "@openbot/protocol";
import { create } from "zustand";
import { composers } from "./useComposer";
import { ERROR_PREFIX, type HostState } from "../../shared/api";

export type View =
	| { readonly kind: "group"; readonly groupId: string }
	| { readonly kind: "bot"; readonly botId: string }
	| { readonly kind: "settings" }
 | { readonly kind:"skills" }
	| { readonly kind: "home" };

export type SearchTarget = { conversationKey: ConversationKey; messageId: string; nonce: string };

type State = {
 skills:readonly import("@openbot/protocol").SkillSummary[]|undefined;
	groupSnapshots: Readonly<Record<string, GroupSnapshot>>;
	lifecycle: LifecycleState | undefined;
	searchTarget: SearchTarget | undefined;
	host: HostState;
	windowActive: boolean;
	bots: readonly BotSummary[];
	groups: readonly Group[];
	summaries: Readonly<Record<string, ConversationSummary>>;
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
	skills:undefined,
 groupSnapshots: {},
	lifecycle: undefined,
	searchTarget: undefined,
	host: { status: "starting" },
	windowActive: false,
	bots: [],
	groups: [],
	summaries: {},
	conversations: {},
	settings: undefined,
	models: [],
	view: { kind: "home" },
	showHidden: false,
	notice: undefined,
	onboarding: undefined,
}));

const api = window.openbot.methods;

/** Strip IPC and protocol envelopes so application errors can be translated at the display boundary. */
export function errorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "").replace(ERROR_PREFIX, "");
}

export function report(error: unknown): void {
	useStore.setState({ notice: errorMessage(error) });
}

const summariesRead = new LatestRead(
	() => api["conversations.list"]({}),
	(rows) => {
		useStore.setState({ summaries: Object.fromEntries(rows.map((row) => [row.conversationKey, row])) });
	},
);
const groupsRead = new LatestRead(
	() => api["groups.list"]({}),
	(groups) => useStore.setState({ groups }),
);
const botsRead = new LatestRead(
	() => api["bots.list"]({}),
	(bots) => {
		for (const key of Object.keys(composers.snapshot()))
			if (key.startsWith("bot:") && !bots.some((b) => b.botId === key.slice(4))) composers.remove(key as `bot:${string}`);
		useStore.setState({ bots });
	},
);
const settingsRead = new LatestRead(
	async () => {
		const [settings, models] = await Promise.all([api["settings.get"]({}), api["models.list"]({})]);
		return { settings, models };
	},
	(value) => useStore.setState(value),
);
const conversationRead = new LatestRead(
	async () => {
		const view = useStore.getState().view;
		await api["conversations.subscribe"]({ botId: view.kind === "bot" ? view.botId : null });
		return view.kind === "bot" ? await api["conversations.snapshot"]({ botId: view.botId }) : undefined;
	},
	(snapshot) => {
		const view = useStore.getState().view;
		if (snapshot && view.kind === "bot" && view.botId === snapshot.botId)
			useStore.setState((s) => ({ conversations: { ...s.conversations, [snapshot.botId]: snapshot } }));
	},
);
const groupRead = new LatestRead(
	async () => {
		const view = useStore.getState().view;
		return view.kind === "group" ? await api["groups.snapshot"]({ groupId: view.groupId }) : undefined;
	},
	(snapshot) => {
		const view = useStore.getState().view;
		if (snapshot && view.kind === "group" && view.groupId === snapshot.group.groupId)
			useStore.setState((s) => ({ groupSnapshots: { ...s.groupSnapshots, [view.groupId]: snapshot } }));
	},
);
const lifecycleRead = new LatestRead(
	() => api["lifecycle.get"]({}),
	(lifecycle) => useStore.setState({ lifecycle }),
);
const skillsRead=new LatestRead(()=>api["skills.list"]({}),skills=>useStore.setState({skills}));
export const refreshSkills=()=>skillsRead.request();
const readers = [skillsRead,summariesRead, groupsRead, botsRead, settingsRead, conversationRead, groupRead, lifecycleRead];
let readGeneration = 0;
function resetReads() {
	readGeneration++;
	for (const reader of readers) reader.reset();
}
export const refreshLifecycle = () => lifecycleRead.request();
export const refreshSummaries = () => summariesRead.request();
export const refreshGroups = () => groupsRead.request();
export const refreshBots = () => botsRead.request();
export const refreshSettings = () => settingsRead.request();
export const refreshGroupSnapshot = () => groupRead.request();
export async function markRead(conversationKey: ConversationKey, through: number): Promise<void> {
	await api["conversations.markRead"]({ conversationKey, through });
	await refreshSummaries();
}
export async function openBot(botId: string, searchTarget?: SearchTarget): Promise<void> {
	useStore.setState({ view: { kind: "bot", botId }, searchTarget });
	await conversationRead.request();
}

export async function createBot(name: string): Promise<void> {
	const bot = await api["bots.create"]({ requestId: crypto.randomUUID(), name, role: "New Bot" });
	await refreshBots();
	await openBot(bot.botId);
}

export async function sendMessage(
	botId: string,
	text: string,
	requestId: string = crypto.randomUUID(),
	artifactIds?: readonly string[],
 skills?:readonly import("@openbot/protocol").SkillRef[],
): Promise<void> {
	await api["messages.submit"]({ botId, requestId, text,...(skills?.length?{skills}:{}), ...(artifactIds?.length ? { artifactIds } : {}) });
}

export function connect(): () => void {
	let activityEvent = false;
	const stopActivity = window.openbot.onWindowActive((windowActive) => {
		activityEvent = true;
		useStore.setState({ windowActive });
	});
	void window.openbot
		.windowActive()
		.then((windowActive) => {
			if (!activityEvent) useStore.setState({ windowActive });
		})
		.catch(report);
	let stopObservation: (() => void) | undefined;
	let disposed = false;
	let stateEvent = false;
	const applyHost = (host: HostState) => {
		stopObservation?.();
		resetReads();
		useStore.setState({ host });
		if (host.status === "ready")
			stopObservation = observe({
				wait: (cursor) => api["observation.wait"](cursor ? { cursor } : {}),
				changed: async (reset, changes) => {
					if (reset) resetReads();
					await loadAll(reset ? 15 : changes);
				},
				error: report,
			});
	};
	const stopHost = window.openbot.onHostState((host) => {
		stateEvent = true;
		if (!disposed) applyHost(host);
	});
	void window.openbot
		.hostState()
		.then((host) => {
			if (!disposed && !stateEvent) applyHost(host);
		})
		.catch(report);
	const stopSelection = useStore.subscribe((state, previous) => {
		if (state.view !== previous.view) {
			conversationRead.reset();
			groupRead.reset();
			if (state.host.status === "ready") void Promise.all([conversationRead.request(), groupRead.request()]).catch(report);
		}
	});
	// A clicked notification: main showed the window, the renderer opens the Bot.
	const stopOpenBot = window.openbot.onOpenBot((botId) => void openBot(botId).catch(report));
	return () => {
		stopActivity();
		disposed = true;
		stopObservation?.();
		stopSelection();
		resetReads();
		stopHost();
		stopOpenBot();
	};
}

async function loadAll(changes: number): Promise<void> {
	const generation = readGeneration;
	await Promise.all([
		...(changes & 1 ? [refreshBots()] : []),
		...(changes & 3 ? [refreshGroups(), refreshSummaries()] : []),
		...(changes & 8 ? [refreshSettings(), refreshLifecycle(), refreshSkills()] : []),
	]);
	if (generation !== readGeneration || useStore.getState().host.status !== "ready") return;
	const { view, onboarding, settings, bots } = useStore.getState();
	if (onboarding === undefined && settings) useStore.setState({ onboarding: needsOnboarding(settings, bots) });
	if (view.kind === "home" || (view.kind === "bot" && !bots.some((bot) => bot.botId === view.botId))) {
		const core = bots.find((b) => b.kind === "core");
		if (core) await openBot(core.botId);
	} else await Promise.all([...(changes & 5 ? [conversationRead.request()] : []), ...(changes & 3 ? [groupRead.request()] : [])]);
}

/**
 * First launch: no default model, no Bot, and no provider with a key or a configuration that makes it usable. A model
 * configuration file with a provider (for example one the development setup wrote) skips the setup screen.
 */
export function needsOnboarding(settings: RedactedSettings, bots: readonly BotSummary[]): boolean {
	return (
		settings.setupComplete !== true &&
		settings.defaultModel === undefined &&
		bots.every((bot) => bot.kind === "core") &&
		!settings.providers.some((provider) => provider.configured)
	);
}

export { api };
