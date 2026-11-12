// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { BotSummary, RedactedSettings } from "@openbot/protocol";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SettingsDestination } from "../src/renderer/src/features/settings/SettingsWorkspace";

type DesktopStore = typeof import("../src/renderer/src/store");

const settings: RedactedSettings = {
	language: "en",
	providers: [{ providerId: "openai", name: "OpenAI", source: "builtin", configured: false, keyStored: false }],
	dataDirectory: "/tmp/openbot",
	modelConfig: { path: "/tmp/models.json", errors: [] },
	workspace: "/tmp/workspace",
	webSearch: { provider: "tavily", configured: false },
};

const loaded: { store?: DesktopStore; Shortcuts?: typeof import("../src/renderer/src/features/shortcuts/use-global-shortcuts"); Workspace?: typeof import("../src/renderer/src/features/settings/SettingsWorkspace") } = {};

function bot(botId: string, name: string): BotSummary {
	return {
		botId,
		name,
		role: "Writer",
		instructions: "Write.",
		revision: 1,
		kind: "specialist",
		pinned: false,
		status: "active",
		createdAt: 0,
		activity: "idle",
		pendingApprovals: 0,
	};
}

function Harness() {
	const store = loaded.store;
	const Shortcuts = loaded.Shortcuts;
	const Workspace = loaded.Workspace;
	if (!store || !Shortcuts || !Workspace) return null;
	const view = store.useStore((state) => state.view);
	Shortcuts.useGlobalShortcuts({ openSearch() {}, openNewMenu() {} });
	if (view.kind !== "settings" && view.kind !== "skills" && view.kind !== "connectors" && view.kind !== "routines") {
		return createElement("main", { "data-chat": "true" }, "chat");
	}
	return createElement(Workspace.SettingsWorkspace, {
		view,
		onBack: () => store.closeSettings(),
		onSelect: (kind: SettingsDestination) => store.openSettings(kind),
		renderTranscript: () => null,
	});
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeAll(async () => {
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	(window as unknown as { openbot: Window["openbot"] }).openbot = {
		methods: { "bots.management.history": async () => [] },
	} as unknown as Window["openbot"];
	loaded.store = await import("../src/renderer/src/store");
	loaded.Shortcuts = await import("../src/renderer/src/features/shortcuts/use-global-shortcuts");
	loaded.Workspace = await import("../src/renderer/src/features/settings/SettingsWorkspace");
	const calls = loaded.store.api as unknown as Record<string, (params: never) => Promise<unknown>>;
	calls["settings.get"] = async () => settings;
	calls["models.list"] = async () => [];
	calls["routines.list"] = async () => ({ routines: [], absenceDays: 7, lastActiveAt: 0, absencePaused: false });
	calls["skills.list"] = async () => [];
	calls["policy.get"] = async () => undefined;
	calls["grants.list"] = async () => [];
	calls["credentials.status"] = async () => undefined;
	calls["conversations.subscribe"] = async () => undefined;
	calls["conversations.snapshot"] = async () => undefined;
	calls["conversations.list"] = async () => [];
});

beforeEach(() => {
	loaded.store?.useStore.setState({
		view: { kind: "home" },
		lastChat: { kind: "bot", botId: "ada" },
		onboarding: false,
		bots: [bot("ada", "Ada"), bot("bee", "Bee")],
		groups: [],
		skills: [],
		routines: { routines: [], absenceDays: 7, lastActiveAt: 0, absencePaused: false },
		settings,
		models: [],
		host: { status: "ready" },
		summaries: {},
		notice: undefined,
		searchTarget: undefined,
	});
});

afterEach(async () => {
	await act(async () => root?.unmount());
	container?.remove();
	root = undefined;
	container = undefined;
});

async function show(page: "settings" | "skills" | "routines"): Promise<void> {
	const store = loaded.store;
	if (!store) throw new Error("store was not loaded");
	store.useStore.setState({ view: { kind: page }, lastChat: { kind: "bot", botId: "ada" } });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	await act(async () => {
		root?.render(createElement(Harness));
	});
	await act(async () => {
		await Promise.resolve();
	});
}

function buttonNamed(name: string): HTMLButtonElement {
	const match = [...(container?.querySelectorAll("button") ?? [])].find((node) => node.textContent?.trim() === name);
	if (!(match instanceof HTMLButtonElement)) throw new Error(`missing button ${name}`);
	return match;
}

function back(): HTMLButtonElement {
	const match = container?.querySelector(".back-to-chat");
	if (!(match instanceof HTMLButtonElement)) throw new Error("missing back");
	return match;
}

function confirmDialog(): HTMLElement | null {
	const match = container?.querySelector('[role="alertdialog"]');
	return match instanceof HTMLElement ? match : null;
}

async function typeInto(element: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
	await act(async () => {
		const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element) as object, "value")?.set;
		setter?.call(element, value);
		element.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

async function pressEscape(target: EventTarget): Promise<void> {
	await act(async () => {
		target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
	});
}

function workflowField(): HTMLTextAreaElement {
	const labeled = [...(container?.querySelectorAll("label") ?? [])].find((node) => node.textContent?.includes("Workflow"));
	const field = labeled?.querySelector("textarea");
	if (!(field instanceof HTMLTextAreaElement)) throw new Error("missing workflow");
	return field;
}

describe("settings drafts survive close until the user confirms", () => {
	it("keeps a routine workflow when Escape is pressed in the field, and asks after blur or Back", async () => {
		await show("routines");
		await act(async () => {
			buttonNamed("New routine").click();
		});
		const workflow = workflowField();
		const drafted = "Read the weekly CRM export and publish receivables.";
		await typeInto(workflow, drafted);
		workflow.focus();
		await pressEscape(workflow);
		expect(loaded.store?.useStore.getState().view).toEqual({ kind: "routines" });
		expect(confirmDialog()).toBeNull();
		expect(workflow.value).toBe(drafted);

		workflow.blur();
		await pressEscape(document.body);
		expect(loaded.store?.useStore.getState().view).toEqual({ kind: "routines" });
		expect(confirmDialog()?.textContent).toContain("Discard these edits?");
		expect(workflow.value).toBe(drafted);

		await pressEscape(document.body);
		expect(confirmDialog()).toBeNull();
		expect(workflow.value).toBe(drafted);
		expect(loaded.store?.useStore.getState().view).toEqual({ kind: "routines" });

		await act(async () => {
			back().click();
		});
		expect(loaded.store?.useStore.getState().view).toEqual({ kind: "routines" });
		expect(workflow.value).toBe(drafted);
		await act(async () => {
			buttonNamed("Discard").click();
		});
		expect(loaded.store?.useStore.getState().view).toEqual({ kind: "bot", botId: "ada" });
		expect(container?.querySelector("textarea")).toBeNull();
	});

	it("closes a routine page that has no workflow changes", async () => {
		await show("routines");
		await act(async () => {
			buttonNamed("New routine").click();
		});
		expect(workflowField().value).toBe("");
		await pressEscape(document.body);
		expect(confirmDialog()).toBeNull();
		expect(loaded.store?.useStore.getState().view).toEqual({ kind: "bot", botId: "ada" });
	});

	it("asks before a settings section change discards a workflow", async () => {
		await show("routines");
		await act(async () => {
			buttonNamed("New routine").click();
		});
		const workflow = workflowField();
		await typeInto(workflow, "Keep the weekly close.");
		const skills = container?.querySelector(".settings-navigation button[aria-current]")?.parentElement?.querySelectorAll("button");
		const skillsButton = [...(skills ?? [])].find((node) => node.textContent?.trim() === "Skills");
		if (!(skillsButton instanceof HTMLButtonElement)) throw new Error("missing skills navigation");
		await act(async () => {
			skillsButton.click();
		});
		expect(loaded.store?.useStore.getState().view).toEqual({ kind: "routines" });
		expect(workflow.value).toBe("Keep the weekly close.");
		expect(confirmDialog()?.textContent).toContain("Discard these edits?");
		await act(async () => {
			buttonNamed("Discard").click();
		});
		expect(loaded.store?.useStore.getState().view).toEqual({ kind: "skills" });
		expect(container?.querySelector("textarea")).toBeNull();
	});

	it("keeps a skill draft on Escape after blur and on Back", async () => {
		await show("skills");
		await act(async () => {
			buttonNamed("New skill").click();
		});
		const steps = container?.querySelector('textarea[aria-label="Steps"]');
		if (!(steps instanceof HTMLTextAreaElement)) throw new Error("missing skill steps");
		const drafted = "Check the source, then write the result.";
		await typeInto(steps, drafted);
		steps.focus();
		await pressEscape(steps);
		expect(confirmDialog()).toBeNull();
		expect(loaded.store?.useStore.getState().view).toEqual({ kind: "skills" });

		steps.blur();
		await pressEscape(document.body);
		expect(loaded.store?.useStore.getState().view).toEqual({ kind: "skills" });
		expect(steps.value).toBe(drafted);
		expect(confirmDialog()?.textContent).toContain("Discard these edits?");
		await act(async () => {
			back().click();
		});
		expect(steps.value).toBe(drafted);
		await act(async () => {
			buttonNamed("Keep editing").click();
		});
		expect(steps.value).toBe(drafted);
		expect(loaded.store?.useStore.getState().view).toEqual({ kind: "skills" });
	});

	it("closes a new skill that is still blank", async () => {
		await show("skills");
		await act(async () => {
			buttonNamed("New skill").click();
		});
		const steps = container?.querySelector('textarea[aria-label="Steps"]');
		expect(steps).toBeInstanceOf(HTMLTextAreaElement);
		await pressEscape(document.body);
		expect(confirmDialog()).toBeNull();
		expect(loaded.store?.useStore.getState().view).toEqual({ kind: "bot", botId: "ada" });
	});

	it("asks before closing an unsaved provider API key, model API key, or Tavily key", async () => {
		await show("settings");
		const provider = container?.querySelector('input[aria-label="API key"]');
		const model = container?.querySelector(".model-setup input[type=password]");
		const tavily = container?.querySelector('input[aria-label="Tavily API key"]');
		if (!(provider instanceof HTMLInputElement) || !(model instanceof HTMLInputElement) || !(tavily instanceof HTMLInputElement)) {
			throw new Error("missing API key fields");
		}
		for (const field of [provider, model, tavily]) {
			await typeInto(field, "sk-live-secret");
			field.focus();
			await pressEscape(field);
			expect(loaded.store?.useStore.getState().view).toEqual({ kind: "settings" });
			expect(confirmDialog()).toBeNull();
			expect(field.value).toBe("sk-live-secret");
			field.blur();
			await pressEscape(document.body);
			expect(loaded.store?.useStore.getState().view).toEqual({ kind: "settings" });
			expect(field.value).toBe("sk-live-secret");
			expect(confirmDialog()?.textContent).toContain("Discard these edits?");
			await act(async () => {
				buttonNamed("Keep editing").click();
			});
			expect(field.value).toBe("sk-live-secret");
			await typeInto(field, "");
		}
		await pressEscape(document.body);
		expect(confirmDialog()).toBeNull();
		expect(loaded.store?.useStore.getState().view).toEqual({ kind: "bot", botId: "ada" });
	});

	it("asks before the setup wizard discards an API key", async () => {
		await show("settings");
		const provider = container?.querySelector('input[aria-label="API key"]');
		if (!(provider instanceof HTMLInputElement)) throw new Error("missing API key");
		await typeInto(provider, "sk-live-secret");
		await act(async () => {
			buttonNamed("Open the setup wizard again").click();
		});
		expect(loaded.store?.useStore.getState().onboarding).not.toBe(true);
		expect(loaded.store?.useStore.getState().view).toEqual({ kind: "settings" });
		expect(provider.value).toBe("sk-live-secret");
		expect(confirmDialog()?.textContent).toContain("Discard these edits?");
		await act(async () => {
			buttonNamed("Discard").click();
		});
		expect(loaded.store?.useStore.getState().onboarding).toBe(true);
		expect(loaded.store?.useStore.getState().view).toEqual({ kind: "bot", botId: "ada" });
	});

	it("does not open another conversation until the workflow discard is confirmed", async () => {
		await show("routines");
		await act(async () => {
			buttonNamed("New routine").click();
		});
		await typeInto(workflowField(), "Do not lose this workflow.");
		await act(async () => {
			await loaded.store?.openBot("bee");
		});
		expect(loaded.store?.useStore.getState().view).toEqual({ kind: "routines" });
		expect(workflowField().value).toBe("Do not lose this workflow.");
		expect(confirmDialog()?.textContent).toContain("Discard these edits?");
		await act(async () => {
			buttonNamed("Discard").click();
		});
		expect(loaded.store?.useStore.getState().view).toEqual({ kind: "bot", botId: "bee" });
	});

	it("reports a rejected conversation read when Discard finishes opening the Bot", async () => {
		const store = loaded.store;
		if (!store) throw new Error("store was not loaded");
		const calls = store.api as unknown as Record<string, (params: never) => Promise<unknown>>;
		const subscribe = calls["conversations.subscribe"];
		const rejections: unknown[] = [];
		const onRejection = (reason: unknown): void => {
			rejections.push(reason);
		};
		process.on("unhandledRejection", onRejection);
		calls["conversations.subscribe"] = async () => {
			throw new Error("Could not open the conversation");
		};
		try {
			await show("routines");
			await act(async () => {
				buttonNamed("New routine").click();
			});
			await typeInto(workflowField(), "Do not lose this workflow.");
			await act(async () => {
				void store.openBot("bee").catch(store.report);
			});
			expect(store.useStore.getState().view).toEqual({ kind: "routines" });
			await act(async () => {
				buttonNamed("Discard").click();
			});
			await new Promise((resolve) => setImmediate(resolve));
			expect(rejections.map((reason) => (reason instanceof Error ? reason.message : String(reason)))).toEqual([]);
			expect(store.useStore.getState().notice).toBe("Could not open the conversation");
			expect(store.useStore.getState().view).toEqual({ kind: "bot", botId: "bee" });
		} finally {
			process.off("unhandledRejection", onRejection);
			calls["conversations.subscribe"] = subscribe ?? (async () => undefined);
		}
	});
});
