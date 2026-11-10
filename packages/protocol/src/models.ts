

export type ModelRef = { readonly provider: string; readonly modelId: string };

/** Chat APIs a provider declared in the model configuration file may use. */
export const MODEL_APIS = ["openai-completions", "openai-responses", "anthropic-messages"] as const;
export type ModelApi = (typeof MODEL_APIS)[number];

/** How much a reasoning model thinks before answering; Pi's levels this product offers. */
export type ThinkingLevel = "off" | "low" | "medium" | "high";

export type ModelSummary = {
	readonly source?: "builtin" | "custom";
	readonly overridden?: boolean;
	/** Origin only: never credentials, URL paths, query strings or headers. */
	readonly endpoint?: string;
	readonly provider: string;
	readonly modelId: string;
	readonly name: string;
	readonly reasoning: boolean;
	readonly images: boolean;
};
