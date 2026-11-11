/** Static recommendations. A card is hidden when models.list does not include its provider id. */
export const RECOMMENDED_PROVIDERS = [
	{ id: "minimax", name: "MiniMax", blurb: "Long context" },
	{ id: "minimax-cn", name: "MiniMax CN", blurb: "China endpoint" },
	{ id: "deepseek", name: "DeepSeek", blurb: "General chat" },
	{ id: "openrouter", name: "OpenRouter", blurb: "Many models" },
	{ id: "anthropic", name: "Anthropic", blurb: "Long-form writing" },
	{ id: "openai", name: "OpenAI", blurb: "General use" },
] as const;

export const MINIMAX_DEFAULT_MODEL = "MiniMax-M3.1-Flash";

/** MiniMax opens on the current flagship when that catalog entry exists. Every other provider keeps the first listed model. */
export function recommendedModelId(providerId: string, modelIds: readonly string[]): string {
	if ((providerId === "minimax" || providerId === "minimax-cn") && modelIds.includes(MINIMAX_DEFAULT_MODEL)) return MINIMAX_DEFAULT_MODEL;
	return modelIds[0] ?? "";
}

export const WEEK_PROMPT = "Help me plan this week. Ask if something important is missing, then give a short plan.";
export const FILE_PROMPT = "Summarize the attached file. List the main points and anything unclear.";

/** Map a system locale onto the two languages OpenBot ships. zh-TW uses the same Simplified UI. */
export function systemLanguage(locales?: readonly string[]): "en" | "zh-CN" {
	const value = (locales?.[0] ?? (typeof navigator === "undefined" ? "en" : navigator.languages?.[0] ?? navigator.language) ?? "en").toLowerCase();
	return value === "zh" || value.startsWith("zh-") ? "zh-CN" : "en";
}
