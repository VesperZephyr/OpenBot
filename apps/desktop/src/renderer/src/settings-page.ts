/** Settings is a full page. These kinds replace the chat until closeSettings() returns. */
const SETTINGS_KINDS = ["settings", "skills", "connectors", "routines"] as const;
const CHAT_KINDS = ["bot", "group", "home", "tasks"] as const;

export type SettingsKind = (typeof SETTINGS_KINDS)[number];
export type ChatKind = (typeof CHAT_KINDS)[number];

export function isSettingsView(view: { readonly kind: string }): view is { readonly kind: SettingsKind } {
	return (SETTINGS_KINDS as readonly string[]).includes(view.kind);
}

export function isChatView<T extends { readonly kind: string }>(view: T): view is Extract<T, { readonly kind: ChatKind }> {
	return (CHAT_KINDS as readonly string[]).includes(view.kind);
}

/**
 * Focus is remembered as a descriptor, not a node. The settings page replaces the
 * conversation, so the control that had focus may be a new element when it closes.
 */
export type FocusDescriptor = {
	readonly id: string;
	readonly tag: string;
	readonly label: string;
};

export type FocusSource = {
	readonly id: string;
	readonly tagName: string;
	getAttribute(name: string): string | null;
	focus?(): void;
};

export type SettingsEscapeEvent = {
	readonly key: string;
	readonly isComposing: boolean;
	readonly keyCode?: number;
	readonly target: EventTarget | SettingsEscapeTarget | null;
	preventDefault(): void;
	stopPropagation(): void;
};

export type SettingsEscapeTarget = {
	closest?(selector: string): unknown;
	matches?(selector: string): boolean;
	blur?(): void;
	readonly tagName?: string;
};

/** Close the page, blur a text field, or leave the key for a popup or an open select. */
export type SettingsEscapeKind = "close" | "blur" | "ignore";

const ESCAPE_OWNED_BY = '[role="listbox"], [role="menu"], [role="dialog"], [role="alertdialog"], .dialog-backdrop';

let returnFocus: FocusDescriptor | undefined;

export function resetSettingsReturn(): void {
	returnFocus = undefined;
}

export function settingsReturnFocus(): FocusDescriptor | undefined {
	return returnFocus;
}

export function describeFocus(active: FocusSource | null, inert: readonly FocusSource[]): FocusDescriptor | undefined {
	if (active === null || inert.includes(active)) return undefined;
	const label = active.getAttribute("aria-label") ?? "";
	if (active.id === "" && label === "") return undefined;
	return { id: active.id, tag: active.tagName.toLowerCase(), label };
}

/** Entering a settings page remembers focus. Moving between those pages keeps the original descriptor. */
export function retainSettingsFocus(
	previous: { readonly kind: string },
	next: { readonly kind: string },
	active: FocusSource | null,
	inert: readonly FocusSource[],
): void {
	if (isSettingsView(previous) || !isSettingsView(next)) return;
	returnFocus = describeFocus(active, inert);
}

export function beginSettingsClose<T extends { readonly kind: string }>(
	view: T,
	lastChat: T,
): { readonly view: T; readonly focus: FocusDescriptor | undefined } | undefined {
	if (!isSettingsView(view)) return undefined;
	const focus = returnFocus;
	returnFocus = undefined;
	return { view: lastChat, focus };
}

export function focusSelector(focus: FocusDescriptor): string | undefined {
	if (focus.id !== "") return `#${escapeIdent(focus.id)}`;
	if (focus.label !== "") return `${focus.tag}[aria-label="${escapeAttr(focus.label)}"]`;
	return undefined;
}

export function restoreDescribedFocus(
	focus: FocusDescriptor | undefined,
	query: (selector: string) => FocusSource | null,
): FocusSource | undefined {
	if (!focus) return undefined;
	const selector = focusSelector(focus);
	if (selector === undefined) return undefined;
	const match = query(selector) ?? undefined;
	match?.focus?.();
	return match;
}

export function settingsFocusLost(active: FocusSource | null, inert: readonly FocusSource[]): boolean {
	return active === null || inert.includes(active);
}

export function shouldRestoreSettingsFocus(options: {
	readonly returned: boolean;
	readonly onboarding: boolean;
	readonly stillOnSettings: boolean;
	readonly lost: boolean;
}): boolean {
	return options.returned && !options.onboarding && !options.stillOnSettings && options.lost;
}

/**
 * First Escape in a text field blurs it. An open select keeps the key so its popup can collapse.
 * The next Escape, with the popup closed, uses the normal close path.
 */
export function settingsEscapeKind(event: SettingsEscapeEvent, query: (selector: string) => unknown): SettingsEscapeKind {
	if (event.key !== "Escape" || event.isComposing || event.keyCode === 229) return "ignore";
	if (targetOwnsEscape(event.target)) return "ignore";
	const tag = targetTag(event.target);
	if (tag === "INPUT" || tag === "TEXTAREA") return "blur";
	if (tag === "SELECT" && selectPopupOpen(event.target)) return "ignore";
	if (query(ESCAPE_OWNED_BY) != null) return "ignore";
	return "close";
}

/** Escape closes the settings page only when no open popup, dialog, text field, or select popup already owns it. */
export function settingsEscapeCloses(event: SettingsEscapeEvent, query: (selector: string) => unknown): boolean {
	return settingsEscapeKind(event, query) === "close";
}

export function blurSettingsEscapeTarget(target: SettingsEscapeEvent["target"]): void {
	if (target !== null && typeof target === "object" && "blur" in target && typeof target.blur === "function") target.blur();
}

function targetOwnsEscape(target: SettingsEscapeEvent["target"]): boolean {
	if (target === null || typeof target !== "object" || !("closest" in target) || typeof target.closest !== "function") return false;
	return target.closest(".conversation-search, .file-workspace") != null;
}

function targetTag(target: SettingsEscapeEvent["target"]): string {
	if (target === null || typeof target !== "object" || !("tagName" in target) || typeof target.tagName !== "string") return "";
	return target.tagName.toUpperCase();
}

function selectPopupOpen(target: SettingsEscapeEvent["target"]): boolean {
	if (target === null || typeof target !== "object" || !("matches" in target) || typeof target.matches !== "function") return false;
	try {
		return target.matches(":open");
	} catch {
		return false;
	}
}

function escapeAttr(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeIdent(value: string): string {
	return value.replace(/([^a-zA-Z0-9_-])/g, "\\$1");
}
