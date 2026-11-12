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
	readonly target: EventTarget | { closest?(selector: string): unknown; readonly tagName?: string } | null;
	preventDefault(): void;
	stopPropagation(): void;
};

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

/** Escape closes the settings page only when no open popup, dialog, or text field already owns it. */
export function settingsEscapeCloses(event: SettingsEscapeEvent, query: (selector: string) => unknown): boolean {
	if (event.key !== "Escape" || event.isComposing || event.keyCode === 229) return false;
	if (targetOwnsEscape(event.target)) return false;
	return query(ESCAPE_OWNED_BY) == null;
}

function targetOwnsEscape(target: SettingsEscapeEvent["target"]): boolean {
	if (target === null || typeof target !== "object") return false;
	if ("tagName" in target && typeof target.tagName === "string" && (target.tagName.toUpperCase() === "INPUT" || target.tagName.toUpperCase() === "TEXTAREA")) return true;
	if (!("closest" in target) || typeof target.closest !== "function") return false;
	return target.closest(".conversation-search, .file-workspace") != null;
}

function escapeAttr(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeIdent(value: string): string {
	return value.replace(/([^a-zA-Z0-9_-])/g, "\\$1");
}
