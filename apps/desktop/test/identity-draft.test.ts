import { afterEach, describe, expect, it } from "vitest";
import {
	beginIdentityDraft,
	discardIdentityDraft,
	retainIdentityDrafts,
	identityDirty,
	identityDraftSnapshot,
	patchIdentityDraft,
	requestIdentityClose,
	resetIdentityDraft,
} from "../src/renderer/src/features/details/identity-draft";

const ada = { botId: "ada", name: "Ada", role: "Writer", instructions: "Write.", revision: 1 };
const bee = { botId: "bee", name: "Bee", role: "Editor", instructions: "Edit.", revision: 1 };

afterEach(() => {
	resetIdentityDraft();
});

describe("identity draft", () => {
	it("keeps unsaved edits, including the original bot id, until they are discarded", () => {
		beginIdentityDraft(ada);
		patchIdentityDraft("ada", { name: "Ada renamed" });
		beginIdentityDraft({ ...ada, name: "Replaced" });
		const draft = identityDraftSnapshot("ada");
		expect(draft?.baseline.botId).toBe("ada");
		expect(draft?.name).toBe("Ada renamed");
		expect(identityDirty(draft)).toBe(true);
		expect(requestIdentityClose("ada", { kind: "bot", botId: "bee" })).toBe(false);
		expect(identityDraftSnapshot("ada")?.confirming).toBe(true);
		expect(identityDraftSnapshot("ada")?.baseline.botId).toBe("ada");
		expect(discardIdentityDraft("ada")).toEqual({ kind: "bot", botId: "bee" });
		expect(identityDraftSnapshot("ada")).toBeUndefined();
	});

	it("lets a clean editor close", () => {
		beginIdentityDraft(ada);
		expect(requestIdentityClose("ada")).toBe(true);
		expect(identityDraftSnapshot("ada")).toBeUndefined();
	});

	it("keeps a dirty draft and allows the switch when the confirm dialog is not visible", () => {
		beginIdentityDraft(ada);
		patchIdentityDraft("ada", { name: "Ada renamed" });
		expect(requestIdentityClose("ada", { kind: "bot", botId: "bee" }, { confirmVisible: false })).toBe(true);
		const draft = identityDraftSnapshot("ada");
		expect(draft?.baseline.botId).toBe("ada");
		expect(draft?.name).toBe("Ada renamed");
		expect(draft?.confirming).toBe(false);
		expect(draft?.pending).toBeUndefined();
	});

	it("stores a dirty draft per bot so the next bot can edit and close", () => {
		beginIdentityDraft(ada);
		patchIdentityDraft("ada", { name: "Ada renamed" });
		expect(requestIdentityClose("bee", { kind: "close" })).toBe(true);
		expect(identityDraftSnapshot("ada")?.name).toBe("Ada renamed");
		expect(identityDraftSnapshot("ada")?.confirming).toBe(false);

		const started = beginIdentityDraft(bee);
		expect(started.baseline.botId).toBe("bee");
		expect(started.name).toBe("Bee");
		expect(identityDraftSnapshot("ada")?.name).toBe("Ada renamed");
		patchIdentityDraft("bee", { role: "Copy editor" });
		expect(identityDraftSnapshot("ada")?.role).toBe("Writer");
		expect(identityDraftSnapshot("bee")?.role).toBe("Copy editor");

		expect(requestIdentityClose("ada", { kind: "bot", botId: "bee" })).toBe(false);
		expect(identityDraftSnapshot("ada")?.confirming).toBe(true);
		expect(identityDraftSnapshot("ada")?.pending).toEqual({ kind: "bot", botId: "bee" });
		expect(identityDraftSnapshot("bee")?.confirming).toBe(false);
		expect(discardIdentityDraft("bee")).toBeUndefined();
		expect(identityDraftSnapshot("ada")?.name).toBe("Ada renamed");
		expect(identityDraftSnapshot("bee")).toBeUndefined();
	});

	it("drops a deleted Bot's draft from the map and keeps the other Bot's draft", () => {
		beginIdentityDraft(ada);
		patchIdentityDraft("ada", { name: "Ada renamed" });
		beginIdentityDraft(bee);
		patchIdentityDraft("bee", { role: "Copy editor" });
		expect(discardIdentityDraft("ada")).toBeUndefined();
		expect(identityDraftSnapshot("ada")).toBeUndefined();
		expect(identityDraftSnapshot("bee")?.role).toBe("Copy editor");
		retainIdentityDrafts(["bee"]);
		expect(identityDraftSnapshot("bee")?.name).toBe("Bee");
		retainIdentityDrafts([]);
		expect(identityDraftSnapshot("bee")).toBeUndefined();
	});
});
