// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { BotSummary } from "@openbot/protocol";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { detailsOpenSnapshot, setDetailsOpen } from "../src/renderer/src/features/details/details-open";
import {
	beginIdentityDraft,
	identityDraftSnapshot,
	patchIdentityDraft,
	resetIdentityDraft,
} from "../src/renderer/src/features/details/identity-draft";

function bot(partial: Pick<BotSummary, "botId" | "name" | "role" | "instructions">): BotSummary {
	return {
		...partial,
		revision: 1,
		kind: "specialist",
		pinned: false,
		status: "active",
		createdAt: 0,
		activity: "idle",
		pendingApprovals: 0,
	};
}

const ada = bot({ botId: "ada", name: "Ada", role: "Writer", instructions: "Write." });
const bee = bot({ botId: "bee", name: "Bee", role: "Editor", instructions: "Edit." });

const reopen = vi.fn(async () => null);
const subscribe = vi.fn(async () => null);
const snapshot = vi.fn(async () => undefined);
const listBots = vi.fn(async () => store.useStore.getState().bots);
const listConversations = vi.fn(async () => []);

let store: typeof import("../src/renderer/src/store");
let BotIdentity: typeof import("../src/renderer/src/BotIdentity").BotIdentity;
let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeAll(async () => {
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	(window as unknown as { openbot: Window["openbot"] }).openbot = { methods: {} } as Window["openbot"];
	store = await import("../src/renderer/src/store");
	({ BotIdentity } = await import("../src/renderer/src/BotIdentity"));
	const calls = store.api as unknown as Record<string, (...args: never[]) => Promise<unknown>>;
	calls["conversations.reopen"] = reopen;
	calls["conversations.subscribe"] = subscribe;
	calls["conversations.snapshot"] = snapshot;
	calls["bots.list"] = listBots;
	calls["conversations.list"] = listConversations;
});

function resetSurface(): void {
	store.setIdentityConfirmSurfaceMounted(false);
	resetIdentityDraft();
	setDetailsOpen(false);
	store.useStore.setState({
		view: { kind: "home" },
		lastChat: { kind: "home" },
		bots: [],
		summaries: {},
		searchTarget: undefined,
		notice: undefined,
	});
	reopen.mockClear();
	subscribe.mockClear();
	snapshot.mockClear();
	listBots.mockClear();
	listConversations.mockClear();
}

async function renderCard(botId: string): Promise<void> {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	await act(async () => {
		root?.render(createElement(BotIdentity, { botId, profileOpen: false }));
	});
}

async function unmountCard(): Promise<void> {
	await act(async () => root?.unmount());
	container?.remove();
	root = undefined;
	container = undefined;
}

afterEach(async () => {
	await unmountCard();
	resetSurface();
});

describe("identity confirm surface", () => {
	it("lives in the store and resets to unmounted", () => {
		expect(store.useStore.getState().identityConfirmSurfaceMounted).toBe(false);
		store.setIdentityConfirmSurfaceMounted(true);
		expect(store.useStore.getState().identityConfirmSurfaceMounted).toBe(true);
		store.setIdentityConfirmSurfaceMounted(false);
		expect(store.useStore.getState().identityConfirmSurfaceMounted).toBe(false);
	});

	it("follows the wide card through mount, a missing Bot, and unmount", async () => {
		store.useStore.setState({ bots: [ada] });
		await renderCard("ada");
		expect(store.useStore.getState().identityConfirmSurfaceMounted).toBe(true);

		await act(async () => {
			store.useStore.setState({ bots: [] });
		});
		expect(store.useStore.getState().identityConfirmSurfaceMounted).toBe(false);

		await act(async () => {
			store.useStore.setState({ bots: [ada] });
		});
		expect(store.useStore.getState().identityConfirmSurfaceMounted).toBe(true);

		await unmountCard();
		expect(store.useStore.getState().identityConfirmSurfaceMounted).toBe(false);
	});

	it("asks to discard a dirty draft before openBot while the card is mounted", async () => {
		beginIdentityDraft(ada);
		patchIdentityDraft("ada", { name: "Ada renamed" });
		store.useStore.setState({ view: { kind: "bot", botId: "ada" }, identityConfirmSurfaceMounted: true });
		await store.openBot("bee");
		expect(subscribe).not.toHaveBeenCalled();
		expect(store.useStore.getState().view).toEqual({ kind: "bot", botId: "ada" });
		expect(identityDraftSnapshot("ada")).toMatchObject({
			name: "Ada renamed",
			confirming: true,
			pending: { kind: "bot", botId: "bee" },
		});
		expect(detailsOpenSnapshot()).toBe(true);
	});

	it("keeps a dirty draft and switches when the card is not mounted", async () => {
		beginIdentityDraft(ada);
		patchIdentityDraft("ada", { name: "Ada renamed" });
		store.useStore.setState({ view: { kind: "bot", botId: "ada" }, identityConfirmSurfaceMounted: false });
		await store.openBot("bee");
		expect(subscribe).toHaveBeenCalled();
		expect(store.useStore.getState().view).toEqual({ kind: "bot", botId: "bee" });
		expect(identityDraftSnapshot("ada")).toMatchObject({ name: "Ada renamed", confirming: false });
		expect(identityDraftSnapshot("ada")?.pending).toBeUndefined();
		expect(detailsOpenSnapshot()).toBe(false);
	});

	it("still switches a clean draft while the card is mounted", async () => {
		beginIdentityDraft(ada);
		store.useStore.setState({ view: { kind: "bot", botId: "ada" }, identityConfirmSurfaceMounted: true });
		await store.openBot("bee");
		expect(store.useStore.getState().view).toEqual({ kind: "bot", botId: "bee" });
		expect(identityDraftSnapshot("ada")).toBeUndefined();
	});

	it("asks to discard before startConversation while the card is mounted", async () => {
		beginIdentityDraft(ada);
		patchIdentityDraft("ada", { name: "Ada renamed" });
		store.useStore.setState({ view: { kind: "bot", botId: "ada" }, identityConfirmSurfaceMounted: true });
		await store.startConversation("bee");
		expect(reopen).not.toHaveBeenCalled();
		expect(store.useStore.getState().view).toEqual({ kind: "bot", botId: "ada" });
		expect(identityDraftSnapshot("ada")?.confirming).toBe(true);
		expect(detailsOpenSnapshot()).toBe(true);
	});

	it("keeps a dirty draft when startConversation runs without the card", async () => {
		beginIdentityDraft(ada);
		patchIdentityDraft("ada", { name: "Ada renamed" });
		store.useStore.setState({
			view: { kind: "bot", botId: "ada" },
			bots: [ada, bee],
			summaries: {},
			identityConfirmSurfaceMounted: false,
		});
		await store.startConversation("bee");
		expect(reopen).toHaveBeenCalledWith({ botId: "bee" });
		expect(store.useStore.getState().view).toEqual({ kind: "bot", botId: "bee" });
		expect(identityDraftSnapshot("ada")).toMatchObject({ name: "Ada renamed", confirming: false });
		expect(identityDraftSnapshot("ada")?.pending).toBeUndefined();
	});
});
