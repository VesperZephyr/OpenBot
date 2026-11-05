import type { ModelSummary, ProviderSummary } from "@openbot/protocol";

type ProviderFlag = Pick<ProviderSummary, "providerId" | "configured">;

/**
 * Option values for the default-model `<select>`, same rule as the pre-split Settings page:
 * `models.list` rows whose provider is configured. The value is `provider/modelId`.
 */
export function defaultModelOptionValues(
	models: readonly ModelSummary[],
	providers: readonly ProviderFlag[] | undefined,
): string[] {
	const configured = new Set(providers?.filter((provider) => provider.configured).map((provider) => provider.providerId));
	return models.filter((model) => configured.has(model.provider)).map((model) => `${model.provider}/${model.modelId}`);
}
