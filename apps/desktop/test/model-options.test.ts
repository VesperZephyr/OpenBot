import { describe, expect, it } from "vitest";
import type { ModelSummary } from "@openbot/protocol";
import { modelCatalogPending, visibleModelOptions } from "../src/renderer/src/model-options";

function model(provider: string, modelId: string, source: "builtin" | "custom"): ModelSummary {
	return { provider, modelId, name: modelId, source, reasoning: false, images: false };
}

const scripted = model("scripted", "scripted", "custom");
const builtin = model("openai", "gpt", "builtin");

describe("default model options", () => {
	it("keeps a custom provider selectable before settings marks it configured", () => {
		const hidden = model("anthropic", "claude", "builtin");
		expect(visibleModelOptions([hidden, scripted], [{ providerId: "openai", configured: true }]).map((item) => `${item.provider}/${item.modelId}`)).toEqual([
			"scripted/scripted",
		]);
		expect(visibleModelOptions([builtin], [{ providerId: "openai", configured: true }]).map((item) => `${item.provider}/${item.modelId}`)).toEqual([
			"openai/gpt",
		]);
		expect(visibleModelOptions([scripted], undefined).map((item) => item.modelId)).toEqual(["scripted"]);
	});

	it("waits until a configured provider's model is actually listed", () => {
		const settings = {
			providers: [{ providerId: "scripted", configured: true }],
			modelConfig: { errors: [] as string[] },
		};
		expect(modelCatalogPending([builtin], settings)).toBe(true);
		expect(modelCatalogPending([builtin, scripted], settings)).toBe(false);
		expect(modelCatalogPending([builtin], { providers: [], modelConfig: { errors: [] } })).toBe(false);
		expect(modelCatalogPending([], undefined)).toBe(true);
	});
});
