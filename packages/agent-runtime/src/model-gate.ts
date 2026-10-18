import type { Models } from "@earendil-works/pi-ai/models";
import type { ProviderHeaders } from "@earendil-works/pi-ai";
export type ModelExecutionGate = { assertAllowed(): void; signal(): AbortSignal };
const GENERATION = new Set<PropertyKey>([
	"stream",
	"complete",
	"streamSimple",
	"completeSimple",
	"streamDeferred",
	"fetchDeferred",
	"generateImages",
	"classify",
]);
/** Keep Pi's model catalog/auth implementation, but bind generation and compaction to Host lifecycle authority. */
export function gatedModels(models: Models, gate: ModelExecutionGate): Models {
	return new Proxy(models, {
		get(target, key) {
			const value = Reflect.get(target, key, target);
			if (typeof value !== "function") return value;
			if (!GENERATION.has(key)) return value.bind(target);
			return (
				model: unknown,
				input: unknown,
				options?: { signal?: AbortSignal; transformHeaders?: (headers: ProviderHeaders) => ProviderHeaders | Promise<ProviderHeaders> },
			) => {
				gate.assertAllowed();
				const signal = options?.signal ? AbortSignal.any([options.signal, gate.signal()]) : gate.signal();
				return value.call(target, model, input, {
					...options,
					signal,
					transformHeaders: async (headers: ProviderHeaders) => {
						const transformed = options?.transformHeaders ? await options.transformHeaders(headers) : headers;
						gate.assertAllowed();
						signal.throwIfAborted();
						return transformed;
					},
				});
			};
		},
	});
}
