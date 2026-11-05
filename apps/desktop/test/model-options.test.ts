import { describe, expect, it } from "vitest";
import type { ModelSummary } from "@openbot/protocol";
import { defaultModelOptionValues } from "../src/renderer/src/model-options";

function model(provider: string, modelId: string, source: "builtin" | "custom"): ModelSummary {
	return { provider, modelId, name: modelId, source, reasoning: false, images: false };
}

describe("default model options", () => {
	it("lists the option when the only model is a configured custom provider", () => {
		const scripted = model("scripted", "scripted", "custom");
		expect(defaultModelOptionValues([scripted], [{ providerId: "scripted", configured: true }])).toEqual(["scripted/scripted"]);
	});

	it("drops built-ins that are not configured and keeps the custom model", () => {
		const scripted = model("scripted", "scripted", "custom");
		const builtin = model("openai", "gpt", "builtin");
		expect(defaultModelOptionValues([builtin, scripted], [{ providerId: "scripted", configured: true }])).toEqual(["scripted/scripted"]);
		expect(defaultModelOptionValues([scripted], [{ providerId: "scripted", configured: false }])).toEqual([]);
	});
});
