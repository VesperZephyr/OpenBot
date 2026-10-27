/**
 * The renderer-facing API. Every entry is one allowlisted Host method; the preload exposes one named function per
 * entry and main forwards only these methods. Adding a method here is the only way to reach the Host from the renderer.
 */
import type { GrantAccess, HostMethod, HostParams, HostResult } from "@openbot/protocol";

export const RENDERER_METHODS = [
	"files.list",
	"files.read",
	"artifacts.list",
	"artifacts.read",
	"routines.list",
	"routines.get",
	"routines.change",
	"routines.test",
	"routines.stop",
	"routines.activity",
	"routines.presence",
	"observation.wait",
	"artifacts.get",
	"connectors.list",
	"connectors.install",
	"connectors.connect",
	"connectors.disconnect",
	"connectors.remove",
	"connectors.credential.set",
	"connectors.credential.delete",
	"skills.list",
	"skills.get",
	"skills.save",
	"skills.delete",
	"artifacts.preview",
	"artifacts.remove",
	"collaboration.stop",
	"lifecycle.get",
	"lifecycle.pause",
	"lifecycle.resume",
	"runs.continue",
	"collaboration.stop",
	"groups.list",
	"groups.snapshot",
	"groups.change",
	"groups.send",
	"host.status",
	"bots.list",
	"bots.avatar.get",
	"bots.management.history",
	"bots.create",
	"bots.update",
	"conversations.snapshot",
	"conversations.list",
	"conversations.search",
	"conversations.markRead",
	"messages.submit",
	"runs.cancel",
	"background.stop",
	"approvals.decide",
	"usage.get",
	"settings.get",
	"settings.update",
	"models.list",
	"credentials.status",
	"credentials.migrate",
	"credentials.set",
	"credentials.delete",
	"bots.memory.get",
	"memory.shared.get",
	"memory.shared.update",
	"memory.shared.restore",
	"bots.memory.note",
	"bots.memory.source",
	"bots.memory.update",
	"bots.memory.restore",
	"conversations.reset",
	"policy.get",
	"policy.update",
	"policy.rules.delete",
	"policy.ask.create",
	"policy.ask.delete",
	"policy.reconcile",
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

export type ReaderBrowserState = {
	id: string;
	url: string;
	title: string;
	loading: boolean;
	canGoBack: boolean;
	canGoForward: boolean;
	error?: string;
	closed?: boolean;
};
export type OpenBotApi = {
	reloadAfterRestore(): Promise<void>;
	readonly backup: (action: "export" | "restore") => Promise<import("@openbot/protocol").BackupResult | null>;
	readonly readerOpen: (url: string) => Promise<ReaderBrowserState>;
	readonly readerAction: (
		id: string,
		action: "navigate" | "back" | "forward" | "reload" | "state" | "focus",
		url?: string,
	) => Promise<ReaderBrowserState>;
	readonly readerBounds: (id: string, bounds: { x: number; y: number; width: number; height: number; zoom: number }) => Promise<void>;
	readonly readerClose: (id: string) => Promise<void>;
	readonly onReaderState: (listener: (state: ReaderBrowserState) => void) => () => void;
	readonly openFile: () => Promise<(import("@openbot/protocol").ReaderFile & { selectionId: string }) | null>;
	readonly previewHtml: (html: string) => Promise<string>;
	readonly closeHtmlPreview: (url: string) => Promise<void>;
	readonly pickAvatar: () => Promise<import("@openbot/protocol").AvatarUpload | null>;
	readonly attachFiles: () => Promise<{ attachments: readonly import("@openbot/protocol").ArtifactRef[]; errors: readonly string[] }>;
	readonly exportArtifact: (params: { artifactId: string; requestId: string }) => Promise<boolean>;
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
	backup: "openbot:backup",
	reloadAfterRestore: "openbot:reload-after-restore",
	readerOpen: "openbot:reader-open",
	readerAction: "openbot:reader-action",
	readerBounds: "openbot:reader-bounds",
	readerClose: "openbot:reader-close",
	readerState: "openbot:reader-state",
	openFile: "openbot:open-file",
	previewHtml: "openbot:preview-html",
	closeHtmlPreview: "openbot:close-html-preview",
	pickAvatar: "openbot:pick-avatar",
	attachFiles: "openbot:attach-files",
	exportArtifact: "openbot:export-artifact",
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
