import { isSettingsView, settingsEscapeCloses, type SettingsEscapeEvent } from "../../settings-page";

/**
 * A key event reduced to the fields the global shortcuts read.
 * Command chords use meta or ctrl. Plain typing, including in a text field, is not a shortcut.
 */
export type GlobalKeyEvent = {
	readonly key: string;
	readonly metaKey: boolean;
	readonly ctrlKey: boolean;
	readonly shiftKey: boolean;
	readonly altKey: boolean;
	readonly isComposing: boolean;
	readonly keyCode?: number;
	readonly target: EventTarget | GlobalKeyTarget | null;
};

export type GlobalKeyTarget = {
	readonly tagName?: string;
	readonly isContentEditable?: boolean;
	closest?(selector: string): unknown;
};

/** One row of the unfiltered chat list, in the order `chatEntries` already returns. */
export type ChatShortcutEntry = { readonly kind: "bot"; readonly botId: string } | { readonly kind: "group"; readonly groupId: string };

export type GlobalShortcutContext = {
	readonly view: { readonly kind: string };
	/** True when a dialog or alertdialog is open. Listboxes and backdrops do not set this. */
	readonly commandDialogOpen: () => boolean;
	readonly escapeQuery: (selector: string) => unknown;
	readonly chatAt: (index: number) => ChatShortcutEntry | undefined;
};

export type GlobalShortcutAction =
	| { readonly type: "search" }
	| { readonly type: "new-conversation" }
	| { readonly type: "open-settings" }
	| { readonly type: "toggle-details" }
	| { readonly type: "open-bot"; readonly botId: string }
	| { readonly type: "open-group"; readonly groupId: string }
	| { readonly type: "close-settings" };

export type GlobalShortcutDecision = {
	readonly preventDefault: boolean;
	readonly stopPropagation: boolean;
	readonly action: GlobalShortcutAction | null;
};

const IGNORE: GlobalShortcutDecision = { preventDefault: false, stopPropagation: false, action: null };

function consume(action: GlobalShortcutAction): GlobalShortcutDecision {
	return { preventDefault: true, stopPropagation: false, action };
}

function hasCommandModifier(event: GlobalKeyEvent): boolean {
	return event.metaKey || event.ctrlKey;
}

function asEscapeEvent(event: GlobalKeyEvent): SettingsEscapeEvent {
	return {
		key: event.key,
		isComposing: event.isComposing,
		...(typeof event.keyCode === "number" ? { keyCode: event.keyCode } : {}),
		target: event.target,
		preventDefault() {},
		stopPropagation() {},
	};
}

function mapEscape(event: GlobalKeyEvent, context: GlobalShortcutContext): GlobalShortcutDecision {
	if (!isSettingsView(context.view)) return IGNORE;
	if (!settingsEscapeCloses(asEscapeEvent(event), context.escapeQuery)) return IGNORE;
	return { preventDefault: true, stopPropagation: true, action: { type: "close-settings" } };
}

function mapDigit(event: GlobalKeyEvent, context: GlobalShortcutContext): GlobalShortcutDecision {
	const entry = context.chatAt(Number(event.key) - 1);
	if (entry === undefined) return IGNORE;
	if (entry.kind === "bot") return consume({ type: "open-bot", botId: entry.botId });
	return consume({ type: "open-group", groupId: entry.groupId });
}

/**
 * Map one keydown to the global shortcut it should run.
 * Escape is decided here and performed on the document capture listener.
 * Command chords are performed on the window bubble listener.
 */
export function mapGlobalShortcut(event: GlobalKeyEvent, context: GlobalShortcutContext): GlobalShortcutDecision {
	if (event.key === "Escape") return mapEscape(event, context);
	// No meta/ctrl: this is typing, including in a text field, not a shortcut. Chords stay global.
	if (!hasCommandModifier(event) || context.commandDialogOpen()) return IGNORE;
	if (event.key === "k") return consume({ type: "search" });
	if (event.key === "n") return consume({ type: "new-conversation" });
	if (event.key === ",") return consume({ type: "open-settings" });
	if (event.shiftKey && event.key.toLowerCase() === "i") {
		if (context.view.kind !== "bot") return { preventDefault: true, stopPropagation: false, action: null };
		return consume({ type: "toggle-details" });
	}
	if (/^[1-9]$/.test(event.key)) return mapDigit(event, context);
	return IGNORE;
}
