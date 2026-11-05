import { afterEach, describe, expect, it } from "vitest";
import {
	beginIdentityDraft,
	discardIdentityDraft,
	identityConfirmSurfaceMounted,
	identityDirty,
	identityDraftSnapshot,
	patchIdentityDraft,
	requestIdentityClose,
	resetIdentityDraft,
	setIdentityConfirmSurfaceMounted,
} from "../src/renderer/src/features/details/identity-draft";

const ada = { botId: "ada", name: "Ada", role: "Writer", instructions: "Write.", revision: 1 };

afterEach(() => {
	resetIdentityDraft();
});

describe("identity draft", () => {
	it("keeps unsaved edits, including the original bot id, until they are discarded", () => {
		beginIdentityDraft(ada);
		patchIdentityDraft({ name: "Ada renamed" });
		beginIdentityDraft({ ...ada, name: "Replaced" });
		const draft = identityDraftSnapshot();
		expect(draft?.baseline.botId).toBe("ada");
		expect(draft?.name).toBe("Ada renamed");
		expect(identityDirty(draft)).toBe(true);
		expect(requestIdentityClose({ kind: "bot", botId: "bee" })).toBe(false);
		expect(identityDraftSnapshot()?.confirming).toBe(true);
		expect(identityDraftSnapshot()?.baseline.botId).toBe("ada");
		expect(discardIdentityDraft()).toEqual({ kind: "bot", botId: "bee" });
		expect(identityDraftSnapshot()).toBeUndefined();
	});

	it("lets a clean editor close", () => {
		beginIdentityDraft(ada);
		expect(requestIdentityClose()).toBe(true);
		expect(identityDraftSnapshot()).toBeUndefined();
	});

	it("keeps a dirty draft and allows the switch when the confirm dialog is not visible", () => {
		beginIdentityDraft(ada);
		patchIdentityDraft({ name: "Ada renamed" });
		expect(requestIdentityClose({ kind: "bot", botId: "bee" }, { confirmVisible: false })).toBe(true);
		const draft = identityDraftSnapshot();
		expect(draft?.baseline.botId).toBe("ada");
		expect(draft?.name).toBe("Ada renamed");
		expect(draft?.confirming).toBe(false);
		expect(draft?.pending).toBeUndefined();
	});

	it("does not replace another bot's dirty draft", () => {
		beginIdentityDraft(ada);
		patchIdentityDraft({ name: "Ada renamed" });
		const kept = beginIdentityDraft({ botId: "bee", name: "Bee", role: "Editor", instructions: "Edit.", revision: 1 });
		expect(kept.baseline.botId).toBe("ada");
		expect(kept.name).toBe("Ada renamed");
		expect(identityDraftSnapshot()?.baseline.botId).toBe("ada");
	});

	it("reports whether the confirm surface is mounted", () => {
		expect(identityConfirmSurfaceMounted()).toBe(false);
		setIdentityConfirmSurfaceMounted(true);
		expect(identityConfirmSurfaceMounted()).toBe(true);
		resetIdentityDraft();
		expect(identityConfirmSurfaceMounted()).toBe(false);
	});
});