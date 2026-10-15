/**
 * Bring-your-own-key model configuration: the `custom_provider` section of `~/.openbot/config.yaml`.
 *
 * The shape is the essential subset of MiniMax Code's `custom_provider` entries, so a block copied from
 * `~/.minimax/config.yaml` works unchanged; fields OpenBot does not use (`kind`, `authMode`, `whitelist`, `tool_call`,
 * ...) are ignored. Parsing and provider construction are pure and synchronous; reading the file, environment access,
 * and `!command` execution are supplied by the Host. Credentials are resolved only when a request needs them and are
 * never stored in the returned status.
 */
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { type Api, type ApiKeyAuth, createProvider, type Model, type Provider } from "@earendil-works/pi-ai";
import { type Static, Type } from "typebox";
import { Compile } from "typebox/compile";
import type { TLocalizedValidationError } from "typebox/error";
import { parse as parseYaml } from "yaml";

export const SUPPORTED_MODEL_APIS = ["openai-completions", "openai-responses", "anthropic-messages"] as const;

const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;

const PositiveInteger = Type.Integer({ minimum: 1 });

const ModelSchema = Type.Object({
	name: Type.Optional(Type.String()),
	reasoning: Type.Optional(Type.Boolean()),
	limit: Type.Optional(Type.Object({ context: Type.Optional(PositiveInteger), output: Type.Optional(PositiveInteger) })),
	modalities: Type.Optional(Type.Object({ input: Type.Optional(Type.Array(Type.String())) })),
});

const ProviderSchema = Type.Object({
	name: Type.Optional(Type.String()),
	enabled: Type.Optional(Type.Boolean()),
	api: Type.Enum(SUPPORTED_MODEL_APIS),
	options: Type.Object({
		baseURL: Type.String({ minLength: 1 }),
		apiKey: Type.Optional(Type.String({ minLength: 1 })),
		headers: Type.Optional(Type.Record(Type.String(), Type.String())),
	}),
	// `gpt-5.5:` with nothing after it is YAML null: a model that takes every field from the catalog or defaults.
	models: Type.Record(Type.String(), Type.Union([ModelSchema, Type.Null()])),
});

const ConfigSchema = Type.Object({
	custom_provider: Type.Optional(Type.Record(Type.String(), ProviderSchema)),
});

const validateConfig = Compile(ConfigSchema);

type ProviderConfig = Static<typeof ProviderSchema>;
type ModelConfig = Static<typeof ModelSchema>;

/** How the Host lets configuration values reach the environment and the shell. */
export type ConfigEnvironment = {
	/** A variable from the environment the Host was launched with. */
	env(name: string): string | undefined;
	/** Run a `!command` value and return its trimmed standard output. Rejects on failure or timeout. */
	run(command: string): Promise<string>;
};

export type ConfiguredProviderStatus = {
	readonly providerId: string;
	readonly name: string;
	/** False when the configured key names an environment variable that is not set. */
	readonly keyAvailable: boolean;
};

export type ModelConfigStatus = {
	readonly providers: readonly ConfiguredProviderStatus[];
	/** File-level and per-provider problems, each prefixed with where it occurred. */
	readonly errors: readonly string[];
};

export type ModelConfigBuild = { readonly providers: readonly Provider[]; readonly status: ModelConfigStatus };

export type ModelConfigOptions = {
	readonly environment: ConfigEnvironment;
	/** Built-in models whose metadata a configured model with the same ID inherits. */
	readonly catalog: readonly Model<Api>[];
	/** Provider IDs that are already taken by built-in providers. */
	readonly reservedIds: ReadonlySet<string>;
};

/**
 * Parse configuration text and build one pi-ai provider per valid, enabled entry. `undefined` text means there is no
 * file. A file that does not parse or validate yields no providers; a provider that cannot be built is skipped alone.
 */
export function buildConfiguredProviders(text: string | undefined, options: ModelConfigOptions): ModelConfigBuild {
	if (text === undefined) return { providers: [], status: { providers: [], errors: [] } };

	let parsed: unknown;
	try {
		parsed = parseYaml(text) ?? {};
	} catch (error) {
		return failed(`Not valid YAML: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!validateConfig.Check(parsed)) {
		const errors = validateConfig.Errors(parsed).flatMap(describeValidationError);
		return failed(...(errors.length > 0 ? errors : ["Invalid configuration"]));
	}

	const providers: Provider[] = [];
	const statuses: ConfiguredProviderStatus[] = [];
	const errors: string[] = [];
	for (const [providerId, config] of Object.entries(parsed.custom_provider ?? {})) {
		if (config.enabled === false) continue;
		const where = `custom_provider.${providerId}`;
		if (!PROVIDER_ID.test(providerId)) {
			errors.push(`${where}: IDs use letters, digits, "-" and "_"`);
			continue;
		}
		if (options.reservedIds.has(providerId)) {
			errors.push(`${where}: "${providerId}" is a built-in provider; choose another ID`);
			continue;
		}
		const modelEntries = Object.entries(config.models);
		if (modelEntries.length === 0) {
			errors.push(`${where}.models: list at least one model`);
			continue;
		}
		const name = config.name ?? providerId;
		providers.push(
			createProvider({
				id: providerId,
				name,
				baseUrl: config.options.baseURL,
				auth: { apiKey: configuredKeyAuth(name, config, options.environment) },
				models: modelEntries.map(([id, entry]) => toModel(providerId, config, id, entry, options.catalog)),
				api: {
					"openai-completions": openAICompletionsApi(),
					"openai-responses": openAIResponsesApi(),
					"anthropic-messages": anthropicMessagesApi(),
				},
			}),
		);
		const rawKey = config.options.apiKey;
		statuses.push({
			providerId,
			name,
			keyAvailable: rawKey === undefined || referencedVariables(rawKey).every((v) => options.environment.env(v) !== undefined),
		});
	}
	return { providers, status: { providers: statuses, errors } };
}

function failed(...errors: string[]): ModelConfigBuild {
	return { providers: [], status: { providers: [], errors } };
}

/**
 * A configured model. When the built-in catalog knows the same model ID, its capability metadata (name, reasoning,
 * input, limits, cost) fills every field the entry leaves out; thinking levels and cache metadata are inherited only
 * when the API matches too. Transport `compat` flags are never inherited: they describe the vendor's own endpoint,
 * and a gateway relaying the same model often rejects those request features.
 */
function toModel(
	providerId: string,
	provider: ProviderConfig,
	id: string,
	entry: ModelConfig | null,
	catalog: readonly Model<Api>[],
): Model<Api> {
	const api = provider.api;
	const sameApi = catalog.find((model) => model.id === id && model.api === api);
	const known = sameApi ?? catalog.find((model) => model.id === id);
	// MiniMax lists inputs such as "pdf" and "video"; pi-ai models accept text and images.
	const input = entry?.modalities?.input?.filter((modality) => modality === "text" || modality === "image");
	return {
		id,
		name: entry?.name ?? known?.name ?? id,
		api,
		provider: providerId,
		baseUrl: endpoint(provider),
		reasoning: entry?.reasoning ?? known?.reasoning ?? false,
		input: input !== undefined && input.length > 0 ? input : (known?.input ?? ["text"]),
		cost: known?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: entry?.limit?.context ?? known?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
		maxTokens: entry?.limit?.output ?? known?.maxTokens ?? DEFAULT_MAX_TOKENS,
		...(sameApi?.thinkingLevelMap === undefined ? {} : { thinkingLevelMap: sameApi.thinkingLevelMap }),
		...(sameApi?.promptCache === undefined ? {} : { promptCache: sameApi.promptCache }),
		...(sameApi?.inputLimits === undefined ? {} : { inputLimits: sameApi.inputLimits }),
	};
}

/**
 * MiniMax configs write Anthropic endpoints with the same `/v1` suffix as OpenAI ones; the Anthropic SDK appends
 * `/v1/messages` itself, so the suffix is dropped for that API.
 */
function endpoint(provider: ProviderConfig): string {
	const { baseURL } = provider.options;
	return provider.api === "anthropic-messages" ? baseURL.replace(/\/v1\/?$/, "") : baseURL;
}

/**
 * A key stored in the Keychain (pi-ai's credential store) wins over the configured `apiKey`; headers are always
 * resolved from the configuration. A provider without `apiKey` is treated as keyless.
 */
function configuredKeyAuth(name: string, config: ProviderConfig, environment: ConfigEnvironment): ApiKeyAuth {
	const rawKey = config.options.apiKey;
	const rawHeaders = config.options.headers;
	const resolveHeaders = async (): Promise<Record<string, string> | undefined> => {
		if (rawHeaders === undefined) return undefined;
		const entries = await Promise.all(
			Object.entries(rawHeaders).map(
				async ([header, value]) => [header, await resolveConfigValue(value, environment, `header "${header}"`)] as const,
			),
		);
		return Object.fromEntries(entries);
	};
	return {
		name: `${name} API key`,
		check: async ({ credential }) => {
			if (credential?.key) return { type: "api_key", source: "stored credential" };
			if (rawKey === undefined) return { type: "api_key", source: "keyless" };
			const available = referencedVariables(rawKey).every((variable) => environment.env(variable) !== undefined);
			return available ? { type: "api_key", source: "configured API key" } : undefined;
		},
		resolve: async ({ credential, signal }) => {
			signal.throwIfAborted();
			const headers = await resolveHeaders();
			const withHeaders = headers === undefined ? {} : { headers };
			if (credential?.key) return { auth: { apiKey: credential.key, ...withHeaders }, source: "stored credential" };
			if (rawKey === undefined) return { auth: withHeaders, source: "keyless" };
			const apiKey = await resolveConfigValue(rawKey, environment, "apiKey");
			signal.throwIfAborted();
			return { auth: { apiKey, ...withHeaders }, source: "configured API key" };
		},
	};
}

// ---------------------------------------------------------------------------
// Value grammar, as in Pi's models.json: `!command` runs a shell command; otherwise `$NAME` and `${NAME}` expand
// environment variables, `$$` and `$!` escape `$` and `!`, and everything else is literal.

type TemplatePart = { readonly literal: string } | { readonly variable: string };
type ConfigValue = { readonly command: string } | { readonly template: readonly TemplatePart[] };

const VARIABLE_PREFIX = /^[A-Za-z_][A-Za-z0-9_]*/;
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function parseConfigValue(raw: string): ConfigValue {
	if (raw.startsWith("!")) return { command: raw.slice(1).trim() };
	const parts: TemplatePart[] = [];
	let literal = "";
	const pushVariable = (variable: string): void => {
		if (literal !== "") parts.push({ literal });
		literal = "";
		parts.push({ variable });
	};
	let index = 0;
	while (index < raw.length) {
		const char = raw[index] as string;
		if (char !== "$") {
			literal += char;
			index += 1;
			continue;
		}
		const rest = raw.slice(index + 1);
		if (rest.startsWith("$") || rest.startsWith("!")) {
			literal += rest[0];
			index += 2;
			continue;
		}
		if (rest.startsWith("{")) {
			const end = rest.indexOf("}");
			const name = end < 0 ? "" : rest.slice(1, end);
			if (VARIABLE_NAME.test(name)) {
				pushVariable(name);
				index += end + 2;
				continue;
			}
		} else {
			const name = rest.match(VARIABLE_PREFIX)?.[0];
			if (name !== undefined) {
				pushVariable(name);
				index += name.length + 1;
				continue;
			}
		}
		literal += "$";
		index += 1;
	}
	if (literal !== "") parts.push({ literal });
	return { template: parts };
}

function referencedVariables(raw: string): string[] {
	const value = parseConfigValue(raw);
	return "command" in value ? [] : value.template.flatMap((part) => ("variable" in part ? [part.variable] : []));
}

/** Resolve one configuration value. The error names the field, never the value. */
export async function resolveConfigValue(raw: string, environment: ConfigEnvironment, field: string): Promise<string> {
	const value = parseConfigValue(raw);
	if ("command" in value) {
		if (value.command === "") throw new Error(`${field}: empty command`);
		const output = await environment.run(value.command);
		if (output === "") throw new Error(`${field}: command printed nothing`);
		return output;
	}
	let resolved = "";
	for (const part of value.template) {
		if ("literal" in part) {
			resolved += part.literal;
			continue;
		}
		const variable = environment.env(part.variable);
		if (variable === undefined) throw new Error(`${field}: environment variable ${part.variable} is not set`);
		resolved += variable;
	}
	return resolved;
}

// ---------------------------------------------------------------------------

function describeValidationError(error: TLocalizedValidationError): string[] {
	const path = error.instancePath.replace(/^\//, "").replaceAll("/", ".");
	switch (error.keyword) {
		// A model entry fails both union branches; report the object branch only.
		case "anyOf":
			return [];
		case "type":
			if ((error.params as { type?: string }).type === "null") return [];
			return [`${path === "" ? "root" : path}: ${error.message}`];
		case "required": {
			const names = (error.params as { requiredProperties?: string[] }).requiredProperties ?? [];
			return names.map((name) => `${path === "" ? name : `${path}.${name}`}: required`);
		}
		case "enum": {
			const allowed = (error.params as { allowedValues?: unknown[] }).allowedValues ?? [];
			return [`${path === "" ? "root" : path}: must be one of ${allowed.map((value) => JSON.stringify(value)).join(", ")}`];
		}
		default:
			return [`${path === "" ? "root" : path}: ${error.message}`];
	}
}


