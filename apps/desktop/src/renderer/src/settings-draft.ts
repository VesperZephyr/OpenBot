/**
 * Routine, skill, and API-key drafts live in the page that edits them.
 * Close runs outside that page, so each editor publishes whether leaving would drop text.
 */

export type SettingsDraftSource = "routines" | "skills" | "provider-api-key" | "model-api-key" | "tavily-api-key";

const dirty = new Set<SettingsDraftSource>();
const listeners = new Set<() => void>();
let confirming = false;
let afterDiscard: (() => void) | undefined;
let bypass = false;

function publish(): void {
	for (const listener of listeners) listener();
}

export function subscribeSettingsDraft(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function settingsCloseConfirming(): boolean {
	return confirming;
}

export function setSettingsDraftDirty(source: SettingsDraftSource, value: boolean): void {
	const had = dirty.has(source);
	if (value) dirty.add(source);
	else dirty.delete(source);
	if (had === dirty.has(source)) return;
	if (dirty.size === 0) {
		confirming = false;
		afterDiscard = undefined;
	}
	publish();
}

/** False means a draft is still dirty and `retry` runs only after Discard. */
export function requestSettingsClose(retry: () => void): boolean {
	if (bypass) {
		bypass = false;
		return true;
	}
	if (dirty.size === 0) return true;
	confirming = true;
	afterDiscard = retry;
	publish();
	return false;
}

export function keepSettingsDraft(): void {
	confirming = false;
	afterDiscard = undefined;
	publish();
}

export function discardSettingsDraft(): void {
	const next = afterDiscard;
	bypass = true;
	confirming = false;
	afterDiscard = undefined;
	publish();
	try {
		next?.();
	} finally {
		bypass = false;
	}
}
