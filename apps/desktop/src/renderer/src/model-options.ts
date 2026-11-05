import type { ModelSummary, ProviderSummary } from "@openbot/protocol";

type ProviderFlag = Pick<ProviderSummary, "providerId" | "configured">;

/**
 * Models the default-model control can offer.
 * A custom provider is declared in the user's model file. Settings can briefly list only
 * built-ins as configured, before that file is applied; the custom model still has to be selectable.
 */
export function visibleModelOptions(
	models: readonly ModelSummary[],
	providers: readonly ProviderFlag[] | undefined,
): ModelSummary[] {
	const configured = new Set(providers?.filter((provider) => provider.configured).map((provider) => provider.providerId));
	return models.filter((model) => configured.has(model.provider) || model.source === "custom");
}

/** True while a refresh can still add the first selectable model. An empty configured catalog is settled. */
export function modelCatalogPending(
	models: readonly ModelSummary[],
	settings:
		| {
				readonly providers: readonly ProviderFlag[];
				readonly modelConfig: { readonly errors: readonly string[] };
		  }
		| undefined,
): boolean {
	if (visibleModelOptions(models, settings?.providers).length > 0) return false;
	if (settings === undefined || settings.modelConfig.errors.length > 0) return true;
	if (settings.providers.some((provider) => provider.configured)) return true;
	return models.length === 0;
}
