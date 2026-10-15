/**
 * The renderer-facing API. Every entry is one allowlisted Host method; the preload exposes one named function per
 * entry and main forwards only these methods. Adding a method here is the only way to reach the Host from the renderer.
 */
import type { HostEvent, HostMethod, HostParams, HostResult } from "@openbot/protocol";

export const RENDERER_METHODS = [
	"host.status",
	"bots.list",
	"bots.create",
	"bots.update",
	"conversations.snapshot",
	"conversations.markRead",
	"messages.submit",
	"runs.cancel",
	"approvals.decide",
	"settings.get",
	"settings.update",
	"models.list",
	"credentials.set",
	"credentials.delete",
	"bots.memory.get",
	"bots.memory.update",
	"conversations.reset",
	"models.addProvider",
	"models.test",
	"conversations.subscribe",
	"bots.duplicate",
	"bots.delete",
] as const satisfies readonly HostMethod[];

export type RendererMethod = (typeof RENDERER_METHODS)[number];

export type HostState = { readonly status: "starting" | "ready" | "stopped"; readonly detail?: string };

export type OpenBotApi = {
	readonly methods: { readonly [M in RendererMethod]: (params: HostParams<M>) => Promise<HostResult<M>> };
	/** Subscribe to Host events; returns an unsubscribe function. */
	readonly onEvent: (listener: (event: HostEvent) => void) => () => void;
	/** Host connection state, so the UI can show a starting or stopped notice. */
	readonly onHostState: (listener: (state: HostState) => void) => () => void;
	readonly hostState: () => Promise<HostState>;
	/** Put text on the system clipboard (web clipboard access is denied by the session). */
	readonly copyText: (text: string) => Promise<void>;
	/** Show a workspace file in Finder; main asks the Host whether the path may be revealed. */
	readonly revealPath: (path: string) => Promise<void>;
	/** Main asks the renderer to open a Bot, for example after a notification was clicked. */
	readonly onOpenBot: (listener: (botId: string) => void) => () => void;
};

/** IPC channel names between preload and main. */
export const CHANNELS = {
	call: "openbot:call",
	event: "openbot:event",
	hostState: "openbot:host-state",
	getHostState: "openbot:get-host-state",
	copyText: "openbot:copy-text",
	revealPath: "openbot:reveal-path",
	openBot: "openbot:open-bot",
} as const;

/** Errors crossing the IPC boundary keep their protocol code in the message prefix, e.g. `[not_found] …`. */
export const ERROR_PREFIX = /^\[([a-z_]+)\] /;
