import type { ModelRef } from "@openbot/protocol";

const RETIRED_MINIMAX_MODELS = new Set(["MiniMax-M2.7", "MiniMax-M2.7-highspeed"]);
const CURRENT_MINIMAX_MODEL = "MiniMax-M3.1-Flash";

/**
 * Retired direct MiniMax selections become the current flagship on the same provider.
 * Any other provider or id is left unchanged, so this returns undefined.
 */
export function minimaxModelReplacement(ref: ModelRef | undefined): ModelRef | undefined {
	if (ref === undefined) return undefined;
	if (ref.provider !== "minimax" && ref.provider !== "minimax-cn") return undefined;
	if (!RETIRED_MINIMAX_MODELS.has(ref.modelId)) return undefined;
	return { provider: ref.provider, modelId: CURRENT_MINIMAX_MODEL };
}
