import { expect, it } from "vitest";
import { PROVIDER_KEY_URLS } from "../src/renderer/src/features/onboarding/provider-links.ts";

it("opens provider key pages from fixed https urls", () => {
	expect(Object.keys(PROVIDER_KEY_URLS).sort()).toEqual(["anthropic", "deepseek", "minimax", "openai", "openrouter"]);
	for (const url of Object.values(PROVIDER_KEY_URLS)) {
		expect(url.startsWith("https://")).toBe(true);
		expect(url).not.toContain("${");
		expect(url).not.toMatch(/\s/);
	}
});
