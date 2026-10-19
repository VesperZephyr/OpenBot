import { describe, expect, it } from "vitest";
import { gatedModels } from "../src/model-gate.ts";
import { scriptedModels } from "../src/testing.ts";
function fixture() {
	const scripted = scriptedModels("answer"),
		controller = new AbortController();
	let blocked = false;
	const models = gatedModels(scripted.models, {
		assertAllowed() {
			if (blocked) throw Error("paused");
		},
		signal: () => controller.signal,
	});
	return {
		models,
		scripted,
		model: models.getModel("faux", "faux-1")!,
		pause() {
			blocked = true;
			controller.abort();
		},
	};
}
const input = { messages: [] };
describe("model lifecycle gate", () => {
	it("blocks generation and compaction while keeping catalog access available", () => {
		const f = fixture();
		f.pause();
		expect(f.models.getModels()).toHaveLength(1);
		expect(() => f.models.streamSimple(f.model, input)).toThrow("paused");
		expect(() => f.models.completeSimple(f.model, input)).toThrow("paused");
		expect(f.scripted.requests()).toBe(0);
	});
	it("rechecks authority after asynchronous request preparation before provider dispatch", async () => {
		const f = fixture(),
			entered = Promise.withResolvers<void>(),
			release = Promise.withResolvers<void>();
		const result = f.models
			.streamSimple(f.model, input, {
				transformHeaders: async (headers) => {
					entered.resolve();
					await release.promise;
					return headers;
				},
			})
			.result();
		await entered.promise;
		f.pause();
		release.resolve();
		expect((await result).stopReason).not.toBe("stop");
		expect(f.scripted.requests()).toBe(0);
	});
	it("preserves the provider implementation when admitted", async () => {
		const f = fixture();
		expect((await f.models.completeSimple(f.model, input)).stopReason).toBe("stop");
		expect(f.scripted.requests()).toBe(1);
	});
});
