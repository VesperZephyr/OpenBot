import { afterEach, describe, expect, it } from "vitest";
import {
	beginIdentityDraft,
	discardIdentityDraft,
	identityDirty,
	identityDraftSnapshot,
	patchIdentityDraft,
	requestIdentityClose,
	resetIdentityDraft,
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
});