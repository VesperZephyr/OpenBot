/** Static recommendations. A card is hidden when models.list does not include its provider id. */
export const RECOMMENDED_PROVIDERS = [
	{ id: "minimax", name: "MiniMax", blurb: "Long context", modelId: "MiniMax-M3" },
	{ id: "deepseek", name: "DeepSeek", blurb: "General chat", modelId: "deepseek-flash" },
	{ id: "openrouter", name: "OpenRouter", blurb: "Many models", modelId: "openai/gpt-4o-mini" },
	{ id: "anthropic", name: "Anthropic", blurb: "Long-form writing", modelId: "claude-sonnet-4-6" },
	{ id: "openai", name: "OpenAI", blurb: "General use", modelId: "gpt-4o-mini" },
] as const;

export const WEEK_PROMPT = "Help me plan this week. Ask if something important is missing, then give a short plan.";
export const FILE_PROMPT = "Summarize the attached file. List the main points and anything unclear.";

export const LANGUAGE_CHOSEN = "openbot.language.chosen";

export function systemLanguage(): "en" | "zh-CN" {
	const value = (navigator.languages?.[0] ?? navigator.language ?? "en").toLowerCase();
	return value === "zh" || value.startsWith("zh-") ? "zh-CN" : "en";
}
