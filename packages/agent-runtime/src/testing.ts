/**
 * Test seam: a model collection whose only provider (`faux`, model `faux-1`) answers with scripted text. Lets packages
 * above agent-runtime exercise real Pi conversations without importing Pi themselves.
 */
import type { MutableModels } from "@earendil-works/pi-ai/models";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";

export const SCRIPTED_MODEL = { provider: "faux", modelId: "faux-1" } as const;

export type ScriptedModels = {
	readonly models: MutableModels;
	/** Queue more answers; each model request consumes one. */
	answer(...texts: string[]): void;
};

export function scriptedModels(...texts: string[]): ScriptedModels {
	const faux = fauxProvider();
	faux.setResponses(texts.map((text) => fauxAssistantMessage(text)));
	const models = createModels();
	models.setProvider(faux.provider);
	return { models, answer: (...more) => faux.appendResponses(more.map((text) => fauxAssistantMessage(text))) };
}
