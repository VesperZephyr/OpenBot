/**
 * The renderer-facing API. Every entry is one allowlisted Host method; the preload exposes one named function per
 * entry and main forwards only these methods. Adding a method here is the only way to reach the Host from the renderer.
 */
import type { GrantAccess, HostMethod, HostParams, HostResult } from "@openbot/protocol";

export const RENDERER_METHODS = [
 "tasks.create", "tasks.submit", "tasks.stop", "tasks.archive", "tasks.list", "tasks.get",
	"bots.templates.export", "bots.templates.inspect", "bots.templates.import", "bots.templates.status",
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
 "conversations.window", "conversations.detail", "conversations.indexStatus", "conversations.indexRetry",
	"conversations.list",
	"conversations.search",
	"conversations.markRead",
	"messages.submit",
	"runs.cancel",
	"background.stop",
	"approvals.decide",
	"approvals.list",
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
	"conversations.delete",
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
	pickBotTemplate(): Promise<import("@openbot/protocol").TemplateFile | null>;
	saveBotTemplate(input: {
		requestId: string;
		template: import("@openbot/protocol").BotTemplateV1;
		templateDigest: string;
	}): Promise<{ outcome: "saved" | "cancelled" }>;
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
	pickBotTemplate: "openbot:template-pick",
	saveBotTemplate: "openbot:template-save",
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
const ERROR_DETAILS = /\n\[details:(\{.*\})\]$/;

/** Serialize a Host error for Electron IPC, which keeps only `Error.message`. */
export function formatHostError(error: { readonly code: string; readonly message: string; readonly details?: { readonly currentRevision?: number } }): string {
	const suffix = error.details?.currentRevision === undefined ? "" : `\n[details:${JSON.stringify({ currentRevision: error.details.currentRevision })}]`;
	return `[${error.code}] ${error.message}${suffix}`;
}

/** Protocol `code` on the error object. IPC errors omit it and carry the same code in the message prefix. */
function structuredHostCode(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
	const code = (error as { readonly code?: unknown }).code;
	return typeof code === "string" && /^[a-z_]+$/.test(code) ? code : undefined;
}

function structuredHostRevision(error: unknown): { currentRevision: number } | undefined {
	if (typeof error !== "object" || error === null || !("details" in error)) return undefined;
	const details = (error as { readonly details?: unknown }).details;
	if (typeof details !== "object" || details === null || !("currentRevision" in details)) return undefined;
	const currentRevision = (details as { readonly currentRevision?: unknown }).currentRevision;
	return typeof currentRevision === "number" && Number.isFinite(currentRevision) ? { currentRevision } : undefined;
}

/** Read the code and `currentRevision` from a Host error. A structured `code` wins; otherwise the `[code] ` prefix does. */
export function readHostError(error: unknown): { code?: string; message: string; details?: { currentRevision: number } } {
	const raw = error instanceof Error ? error.message : String(error);
	const stripped = raw.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
	const detailsMatch = ERROR_DETAILS.exec(stripped);
	const body = detailsMatch ? stripped.slice(0, detailsMatch.index) : stripped;
	let parsedDetails: { currentRevision: number } | undefined;
	if (detailsMatch?.[1]) {
		try {
			const parsed = JSON.parse(detailsMatch[1]) as { currentRevision?: unknown };
			if (typeof parsed.currentRevision === "number" && Number.isFinite(parsed.currentRevision)) parsedDetails = { currentRevision: parsed.currentRevision };
		} catch {
			/* A malformed suffix is not a revision the form can reload. */
		}
	}
	const prefix = ERROR_PREFIX.exec(body);
	const fieldCode = structuredHostCode(error);
	const code = fieldCode ?? prefix?.[1];
	const message = prefix && (fieldCode === undefined || fieldCode === prefix[1]) ? body.slice(prefix[0].length) : body;
	const details = structuredHostRevision(error) ?? parsedDetails;
	return { ...(code ? { code } : {}), message, ...(details ? { details } : {}) };
}
