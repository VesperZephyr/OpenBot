import { expect, it } from "vitest";
import { isUnmovedScroll } from "../src/renderer/src/ui/boardui/utils/use-dismiss-on-outside-press.ts";

it("treats a repeated scroll offset as unmoved and a changed offset as a real scroll", () => {
	expect(isUnmovedScroll(undefined, { top: 0, left: 0 })).toBe(false);
	expect(isUnmovedScroll({ top: 488, left: 0 }, { top: 488, left: 0 })).toBe(true);
	expect(isUnmovedScroll({ top: 488, left: 0 }, { top: 528, left: 0 })).toBe(false);
	expect(isUnmovedScroll({ top: 10, left: 4 }, { top: 10, left: 8 })).toBe(false);
});
