/**
 * The renderer-facing API. Every entry is one allowlisted Host method; the preload exposes one named function per
 * entry and main forwards only these methods. Adding a method here is the only way to reach the Host from the renderer.
 */
import type { GrantAccess, HostMethod, HostParams, HostResult } from "@openbot/protocol";

export const RENDERER_METHODS = [
	"observation.wait",
	"collaboration.stop",
	"groups.list",
	"groups.snapshot",
	"groups.change",
	"groups.send",
	"host.status",
	"bots.list",
	"bots.management.history",
	"bots.create",
	"bots.update",
	"conversations.snapshot",
	"conversations.list",
	"conversations.search",
	"conversations.markRead",
	"messages.submit",
	"runs.cancel",
	"approvals.decide",
	"usage.get",
	"settings.get",
	"settings.update",
	"models.list",
	"credentials.set",
	"credentials.delete",
	"bots.memory.get",
	"bots.memory.update",
	"bots.memory.restore",
	"conversations.reset",
	"policy.get",
	"policy.update",
	"policy.rules.delete",
	"grants.list",
	"grants.revoke",
	"grants.add",
	"models.addProvider",
	"models.test",
	"conversations.subscribe",
	"bots.duplicate",
	"bots.delete",
] as const satisfies readonly HostMethod[];

export type RendererMethod = (typeof RENDERER_METHODS)[number];

/**
 * Parameters as the renderer sends them. `grants.add` names a folder by the opaque token `pickFolder` returned; main
 * exchanges it for the path the user picked in the native dialog, so the renderer can never grant a path of its own.
 */
export type RendererParams<M extends RendererMethod> = M extends "grants.add"
	? { readonly selection: string; readonly access: GrantAccess }
	: HostParams<M>;

export type HostState = { readonly status: "starting" | "ready" | "stopped"; readonly detail?: string };

/** A folder the user picked in the native dialog: the token for `grants.add`, and the path to show. */
export type FolderSelection = { readonly selection: string; readonly path: string };

export type OpenBotApi = {
	readonly methods: { readonly [M in RendererMethod]: (params: RendererParams<M>) => Promise<HostResult<M>> };
	/** Host connection state, so the UI can show a starting or stopped notice. */
	readonly onHostState: (listener: (state: HostState) => void) => () => void;
	readonly hostState: () => Promise<HostState>;
	/** Native visibility and focus, independent of Chromium document focus. */
	readonly windowActive: () => Promise<boolean>;
	readonly onWindowActive: (listener: (active: boolean) => void) => () => void;
	/** Open the native folder picker; null when the user cancels. */
	readonly pickFolder: () => Promise<FolderSelection | null>;
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
	hostState: "openbot:host-state",
	getHostState: "openbot:get-host-state",
	getWindowActive: "openbot:get-window-active",
	windowActive: "openbot:window-active",
	pickFolder: "openbot:dialog.pickFolder",
	copyText: "openbot:copy-text",
	revealPath: "openbot:reveal-path",
	openBot: "openbot:open-bot",
} as const;

/** Errors crossing the IPC boundary keep their protocol code in the message prefix, e.g. `[not_found] …`. */
export const ERROR_PREFIX = /^\[([a-z_]+)\] /;
