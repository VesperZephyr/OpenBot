import type { ModelRef } from "./models.ts";

export type ProviderSummary = {
	readonly providerId: string;
	readonly name: string;
	/** `builtin` providers ship with OpenBot; `config` providers come from the user's model configuration file. */
	readonly source: "builtin" | "config";
	/** The local file overrides a bundled provider. */
	readonly overlay?: boolean;
	/** A key is available: stored in the Keychain, or (config providers) resolvable from the configuration. */
	readonly configured: boolean;
	/** A key is stored in the Keychain for this provider. */
	readonly keyStored: boolean;
};

/** Settings as returned to renderers: credentials are never included, only whether one is stored. */
export type RedactedSettings = {
	readonly setupComplete?: boolean;
	readonly language?: "en" | "zh-CN";
	/** The user picked a language. Absent or false means the wizard may still follow the system locale. */
	readonly languageChosen?: boolean;
	readonly defaultModel?: ModelRef;
	readonly providers: readonly ProviderSummary[];
	readonly dataDirectory: string;
	/** The user's model configuration file and its problems; re-read whenever settings are fetched. */
	readonly modelConfig: { readonly path: string; readonly errors: readonly string[] };
	/** The shared folder every Bot may read and write without asking; commands still ask. */
	readonly workspace: string;
	/** The `web_search` provider and whether its key (provider ID `search:tavily`) is stored. */
	readonly webSearch: { readonly provider: "tavily"; readonly configured: boolean };
};
