export type DialogCandidate = {
	readonly focusOwner: string | null;
	readonly details: boolean;
};

/** What to do with a closing dialog's opener. An owned chooser must not pull focus back while a legacy editor is open. */
export function legacyOpenerAction(activeDialog: boolean, legacyEditorOpen: boolean): "keep" | "defer" | "restore" {
	if (activeDialog) return "keep";
	if (legacyEditorOpen) return "defer";
	return "restore";
}

/** The topmost dialog is handled only when it has no focus owner. An owned dialog covers every dialog under it. */
export function activeLegacyDialog<T extends DialogCandidate>(visible: readonly T[]): T | undefined {
	const top = visible.at(-1);
	if (top === undefined || top.focusOwner !== null) return undefined;
	const legacy = visible.filter((dialog) => dialog.focusOwner === null);
	return legacy.filter((dialog) => !dialog.details).at(-1) ?? top;
}
