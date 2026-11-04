import { expect, it } from "vitest";
import { systemLanguage } from "../src/renderer/src/features/onboarding/recommended.ts";

it("maps system locales onto the shipped languages", () => {
	expect(systemLanguage(["zh"])).toBe("zh-CN");
	expect(systemLanguage(["zh-TW"])).toBe("zh-CN");
	expect(systemLanguage(["zh-CN"])).toBe("zh-CN");
	expect(systemLanguage(["en-US"])).toBe("en");
	expect(systemLanguage(["en"])).toBe("en");
	expect(systemLanguage(["fr-FR"])).toBe("en");
});
