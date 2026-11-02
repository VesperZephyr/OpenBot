import { expect, it } from "vitest";
import { activeLegacyDialog, legacyOpenerAction } from "../src/renderer/src/dialog-focus.ts";

const legacy = { focusOwner: null, details: false };
const owned = { focusOwner: "react-aria", details: false };
const details = { focusOwner: null, details: true };

it("ignores an owned dialog even when a legacy dialog is underneath", () => {
	expect(activeLegacyDialog([])).toBeUndefined();
	expect(activeLegacyDialog([owned])).toBeUndefined();
	expect(activeLegacyDialog([legacy, owned])).toBeUndefined();
	expect(activeLegacyDialog([details, owned])).toBeUndefined();
});

it("defers opener restore while a legacy editor is open and restores it otherwise", () => {
	expect(legacyOpenerAction(true, true)).toBe("keep");
	expect(legacyOpenerAction(true, false)).toBe("keep");
	expect(legacyOpenerAction(false, true)).toBe("defer");
	expect(legacyOpenerAction(false, false)).toBe("restore");
});

it("handles only the topmost unowned dialog and keeps the details exception", () => {
	expect(activeLegacyDialog([legacy])).toBe(legacy);
	expect(activeLegacyDialog([owned, legacy])).toBe(legacy);
	expect(activeLegacyDialog([details])).toBe(details);
	const confirm = { focusOwner: null, details: false };
	expect(activeLegacyDialog([confirm, details])).toBe(confirm);
});
