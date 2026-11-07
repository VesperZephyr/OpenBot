import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	describeFocus,
	focusSelector,
	isSettingsView,
	resetSettingsReturn,
	restoreDescribedFocus,
	settingsEscapeCloses,
	settingsReturnFocus,
	type SettingsEscapeEvent,
} from "../src/renderer/src/settings-page.ts";

type FocusEl = {
	id: string;
	tagName: string;
	label: string;
	focused: boolean;
	getAttribute(name: string): string | null;
	focus(): void;
	closest(selector: string): unknown;
};

function element(tagName: string, label = "", id = ""): FocusEl {
	const node: FocusEl = {
		id,
		tagName,
		label,
		focused: false,
		getAttribute: (name) => (name === "aria-label" ? node.label : null),
		focus() {
			node.focused = true;
		},
		closest: () => null,
	};
	return node;
}

const body = element("BODY");
const root = element("HTML");
const chat = { kind: "bot" as const, botId: "ada" };
const pages = ["settings", "skills", "connectors", "routines"] as const;
const frames: FrameRequestCallback[] = [];
let active: FocusEl = body;
let queryResult: FocusEl | null = null;
let blocker: unknown = null;
let lastSelector = "";

function installDom(): void {
	const g = globalThis as any;
	g.window = g;
	g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
	g.openbot = { methods: {} };
	g.window.openbot = g.openbot;
	g.document = {
		body,
		documentElement: root,
		get activeElement() {
			return active;
		},
		querySelector(selector: string) {
			lastSelector = selector;
			if (selector.startsWith("#") || selector.includes("aria-label")) return queryResult;
			return blocker;
		},
	};
	g.requestAnimationFrame = (callback: FrameRequestCallback) => {
		frames.push(callback);
		return frames.length;
	};
}

function flushPaint(): void {
	const batch = frames.splice(0, frames.length);
	for (const callback of batch) callback(0);
}

function escapeEvent(patch: Partial<SettingsEscapeEvent> = {}): SettingsEscapeEvent {
	return {
		key: "Escape",
		isComposing: false,
		keyCode: 0,
		target: null,
		preventDefault() {},
		stopPropagation() {},
		...patch,
	};
}

describe("settings focus descriptor", () => {
	it("remembers a label, then focuses the remounted control instead of the original node", () => {
		const opener = element("TEXTAREA", "Message Ada");
		const described = describeFocus(opener, [body]);
		expect(described).toEqual({ id: "", tag: "textarea", label: "Message Ada" });
		expect(Object.keys(described ?? {})).toEqual(["id", "tag", "label"]);
		const remounted = element("TEXTAREA", "Message Ada");
		const match = restoreDescribedFocus(described, (selector) => (selector === 'textarea[aria-label="Message Ada"]' ? remounted : null));
		expect(match).toBe(remounted);
		expect(remounted.focused).toBe(true);
		expect(opener.focused).toBe(false);
		expect(describeFocus(element("BUTTON"), [])).toBeUndefined();
	});

	it("prefers an id selector and escapes quotes in a label", () => {
		expect(focusSelector({ id: "draft", tag: "textarea", label: "Message Ada" })).toBe("#draft");
		expect(focusSelector({ id: "", tag: "textarea", label: 'Say "hi"' })).toBe('textarea[aria-label="Say \\"hi\\""]');
	});

	it("treats the four settings pages as full pages and leaves popups their Escape", () => {
		for (const page of pages) expect(isSettingsView({ kind: page })).toBe(true);
		expect(isSettingsView(chat)).toBe(false);
		expect(settingsEscapeCloses(escapeEvent(), () => null)).toBe(true);
		expect(settingsEscapeCloses(escapeEvent(), () => ({ role: "listbox" }))).toBe(false);
		expect(settingsEscapeCloses(escapeEvent({ isComposing: true }), () => null)).toBe(false);
		expect(settingsEscapeCloses(escapeEvent({ keyCode: 229 }), () => null)).toBe(false);
		expect(settingsEscapeCloses(escapeEvent({ key: "Enter" }), () => null)).toBe(false);
		const search = element("INPUT", "Search conversations");
		search.closest = (selector) => (selector.includes("conversation-search") ? search : null);
		expect(settingsEscapeCloses(escapeEvent({ target: search }), () => null)).toBe(false);
		const reader = element("ASIDE", "Files");
		reader.closest = (selector) => (selector.includes("file-workspace") ? reader : null);
		expect(settingsEscapeCloses(escapeEvent({ target: reader }), () => null)).toBe(false);
	});
});

describe("full-page settings close", () => {
	let store: typeof import("../src/renderer/src/store.ts");

	beforeAll(async () => {
		installDom();
		store = await import("../src/renderer/src/store.ts");
	});

	beforeEach(() => {
		resetSettingsReturn();
		frames.length = 0;
		active = element("TEXTAREA", "Message Ada");
		queryResult = null;
		blocker = null;
		lastSelector = "";
		store.useStore.setState({ view: chat, onboarding: false });
	});

	for (const page of pages) {
		it(`Escape and Back from ${page} return to the chat and restore focus`, () => {
			for (const leave of ["Escape", "Back"] as const) {
				store.useStore.setState({ view: chat, onboarding: false });
				resetSettingsReturn();
				const opener = element("TEXTAREA", "Message Ada");
				active = opener;
				store.openSettings(page);
				expect(store.useStore.getState().view).toEqual({ kind: page });
				expect(store.useStore.getState().lastChat).toBe(chat);
				expect(settingsReturnFocus()).toEqual({ id: "", tag: "textarea", label: "Message Ada" });
				expect(Object.values(store.useStore.getState())).not.toContain(opener);
				const remounted = element("TEXTAREA", "Message Ada");
				if (leave === "Escape") {
					let prevented = false;
					store.closeSettingsFromEscape(escapeEvent({
						preventDefault() {
							prevented = true;
						},
					}));
					expect(prevented).toBe(true);
				} else store.closeSettings();
				expect(store.useStore.getState().view).toBe(chat);
				active = body;
				queryResult = remounted;
				flushPaint();
				flushPaint();
				expect(lastSelector).toBe('textarea[aria-label="Message Ada"]');
				expect(remounted.focused).toBe(true);
				expect(opener.focused).toBe(false);
				expect(remounted).not.toBe(opener);
			}
		});
	}

	it("opens general settings from openSettings(), which is what Cmd+, calls", () => {
		store.openSettings();
		expect(store.useStore.getState().view).toEqual({ kind: "settings" });
		expect(store.useStore.getState().lastChat).toBe(chat);
	});

	it("keeps the original chat and focus when moving between settings pages", () => {
		store.openSettings("settings");
		const remembered = settingsReturnFocus();
		active = element("BUTTON", "Routines");
		store.openSettings("routines");
		store.openSettings("skills");
		store.openSettings("connectors");
		expect(store.useStore.getState().lastChat).toBe(chat);
		expect(settingsReturnFocus()).toEqual(remembered);
		store.closeSettings();
		expect(store.useStore.getState().view).toBe(chat);
	});

	it("does not close the page when Escape belongs to a listbox or the view is already chat", () => {
		store.openSettings("settings");
		blocker = { role: "listbox" };
		let prevented = false;
		store.closeSettingsFromEscape(escapeEvent({
			preventDefault() {
				prevented = true;
			},
		}));
		expect(prevented).toBe(false);
		expect(store.useStore.getState().view).toEqual({ kind: "settings" });
		expect(settingsReturnFocus()).toEqual({ id: "", tag: "textarea", label: "Message Ada" });
		store.closeSettings();
		prevented = false;
		store.closeSettingsFromEscape(escapeEvent({
			preventDefault() {
				prevented = true;
			},
		}));
		expect(prevented).toBe(false);
		expect(store.useStore.getState().view).toBe(chat);
	});

	it("returns from a routines page opened outside openSettings", () => {
		store.useStore.setState({ view: { kind: "routines", routineId: "routine_1" } });
		expect(store.useStore.getState().lastChat).toBe(chat);
		store.closeSettings();
		expect(store.useStore.getState().view).toBe(chat);
	});

	it("does not pull focus back after the user has moved to another conversation", () => {
		store.openSettings("connectors");
		store.closeSettings();
		const row = element("BUTTON", "Bee");
		active = row;
		const elsewhere = { kind: "bot" as const, botId: "bee" };
		store.useStore.setState({ view: elsewhere });
		const remounted = element("TEXTAREA", "Message Ada");
		queryResult = remounted;
		flushPaint();
		flushPaint();
		expect(store.useStore.getState().view).toBe(elsewhere);
		expect(remounted.focused).toBe(false);
		expect(row.focused).toBe(false);
	});

	it("leaves focus where the setup wizard puts it", () => {
		store.openSettings("settings");
		store.closeSettings();
		store.holdOnboarding();
		const remounted = element("TEXTAREA", "Message Ada");
		queryResult = remounted;
		active = body;
		flushPaint();
		flushPaint();
		expect(store.useStore.getState().onboarding).toBe(true);
		expect(store.useStore.getState().view).toBe(chat);
		expect(remounted.focused).toBe(false);
	});
});
