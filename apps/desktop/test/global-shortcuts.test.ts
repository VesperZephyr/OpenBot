import { describe, expect, it } from "vitest";
import {
	mapGlobalShortcut,
	type ChatShortcutEntry,
	type GlobalKeyEvent,
	type GlobalKeyTarget,
	type GlobalShortcutAction,
	type GlobalShortcutContext,
	type GlobalShortcutDecision,
} from "../src/renderer/src/features/shortcuts/map-global-shortcut.ts";

const IGNORE: GlobalShortcutDecision = { preventDefault: false, stopPropagation: false, action: null };

function key(patch: Partial<GlobalKeyEvent> = {}): GlobalKeyEvent {
	return {
		key: "",
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		isComposing: false,
		target: null,
		...patch,
	};
}

function context(patch: Partial<GlobalShortcutContext> = {}): GlobalShortcutContext {
	return {
		view: { kind: "bot" },
		commandDialogOpen: () => false,
		escapeQuery: () => null,
		chatAt: () => undefined,
		...patch,
	};
}

function field(tagName: string, closest: GlobalKeyTarget["closest"] = () => null): GlobalKeyTarget {
	return { tagName, closest };
}

function consumed(action: GlobalShortcutAction): GlobalShortcutDecision {
	return { preventDefault: true, stopPropagation: false, action };
}

describe("global shortcut mapping", () => {
	it("maps command chords from meta or ctrl, including extra modifiers", () => {
		const cases: ReadonlyArray<{ readonly event: Partial<GlobalKeyEvent>; readonly action: GlobalShortcutAction | null }> = [
			{ event: { key: "k", metaKey: true }, action: { type: "search" } },
			{ event: { key: "k", ctrlKey: true }, action: { type: "search" } },
			{ event: { key: "k", metaKey: true, ctrlKey: true }, action: { type: "search" } },
			{ event: { key: "k", metaKey: true, altKey: true }, action: { type: "search" } },
			{ event: { key: "k", metaKey: true, shiftKey: true }, action: { type: "search" } },
			{ event: { key: "k", altKey: true }, action: null },
			{ event: { key: "K", metaKey: true }, action: null },
			{ event: { key: "n", ctrlKey: true }, action: { type: "new-conversation" } },
			{ event: { key: "n", metaKey: true }, action: { type: "new-conversation" } },
			{ event: { key: "N", metaKey: true }, action: null },
			{ event: { key: ",", metaKey: true }, action: { type: "open-settings" } },
			{ event: { key: ",", ctrlKey: true }, action: { type: "open-settings" } },
			{ event: { key: "<", metaKey: true }, action: null },
			{ event: { key: "i", metaKey: true }, action: null },
			{ event: { key: "i", metaKey: true, shiftKey: true }, action: { type: "toggle-details" } },
			{ event: { key: "I", ctrlKey: true, shiftKey: true }, action: { type: "toggle-details" } },
		];
		for (const entry of cases) {
			const decision = mapGlobalShortcut(key(entry.event), context());
			expect(decision).toEqual(entry.action === null ? IGNORE : consumed(entry.action));
		}
	});

	it("consumes Cmd/Ctrl+Shift+I off a Bot without toggling details", () => {
		for (const kind of ["home", "group", "settings"]) {
			expect(mapGlobalShortcut(key({ key: "I", metaKey: true, shiftKey: true }), context({ view: { kind } }))).toEqual({
				preventDefault: true,
				stopPropagation: false,
				action: null,
			});
		}
		expect(mapGlobalShortcut(key({ key: "I", shiftKey: true }), context()).preventDefault).toBe(false);
	});

	it("ignores plain typing in input fields and still honors command chords there", () => {
		const typing = context({
			chatAt() {
				throw new Error("plain typing must not look up a chat");
			},
		});
		for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
			for (const keyName of ["k", "n", ",", "i", "1", "I"]) {
				expect(mapGlobalShortcut(key({ key: keyName, target: field(tagName) }), typing)).toEqual(IGNORE);
			}
		}
		expect(mapGlobalShortcut(key({ key: "k", target: { isContentEditable: true } }), typing)).toEqual(IGNORE);
		expect(mapGlobalShortcut(key({ key: "1", target: null }), typing)).toEqual(IGNORE);
		const textarea = field("TEXTAREA");
		expect(mapGlobalShortcut(key({ key: "k", metaKey: true, target: textarea }), context())).toEqual(consumed({ type: "search" }));
		expect(mapGlobalShortcut(key({ key: "n", ctrlKey: true, target: field("INPUT") }), context())).toEqual(
			consumed({ type: "new-conversation" }),
		);
		expect(
			mapGlobalShortcut(
				key({ key: "1", metaKey: true, target: textarea }),
				context({ chatAt: () => ({ kind: "bot", botId: "ada" }) }),
			),
		).toEqual(consumed({ type: "open-bot", botId: "ada" }));
	});

	it("switches 1–9 in the supplied chat order and ignores a missing row", () => {
		const chats: readonly ChatShortcutEntry[] = [
			{ kind: "bot", botId: "core" },
			{ kind: "group", groupId: "radar" },
			{ kind: "bot", botId: "ada" },
		];
		const asked: number[] = [];
		const listed = context({
			chatAt(index) {
				asked.push(index);
				return chats[index];
			},
		});
		expect(mapGlobalShortcut(key({ key: "1", metaKey: true }), listed).action).toEqual({ type: "open-bot", botId: "core" });
		expect(mapGlobalShortcut(key({ key: "2", ctrlKey: true }), listed).action).toEqual({ type: "open-group", groupId: "radar" });
		expect(mapGlobalShortcut(key({ key: "3", metaKey: true, ctrlKey: true }), listed).action).toEqual({ type: "open-bot", botId: "ada" });
		expect(mapGlobalShortcut(key({ key: "4", metaKey: true }), listed)).toEqual(IGNORE);
		expect(mapGlobalShortcut(key({ key: "9", ctrlKey: true }), listed)).toEqual(IGNORE);
		expect(mapGlobalShortcut(key({ key: "0", metaKey: true }), listed)).toEqual(IGNORE);
		expect(asked).toEqual([0, 1, 2, 3, 8]);
	});

	it("lets an open dialog take precedence over settings, search, and chat switching", () => {
		let lookedUp = false;
		const blocked = context({
			view: { kind: "settings" },
			commandDialogOpen: () => true,
			chatAt() {
				lookedUp = true;
				return { kind: "bot", botId: "ada" };
			},
		});
		for (const event of [
			{ key: ",", metaKey: true },
			{ key: "k", ctrlKey: true },
			{ key: "n", metaKey: true },
			{ key: "1", metaKey: true },
			{ key: "I", ctrlKey: true, shiftKey: true },
		]) {
			expect(mapGlobalShortcut(key(event), blocked)).toEqual(IGNORE);
		}
		expect(lookedUp).toBe(false);
	});

	it("closes Settings on Escape only while a settings page is open and nothing else owns the key", () => {
		let queried = false;
		expect(
			mapGlobalShortcut(
				key({ key: "Escape" }),
				context({
					view: { kind: "bot" },
					escapeQuery() {
						queried = true;
						return null;
					},
					commandDialogOpen() {
						throw new Error("Escape must not consult command-dialog state");
					},
				}),
			),
		).toEqual(IGNORE);
		expect(queried).toBe(false);
		for (const kind of ["settings", "skills", "connectors", "routines"]) {
			expect(mapGlobalShortcut(key({ key: "Escape" }), context({ view: { kind } }))).toEqual({
				preventDefault: true,
				stopPropagation: true,
				action: { type: "close-settings" },
			});
		}
		expect(mapGlobalShortcut(key({ key: "Escape" }), context({ view: { kind: "settings" }, escapeQuery: () => ({ role: "dialog" }) }))).toEqual(
			IGNORE,
		);
		expect(mapGlobalShortcut(key({ key: "Escape" }), context({ view: { kind: "settings" }, escapeQuery: () => ({ role: "listbox" }) }))).toEqual(
			IGNORE,
		);
		expect(mapGlobalShortcut(key({ key: "Escape", isComposing: true }), context({ view: { kind: "settings" } }))).toEqual(IGNORE);
		expect(mapGlobalShortcut(key({ key: "Escape", keyCode: 229 }), context({ view: { kind: "settings" } }))).toEqual(IGNORE);
	});

	it("leaves Escape to inputs, textareas, search, and the file workspace", () => {
		const search = field("INPUT", (selector) => (selector.includes("conversation-search") ? search : null));
		const reader = field("ASIDE", (selector) => (selector.includes("file-workspace") ? reader : null));
		const open = context({
			view: { kind: "settings" },
			escapeQuery() {
				throw new Error("a field that owns Escape must not ask about overlays");
			},
		});
		expect(mapGlobalShortcut(key({ key: "Escape", target: search }), open)).toEqual(IGNORE);
		expect(mapGlobalShortcut(key({ key: "Escape", target: reader }), open)).toEqual(IGNORE);
		for (const tagName of ["INPUT", "TEXTAREA"]) {
			expect(mapGlobalShortcut(key({ key: "Escape", target: field(tagName) }), open)).toEqual(IGNORE);
		}
		expect(mapGlobalShortcut(key({ key: "Escape", target: field("BUTTON") }), context({ view: { kind: "skills" } }))).toEqual({
			preventDefault: true,
			stopPropagation: true,
			action: { type: "close-settings" },
		});
	});

	it("keeps command chords available when a listbox owns Escape but a dialog does not", () => {
		const settings = context({
			view: { kind: "settings" },
			commandDialogOpen: () => false,
			escapeQuery: () => ({ role: "listbox" }),
		});
		expect(mapGlobalShortcut(key({ key: "Escape" }), settings)).toEqual(IGNORE);
		expect(mapGlobalShortcut(key({ key: "k", metaKey: true }), settings)).toEqual(consumed({ type: "search" }));
		expect(mapGlobalShortcut(key({ key: ",", ctrlKey: true }), settings)).toEqual(consumed({ type: "open-settings" }));
	});
});
