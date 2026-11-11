import { expect, it } from "vitest";
import { recommendedModelId, systemLanguage } from "../src/renderer/src/features/onboarding/recommended.ts";

it("maps system locales onto the shipped languages", () => {
	expect(systemLanguage(["zh"])).toBe("zh-CN");
	expect(systemLanguage(["zh-TW"])).toBe("zh-CN");
	expect(systemLanguage(["zh-CN"])).toBe("zh-CN");
	expect(systemLanguage(["en-US"])).toBe("en");
	expect(systemLanguage(["en"])).toBe("en");
	expect(systemLanguage(["fr-FR"])).toBe("en");
});

it("opens MiniMax on the current flagship and leaves other providers on their first model", () => {
	expect(recommendedModelId("minimax", ["MiniMax-M3", "MiniMax-M3.1-Flash"])).toBe("MiniMax-M3.1-Flash");
	expect(recommendedModelId("minimax-cn", ["MiniMax-M3", "MiniMax-M3.1-Flash"])).toBe("MiniMax-M3.1-Flash");
	expect(recommendedModelId("minimax", ["MiniMax-M3"])).toBe("MiniMax-M3");
	expect(recommendedModelId("openai", ["gpt-4o", "gpt-4o-mini"])).toBe("gpt-4o");
});
