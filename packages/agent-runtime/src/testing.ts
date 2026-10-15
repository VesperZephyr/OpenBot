/**
 * Test seam: a model collection whose only provider (`faux`, model `faux-1`) answers with scripted turns. Lets packages
 * above agent-runtime exercise real Pi conversations without importing Pi themselves.
 */
import type { ToolCall } from "@earendil-works/pi-ai";
import type { MutableModels } from "@earendil-works/pi-ai/models";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";

export const SCRIPTED_MODEL = { provider: "faux", modelId: "faux-1" } as const;

/** One model answer: plain text, a single tool call, or a provider error, optionally held until `after` settles. */
export type ScriptedTurn =
	| string
	| { readonly tool: string; readonly args: Record<string, unknown> }
	| { readonly error: string; readonly after?: Promise<void> };

export type ScriptedModels = {
	readonly models: MutableModels;
	/** Queue more answers; each model request consumes one. */
	answer(...turns: ScriptedTurn[]): void;
	/** Model requests made so far. */
	readonly requests: () => number;
};

export function scriptedModels(...turns: ScriptedTurn[]): ScriptedModels {
	const faux = fauxProvider();
	const toMessage = (turn: ScriptedTurn) => {
		if (typeof turn === "string") return fauxAssistantMessage(turn);
		if ("error" in turn) {
			const message = fauxAssistantMessage("", { stopReason: "error", errorMessage: turn.error });
			const { after } = turn;
			return after === undefined ? message : async () => (await after, message);
		}
		return fauxAssistantMessage(fauxToolCall(turn.tool, turn.args as ToolCall["arguments"]), { stopReason: "toolUse" });
	};
	faux.setResponses(turns.map(toMessage));
	const models = createModels();
	models.setProvider(faux.provider);
	return {
		models,
		answer: (...more) => faux.appendResponses(more.map(toMessage)),
		requests: () => faux.state.callCount,
	};
}
