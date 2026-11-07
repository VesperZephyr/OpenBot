import { resetHistory } from "./history-cache";
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
	ModelApi,
	ModelRef,
	ModelSummary,
	RedactedSettings,
} from "@openbot/protocol";
import { create } from "zustand";
import { composers } from "./useComposer";
import { readHostError, type HostState } from "../../shared/api";
import { setDetailsOpen } from "./features/details/details-open";
import { identityConfirmSurfaceMounted, requestIdentityClose, retainIdentityDrafts } from "./features/details/identity-draft";
import { hostCalls } from "./host-calls";
import {
	beginSettingsClose,
	isChatView,
	isSettingsView,
	restoreDescribedFocus,
	retainSettingsFocus,
	settingsEscapeCloses,
	settingsFocusLost,
	shouldRestoreSettingsFocus,
	type FocusDescriptor,
	type FocusSource,
	type SettingsEscapeEvent,
} from "./settings-page";

export type TaskView = {readonly kind:"tasks"; readonly botId:string; readonly taskId?:string; readonly draftId?:string; readonly archived?:boolean; readonly cursor?:string};
export type View =
 | TaskView
	| { readonly kind: "group"; readonly groupId: string }
	| { readonly kind: "bot"; readonly botId: string }
	| { readonly kind: "settings" }
 | { readonly kind:"skills" }
 | {readonly kind:"connectors"}
 | {readonly kind:"routines"; readonly botId?:string; readonly proposal?:import("@openbot/protocol").RoutineProposal; readonly groupId?:string; readonly routineId?:string; readonly occurrenceId?:string}
	| { readonly kind: "home" };

export type SearchTarget = { taskId?:string; conversationKey: ConversationKey; messageId: string; nonce: string };

type State = {
 tasks: {tasks:readonly import("@openbot/protocol").LocalTaskCard[];next?:string}|undefined;
 task:import("@openbot/protocol").LocalTaskSnapshot|undefined;
 historyRevision:number;
 routines:import("@openbot/protocol").RoutineList|undefined;
 connectors:readonly import("@openbot/protocol").ConnectorProfile[]|undefined;
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
	/** Last bot, group, home, or tasks view. Settings pages return here. */
	lastChat: View;
	showHidden: boolean;
	notice: string | undefined;
	/** First-launch setup: `undefined` until the first roster and settings arrive, then decided once. */
	onboarding: boolean | undefined;
};

function restoredTaskView(): TaskView | undefined {
 try { const view = JSON.parse(localStorage.getItem("openbot.task-view.v1") ?? "null"); if (view?.kind === "tasks" && typeof view.botId === "string" && [view.taskId,view.draftId].every(id=>id===undefined||typeof id==="string")) return view; } catch { /* A stale selection must not prevent opening the app. */ }
}
const initialView = restoredTaskView() ?? { kind: "home" as const };
export const useStore = create<State>(() => ({
 tasks:undefined,task:undefined,
 historyRevision:0,
 routines:undefined,
	connectors:undefined,
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
	view: initialView,
	lastChat: initialView,
	showHidden: false,
	notice: undefined,
	onboarding: undefined,
}));

useStore.subscribe((state, previous) => {
	if (state.view === previous.view) return;
	if (isChatView(state.view) && state.lastChat !== state.view) useStore.setState({ lastChat: state.view });
	retainSettingsFocus(previous.view, state.view, focusSource(document.activeElement), focusRoots());
});

const api = hostCalls(window.openbot.methods);
window.openbotCalls = api;

/** Strip IPC and protocol envelopes so application errors can be translated at the display boundary. */
export function errorMessage(error: unknown): string {
	return readHostError(error).message;
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
		retainIdentityDrafts(bots.map((bot) => bot.botId));
		for (const key of Object.keys(composers.snapshot()))
			if (key.startsWith("bot:") && !bots.some((b) => b.botId === key.slice(4))) composers.remove(key as `bot:${string}`);
		useStore.setState({ bots });
	},
);
const settingsRead = new LatestRead(
	async () => {
		// Read settings first, then the catalog. The two calls both reload the model file; running them together can
		// publish a configured provider whose model is not in the list yet.
		const settings = await api["settings.get"]({});
		const models = await api["models.list"]({});
		return { settings, models };
	},
	(value) => useStore.setState(value),
);
const conversationRead = new LatestRead(
	async () => {
		const view = useStore.getState().view;
		await api["conversations.subscribe"]({ botId: view.kind === "bot" ? view.botId : null });
		return view.kind === "bot" ? await api["conversations.snapshot"]({ botId: view.botId, history:"omit" }) : undefined;
	},
	(snapshot) => {
		const view = useStore.getState().view;
		if (snapshot && view.kind === "bot" && view.botId === snapshot.botId)
			useStore.setState(() => ({ conversations: { [snapshot.botId]: snapshot } }));
	},
);
const groupRead = new LatestRead(
	async () => {
		const view = useStore.getState().view;
		return view.kind === "group" ? await api["groups.snapshot"]({ groupId: view.groupId, history:"omit" }) : undefined;
	},
	(snapshot) => {
		const view = useStore.getState().view;
		if (snapshot && view.kind === "group" && view.groupId === snapshot.group.groupId)
			useStore.setState(() => ({ groupSnapshots: { [view.groupId]: snapshot } }));
	},
);
const lifecycleRead = new LatestRead(
	() => api["lifecycle.get"]({}),
	(lifecycle) => useStore.setState({ lifecycle }),
);
const connectorsRead=new LatestRead(()=>api["connectors.list"]({}),connectors=>useStore.setState({connectors}));
export const refreshConnectors=()=>connectorsRead.request();
const skillsRead=new LatestRead(()=>api["skills.list"]({}),skills=>useStore.setState({skills}));
export const refreshSkills=()=>skillsRead.request();
const routinesRead=new LatestRead(()=>api["routines.list"]({}),routines=>useStore.setState({routines}));
export const refreshRoutines=()=>routinesRead.request();
const taskRead = new LatestRead(async () => {
 const view=useStore.getState().view;
 if(view.kind!=="tasks")return;
 try {return {view, ...(view.taskId ? {task:await api["tasks.get"]({taskId:view.taskId})} : !view.draftId ? {tasks:await api["tasks.list"]({archived:view.archived??false,...(view.cursor?{cursor:view.cursor}:{})})} : {})};}
 catch(error) {if(useStore.getState().view===view && view.taskId && /\[not_found\]|Task is unavailable/.test(String(error))){useStore.setState({view:{kind:"tasks",botId:view.botId}});report(error);}else throw error;}
}, value => {if(value && useStore.getState().view===value.view)useStore.setState({task:"task" in value ? value.task : undefined,tasks:"tasks" in value ? value.tasks : undefined});});
export const refreshTasks=()=>taskRead.request();
const readers = [taskRead,routinesRead,connectorsRead,skillsRead,summariesRead, groupsRead, botsRead, settingsRead, conversationRead, groupRead, lifecycleRead];
let readGeneration = 0;
function resetReads() {
 resetHistory();
	readGeneration++;
	for (const reader of readers) reader.reset();
}
export const refreshLifecycle = () => lifecycleRead.request();
export const refreshSummaries = () => summariesRead.request();
export const refreshGroups = () => groupsRead.request();
export const refreshBots = () => botsRead.request();
export const refreshSettings = () => settingsRead.request();

/** Test a model, then persist a custom provider and its key only after the test succeeds. */
export async function connectModel(
	ref: ModelRef,
	secret: string,
	custom?: { readonly id: string; readonly name: string; readonly baseUrl: string; readonly api: ModelApi },
): Promise<void> {
	const key = secret.trim();
	if (custom) {
		await api["models.addProvider"]({
			id: custom.id,
			name: custom.name,
			baseUrl: custom.baseUrl,
			api: custom.api,
			modelIds: [ref.modelId],
			verify: true,
			...(key === "" ? {} : { secret: key }),
		});
	} else {
		const tested = await api["models.test"](key === "" ? ref : { ...ref, secret: key });
		if (!tested.ok) throw new Error(tested.error ?? "Connection failed. Check your model settings.");
		if (key !== "") await api["credentials.set"]({ providerId: ref.provider, apiKey: key });
	}
	await api["settings.update"]({ defaultModel: ref });
	await refreshSettings();
}
export const refreshGroupSnapshot = () => groupRead.request();
export async function markRead(conversationKey: ConversationKey, through: number): Promise<void> {
	await api["conversations.markRead"]({ conversationKey, through });
	await refreshSummaries();
}
export type SettingsPage = "settings" | "skills" | "connectors" | "routines";

/** The user asked for the setup wizard again. */
export function holdOnboarding(): void {
	useStore.setState({ onboarding: true });
}

export function openSettings(page: SettingsPage = "settings"): void {
	const view: View =
		page === "routines" ? { kind: "routines" }
		: page === "skills" ? { kind: "skills" }
		: page === "connectors" ? { kind: "connectors" }
		: { kind: "settings" };
	useStore.setState({ view });
}

export function closeSettings(): void {
	const state = useStore.getState();
	const closed = beginSettingsClose(state.view, state.lastChat);
	if (!closed) return;
	useStore.setState({ view: closed.view });
	scheduleSettingsFocus(closed.focus, closed.view);
}

/** Escape on a settings page uses the same close as Back. Popups and dialogs keep the key. */
export function closeSettingsFromEscape(event: SettingsEscapeEvent): void {
	if (!isSettingsView(useStore.getState().view)) return;
	if (!settingsEscapeCloses(event, (selector) => document.querySelector(selector))) return;
	event.preventDefault();
	event.stopPropagation();
	closeSettings();
}

function focusSource(node: EventTarget | null): FocusSource | null {
	if (node === null || typeof node !== "object" || !("getAttribute" in node) || !("tagName" in node) || !("id" in node)) return null;
	const source = node as unknown as FocusSource;
	return typeof source.getAttribute === "function" && typeof source.tagName === "string" && typeof source.id === "string" ? source : null;
}

function focusRoots(): readonly FocusSource[] {
	return [document.body, document.documentElement].flatMap((node) => {
		const source = focusSource(node);
		return source ? [source] : [];
	});
}

let settingsFocusGeneration = 0;

function scheduleSettingsFocus(focus: FocusDescriptor | undefined, destination: View): void {
	const generation = ++settingsFocusGeneration;
	requestAnimationFrame(() => requestAnimationFrame(() => {
		if (generation !== settingsFocusGeneration) return;
		const state = useStore.getState();
		const active = focusSource(document.activeElement);
		if (!shouldRestoreSettingsFocus({
			returned: state.view === destination,
			onboarding: state.onboarding === true,
			stillOnSettings: isSettingsView(state.view),
			lost: settingsFocusLost(active, focusRoots()),
		})) return;
		restoreDescribedFocus(focus, (selector) => focusSource(document.querySelector(selector)));
	}));
}

export async function openBot(botId: string, searchTarget?: SearchTarget): Promise<void> {
	const view = useStore.getState().view;
	// Settings is not a Bot. Confirm a draft against the open Bot before close restores the previous one.
	if (view.kind === "bot" && view.botId !== botId && !requestIdentityClose(view.botId, { kind: "bot", botId }, { confirmVisible: identityConfirmSurfaceMounted() })) {
		setDetailsOpen(true);
		return;
	}
	closeSettings();
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
 let lastActivity = 0;
 const recordActivity = (event:Event) => {
  if(!event.isTrusted || !useStore.getState().windowActive || useStore.getState().host.status!=="ready" || Date.now()-lastActivity<60000)return;
  lastActivity=Date.now();void api["routines.activity"]({}).catch(report);
 };
 window.addEventListener("pointerdown",recordActivity);
 window.addEventListener("keydown",recordActivity);
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
            taskRead.reset();
            try {if(state.view.kind==="tasks")localStorage.setItem("openbot.task-view.v1",JSON.stringify(state.view));else localStorage.removeItem("openbot.task-view.v1");}catch{}
			groupRead.reset();
			if (state.host.status === "ready") void Promise.all([conversationRead.request(), groupRead.request(), taskRead.request()]).catch(report);
		}
	});
	// A clicked notification: main showed the window, the renderer opens the Bot.
	const stopOpenBot = window.openbot.onOpenBot((botId) => void openBot(botId).catch(report));
	return () => {
		stopActivity();
 window.removeEventListener("pointerdown",recordActivity);
 window.removeEventListener("keydown",recordActivity);
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
		...(changes & 8 ? [refreshSettings(), refreshLifecycle(), refreshSkills(),refreshConnectors(),refreshRoutines()] : []),
	]);
	if (generation !== readGeneration || useStore.getState().host.status !== "ready") return;
	if(changes&7)useStore.setState(s=>({historyRevision:s.historyRevision+1}));
 const { view, onboarding, settings, bots } = useStore.getState();
	// Decide once. Closing the wizard when a model becomes configured skips "Meet your first Bot"
	// and "Hello, I'm OpenBot" after Connect. The wizard dismisses itself when setup finishes.
	if (onboarding === undefined && settings) useStore.setState({ onboarding: needsOnboarding(settings, bots) });
	if(view.kind==="tasks" && !bots.some(bot=>bot.kind==="core" && bot.botId===view.botId)){const core=bots.find(bot=>bot.kind==="core");if(core)useStore.setState({view:{kind:"tasks",botId:core.botId}});}
 else if (view.kind === "home" || (view.kind === "bot" && !bots.some((bot) => bot.botId === view.botId))) {
		const core = bots.find((b) => b.kind === "core");
		if (core) await openBot(core.botId);
	} else await Promise.all([...(changes & 9 ? [refreshTasks()] : []), ...(changes & 5 ? [conversationRead.request()] : []), ...(changes & 3 ? [groupRead.request()] : [])]);
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
