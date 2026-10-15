/**
 * Test seam: a model collection whose only provider (`faux`, model `faux-1`) answers with scripted turns. Lets packages
 * above agent-runtime exercise real Pi conversations without importing Pi themselves.
 */
import type { ToolCall } from "@earendil-works/pi-ai";
import type { MutableModels } from "@earendil-works/pi-ai/models";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";

export const SCRIPTED_MODEL = { provider: "faux", modelId: "faux-1" } as const;

/** One model answer: plain text, or a single tool call. */
export type ScriptedTurn = string | { readonly tool: string; readonly args: Record<string, unknown> };

export type ScriptedModels = {
	readonly models: MutableModels;
	/** Queue more answers; each model request consumes one. */
	answer(...turns: ScriptedTurn[]): void;
	/** Model requests made so far. */
	readonly requests: () => number;
};

export function scriptedModels(...turns: ScriptedTurn[]): ScriptedModels {
	const faux = fauxProvider();
	const toMessage = (turn: ScriptedTurn) =>
		typeof turn === "string"
			? fauxAssistantMessage(turn)
			: fauxAssistantMessage(fauxToolCall(turn.tool, turn.args as ToolCall["arguments"]), { stopReason: "toolUse" });
	faux.setResponses(turns.map(toMessage));
	const models = createModels();
	models.setProvider(faux.provider);
	return {
		models,
		answer: (...more) => faux.appendResponses(more.map(toMessage)),
		requests: () => faux.state.callCount,
	};
}
