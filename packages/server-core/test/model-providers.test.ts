import { describe, expect, it } from "vitest";
import { parse } from "jsonc-parser";
import { mergeProvider } from "../src/model-providers.ts";

const addition = { id: "new", name: "New", baseUrl: "https://example.com/v1", api: "openai-responses" as const, modelIds: ["m"] };
describe("additive model configuration", () => {
	it("preserves comments and unrelated advanced configuration", () => {
		const original = '{\n // My note\n "providers": { "existing": { "headers": {"X-Key":"!helper"}, "models": [], }, },\n}';
		const next = mergeProvider(original, addition);
		expect(next).toContain("// My note");
		expect(parse(next).providers.existing.headers).toEqual({ "X-Key": "!helper" });
		expect(parse(next).providers.existing).toEqual(parse(original).providers.existing);
		expect(parse(next).providers.new.api).toBe("openai-responses");
	});
	it("refuses collisions, malformed documents and URL credentials without replacement", () => {
		expect(() => mergeProvider('{"providers":{"new":{"apiKey":"private"}}}', addition)).toThrow("already exists");
		expect(() => mergeProvider('{"providers":', addition)).toThrow("valid JSONC");
		expect(() => mergeProvider(undefined, { ...addition, baseUrl: "https://user:secret@example.com" })).toThrow("API key field");
	});
});
