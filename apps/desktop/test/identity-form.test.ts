// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { BotSummary } from "@openbot/protocol";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
	beginIdentityDraft,
	identityDraftSnapshot,
	patchIdentityDraft,
	resetIdentityDraft,
} from "../src/renderer/src/features/details/identity-draft";

const host = vi.hoisted(() => ({
	update: vi.fn(async (_input: unknown) => ({})),
	list: vi.fn(async () => []),
	avatarGet: vi.fn(async () => undefined),
	refreshBots: vi.fn(async () => {}),
	report: vi.fn(),
	openBot: vi.fn(async () => {}),
}));

vi.mock("../src/renderer/src/store", () => ({
	api: {
		"bots.update": host.update,
		"bots.list": host.list,
		"bots.avatar.get": host.avatarGet,
	},
	refreshBots: host.refreshBots,
	report: host.report,
	openBot: host.openBot,
	errorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
	useStore: Object.assign(
		(selector?: (state: { settings: { language: "en" }; models: never[]; skills: never[]; bots: never[] }) => unknown) => {
			const state = { settings: { language: "en" as const }, models: [], skills: [], bots: [] };
			return selector ? selector(state) : state;
		},
		{
			getState: () => ({ settings: { language: "en" as const }, models: [], skills: [], bots: [] }),
			setState: () => undefined,
			subscribe: () => () => undefined,
		},
	),
}));

const { IdentityForm } = await import("../src/renderer/src/BotIdentity");

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
const bee = { ...bot({ botId: "bee", name: "Bee", role: "Editor", instructions: "Edit." }), revision: 3 };
const cee = { ...bot({ botId: "cee", name: "Cee", role: "Reader", instructions: "Read." }), revision: 7 };

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeAll(() => {
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
	if (root) await act(async () => root?.unmount());
	container?.remove();
	root = undefined;
	container = undefined;
	resetIdentityDraft();
	vi.clearAllMocks();
});

describe("identity form", () => {
	it("submits the Bot the draft started for when the bot prop later names another Bot", async () => {
		beginIdentityDraft(ada);
		patchIdentityDraft("ada", { name: "Ada renamed" });
		beginIdentityDraft(bee);
		patchIdentityDraft("bee", { role: "Copy editor" });
		const beeDraft = structuredClone(identityDraftSnapshot("bee"));

		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		await act(async () => {
			root?.render(createElement(IdentityForm, { bot: ada, onClose: () => undefined }));
		});
		await act(async () => {
			root?.render(createElement(IdentityForm, { bot: cee, onClose: () => undefined }));
		});

		const name = container.querySelector<HTMLInputElement>("form.identity-form .identity-field input");
		expect(name).not.toBeNull();
		expect(name?.value).toBe("Ada renamed");
		expect(identityDraftSnapshot("cee")).toBeUndefined();
		expect(identityDraftSnapshot("bee")).toEqual(beeDraft);

		const form = container.querySelector("form.identity-form");
		expect(form).not.toBeNull();
		await act(async () => {
			form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
		});

		expect(host.update).toHaveBeenCalledTimes(1);
		expect(host.update.mock.calls[0]?.[0]).toEqual({
			botId: "ada",
			expectedRevision: 1,
			name: "Ada renamed",
			role: "Writer",
			instructions: "Write.",
		});
		expect(host.openBot).not.toHaveBeenCalled();
		expect(identityDraftSnapshot("ada")).toBeUndefined();
		expect(identityDraftSnapshot("cee")).toBeUndefined();
		expect(identityDraftSnapshot("bee")).toEqual(beeDraft);
	});
});
