import { useEffect, useRef } from "react";
import { toggleDetails } from "../details/details-open";
import { chatEntries } from "../sidebar/Sidebar";
import { closeSettings, openBot, openSettings, report, useStore } from "../../store";
import { mapGlobalShortcut, type ChatShortcutEntry, type GlobalShortcutAction } from "./map-global-shortcut";

/** Dialogs and alertdialogs block command chords. Escape uses the wider settings-page check. */
const COMMAND_DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"]';

export type GlobalShortcutHandlers = {
	readonly openSearch: () => void;
	readonly openNewMenu: () => void;
};

function chatAt(index: number): ChatShortcutEntry | undefined {
	const entry = chatEntries(useStore.getState())[index];
	if (entry === undefined) return undefined;
	if (entry.kind === "bot") return { kind: "bot", botId: entry.bot.botId };
	return { kind: "group", groupId: entry.group.groupId };
}

function perform(action: GlobalShortcutAction, handlers: GlobalShortcutHandlers): void {
	switch (action.type) {
		case "search":
			handlers.openSearch();
			return;
		case "new-conversation":
			handlers.openNewMenu();
			return;
		case "open-settings":
			openSettings();
			return;
		case "toggle-details":
			toggleDetails();
			return;
		case "open-bot":
			void openBot(action.botId).catch(report);
			return;
		case "open-group":
			closeSettings(() => {
				useStore.setState({ view: { kind: "group", groupId: action.groupId }, searchTarget: undefined });
			});
			return;
		case "close-settings":
			closeSettings();
			return;
	}
}

/** Capture-phase Escape closes full-page Settings. Command chords stay on the window bubble listener. */
export function useGlobalShortcuts(handlers: GlobalShortcutHandlers): void {
	const handlersRef = useRef(handlers);
	handlersRef.current = handlers;
	useEffect(() => {
		const context = () => ({
			view: useStore.getState().view,
			commandDialogOpen: () => document.querySelector(COMMAND_DIALOG_SELECTOR) != null,
			escapeQuery: (selector: string) => document.querySelector(selector),
			chatAt,
		});
		const onCapture = (event: KeyboardEvent): void => {
			if (event.key !== "Escape") return;
			const decision = mapGlobalShortcut(event, context());
			if (decision.action?.type !== "close-settings") return;
			if (decision.preventDefault) event.preventDefault();
			if (decision.stopPropagation) event.stopPropagation();
			perform(decision.action, handlersRef.current);
		};
		const onBubble = (event: KeyboardEvent): void => {
			if (event.key === "Escape") return;
			const decision = mapGlobalShortcut(event, context());
			if (decision.preventDefault) event.preventDefault();
			if (decision.stopPropagation) event.stopPropagation();
			if (decision.action) perform(decision.action, handlersRef.current);
		};
		document.addEventListener("keydown", onCapture, true);
		window.addEventListener("keydown", onBubble);
		return () => {
			document.removeEventListener("keydown", onCapture, true);
			window.removeEventListener("keydown", onBubble);
		};
	}, []);
}
