/**
 * Bring-your-own-key model configuration: `~/.openbot/models.json`, with the same shape and meaning as Pi's
 * `models.json`, restricted to the chat APIs OpenBot ships:
 *
 * - An entry whose ID is a built-in provider overlays it: `baseUrl`, `headers`, `compat`, and `apiKey` apply to every
 *   built-in model, `models` adds or replaces models, and `modelOverrides` patches individual ones. Streaming and
 *   stored-key login come from the built-in provider.
 * - Any other ID declares a new provider; every model needs a `baseUrl` and an `api`, at model or provider level.
 *
 * The file may use `//` comments and trailing commas. Building providers is pure and synchronous; reading the file,
 * environment access, and `!command` execution belong to the Host. Credentials are resolved only for a request and are
 * never part of the returned status.
 */
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import {
	type Api,
	type ApiKeyAuth,
	type AuthResult,
	createProvider,
	isModelType,
	type Model,
	type Provider,
	type ProviderStreams,
} from "@earendil-works/pi-ai";
import { ProviderCompatSchema } from "@earendil-works/pi-ai/providers/compat-schema";
import {
	ModelCostSchema,
	ModelInputLimitsSchema,
	ModelInputModalitySchema,
	ModelPromptCacheSchema,
	ThinkingLevelMapSchema,
} from "@earendil-works/pi-ai/providers/model-schema";
import { type Static, Type } from "typebox";
import { Compile } from "typebox/compile";
import type { TLocalizedValidationError } from "typebox/error";

export const SUPPORTED_MODEL_APIS = ["openai-completions", "openai-responses", "anthropic-messages"] as const;

const STREAMS: Record<(typeof SUPPORTED_MODEL_APIS)[number], ProviderStreams> = {
	"openai-completions": openAICompletionsApi(),
	"openai-responses": openAIResponsesApi(),
	"anthropic-messages": anthropicMessagesApi(),
};

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;

const ApiSchema = Type.Enum(SUPPORTED_MODEL_APIS);
const TokenCount = Type.Number({ exclusiveMinimum: 0 });
const HeadersSchema = Type.Record(Type.String(), Type.String());

const modelFields = {
	name: Type.Optional(Type.String({ minLength: 1 })),
	reasoning: Type.Optional(Type.Boolean()),
	thinkingLevelMap: Type.Optional(ThinkingLevelMapSchema),
	input: Type.Optional(Type.Array(ModelInputModalitySchema)),
	inputLimits: Type.Optional(ModelInputLimitsSchema),
	promptCache: Type.Optional(ModelPromptCacheSchema),
	contextWindow: Type.Optional(TokenCount),
	maxTokens: Type.Optional(TokenCount),
	headers: Type.Optional(HeadersSchema),
	compat: Type.Optional(ProviderCompatSchema),
};

const ModelDefinitionSchema = Type.Object(
	{
		id: Type.String({ minLength: 1 }),
		api: Type.Optional(ApiSchema),
		baseUrl: Type.Optional(Type.String({ minLength: 1 })),
		cost: Type.Optional(ModelCostSchema),
		...modelFields,
	},
	{ additionalProperties: false },
);

const ModelOverrideSchema = Type.Object(
	{ cost: Type.Optional(Type.Partial(ModelCostSchema)), ...modelFields },
	{ additionalProperties: false },
);

const ProviderConfigSchema = Type.Object(
	{
		name: Type.Optional(Type.String({ minLength: 1 })),
		baseUrl: Type.Optional(Type.String({ minLength: 1 })),
		api: Type.Optional(ApiSchema),
		apiKey: Type.Optional(Type.String({ minLength: 1 })),
		headers: Type.Optional(HeadersSchema),
		authHeader: Type.Optional(Type.Boolean()),
		compat: Type.Optional(ProviderCompatSchema),
		models: Type.Optional(Type.Array(ModelDefinitionSchema)),
		modelOverrides: Type.Optional(Type.Record(Type.String(), ModelOverrideSchema)),
	},
	{ additionalProperties: false },
);

const ConfigSchema = Type.Object(
	{ $schema: Type.Optional(Type.String()), providers: Type.Record(Type.String(), ProviderConfigSchema) },
	{ additionalProperties: false },
);

const validateConfig = Compile(ConfigSchema);

type ProviderConfig = Static<typeof ProviderConfigSchema>;
type ModelDefinition = Static<typeof ModelDefinitionSchema>;
type ModelOverride = Static<typeof ModelOverrideSchema>;

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
	/** The entry overlays a built-in provider instead of declaring a new one. */
	readonly overlay: boolean;
	/** The entry sets its own `apiKey`. */
	readonly keyConfigured: boolean;
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
	/** Built-in providers by ID: entries with these IDs overlay them. */
	readonly builtins: ReadonlyMap<string, Provider>;
};

/**
 * Parse configuration text and build one pi-ai provider per valid entry; the Host registers each with
 * `setProvider`, replacing a built-in of the same ID. `undefined` text means there is no file. A file that does not
 * parse or validate yields no providers; a provider that cannot be built is skipped alone.
 */
export function buildConfiguredProviders(text: string | undefined, options: ModelConfigOptions): ModelConfigBuild {
	if (text === undefined) return { providers: [], status: { providers: [], errors: [] } };

	let parsed: unknown;
	try {
		parsed = JSON.parse(stripJsonComments(text.replace(/^\uFEFF/, "")));
	} catch (error) {
		return failed(`Not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!validateConfig.Check(parsed)) {
		const errors = validateConfig.Errors(parsed).flatMap(describeValidationError);
		return failed(...(errors.length > 0 ? errors : ["Invalid configuration"]));
	}

	const catalog = [...options.builtins.values()].flatMap((provider) =>
		provider.getModels().filter((model) => isModelType(model, "chat")),
	);
	const providers: Provider[] = [];
	const statuses: ConfiguredProviderStatus[] = [];
	const errors: string[] = [];
	for (const [providerId, config] of Object.entries(parsed.providers)) {
		try {
			const base = options.builtins.get(providerId);
			const provider =
				base === undefined
					? newProvider(providerId, config, catalog, options.environment)
					: overlayProvider(base, config, options.environment);
			providers.push(provider);
			statuses.push({
				providerId,
				name: provider.name,
				overlay: base !== undefined,
				keyConfigured: config.apiKey !== undefined,
				keyAvailable:
					config.apiKey === undefined ||
					referencedVariables(config.apiKey).every((name) => options.environment.env(name) !== undefined),
			});
		} catch (error) {
			errors.push(`providers.${providerId}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return { providers, status: { providers: statuses, errors } };
}

function failed(...errors: string[]): ModelConfigBuild {
	return { providers: [], status: { providers: [], errors } };
}

function newProvider(
	providerId: string,
	config: ProviderConfig,
	catalog: readonly Model<Api>[],
	environment: ConfigEnvironment,
): Provider {
	const definitions = config.models ?? [];
	if (definitions.length === 0) throw new Error(`list at least one model in "models"`);
	const models = definitions.map((definition) => {
		const known = findDefaults(catalog, definition.id, definition.api ?? config.api);
		return applyOverride(modelFromDefinition(providerId, config, definition, known), config.modelOverrides?.[definition.id]);
	});
	return createProvider({
		id: providerId,
		name: config.name ?? providerId,
		...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
		auth: { apiKey: configuredKeyAuth(config, environment, undefined) },
		models,
		api: STREAMS,
	});
}

/** A built-in provider with the user's endpoint, headers, key, extra models, and per-model overrides. */
function overlayProvider(base: Provider, config: ProviderConfig, environment: ConfigEnvironment): Provider {
	if (
		config.baseUrl === undefined &&
		config.headers === undefined &&
		config.compat === undefined &&
		config.apiKey === undefined &&
		config.authHeader === undefined &&
		(config.models?.length ?? 0) === 0 &&
		Object.keys(config.modelOverrides ?? {}).length === 0
	) {
		throw new Error(`set "baseUrl", "apiKey", "headers", "compat", "models", or "modelOverrides"`);
	}
	const baseModels = base.getModels();
	const models: Model<Api>[] = baseModels.map((model) => ({
		...model,
		baseUrl: config.baseUrl ?? model.baseUrl,
		...mergedCompat(model.compat, config.compat),
	}));
	// A new model without `api`/`baseUrl` uses the transport of the provider's first model, as in Pi.
	const transport = models[0];
	for (const definition of config.models ?? []) {
		const known = findDefaults(models, definition.id, definition.api ?? config.api);
		const model = modelFromDefinition(base.id, config, definition, known, transport);
		const index = models.findIndex((entry) => entry.id === definition.id);
		if (index >= 0) models[index] = model;
		else models.push(model);
	}
	const patched = models.map((model) => applyOverride(model, config.modelOverrides?.[model.id]));
	const baseApis = new Set(baseModels.map((model) => model.api));
	const streamFor = (model: Model<Api>) =>
		baseApis.has(model.api) ? base : STREAMS[model.api as keyof typeof STREAMS];
	// The built-in's dynamic catalog would replace the configured list, so an overlaid provider is static.
	const { refreshModels: _dynamicCatalog, ...builtin } = base;
	return {
		...builtin,
		name: config.name ?? base.name,
		...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
		auth: { ...base.auth, apiKey: configuredKeyAuth(config, environment, base.auth.apiKey) },
		getModels: () => patched,
		getAllModels: () => patched,
		stream: (model, context, options) => streamFor(model).stream(model, context, options),
		streamSimple: (model, context, options) => streamFor(model).streamSimple(model, context, options),
	};
}

/** The catalog model a definition inherits omitted fields from: same ID and API first, then same ID. */
function findDefaults(catalog: readonly Model<Api>[], id: string, api: string | undefined): Model<Api> | undefined {
	return (
		catalog.find((model) => model.id === id && (api === undefined || model.api === api)) ??
		catalog.find((model) => model.id === id)
	);
}

/**
 * A model from a `models` entry. Capability metadata (name, reasoning, input, limits, cost) comes from a known
 * model with the same ID when the entry omits it; thinking levels and cache metadata only when the API matches.
 * Transport `compat` is never inherited across providers: it describes a vendor endpoint, and gateways relaying the
 * same model often reject those request features. Set `compat` explicitly when the endpoint supports them.
 */
function modelFromDefinition(
	providerId: string,
	config: ProviderConfig,
	definition: ModelDefinition,
	known: Model<Api> | undefined,
	transport?: Pick<Model<Api>, "api" | "baseUrl">,
): Model<Api> {
	const api = definition.api ?? config.api ?? known?.api ?? transport?.api;
	if (api === undefined) throw new Error(`model ${definition.id}: set "api" on the model or the provider`);
	const baseUrl = definition.baseUrl ?? config.baseUrl ?? known?.baseUrl ?? transport?.baseUrl;
	if (baseUrl === undefined) throw new Error(`model ${definition.id}: set "baseUrl" on the model or the provider`);
	const sameApi = known?.api === api ? known : undefined;
	const thinkingLevelMap = definition.thinkingLevelMap ?? sameApi?.thinkingLevelMap;
	const promptCache = definition.promptCache ?? sameApi?.promptCache;
	const inputLimits = definition.inputLimits ?? sameApi?.inputLimits;
	return {
		id: definition.id,
		name: definition.name ?? known?.name ?? definition.id,
		api,
		provider: providerId,
		baseUrl,
		reasoning: definition.reasoning ?? known?.reasoning ?? false,
		input: definition.input ?? known?.input ?? ["text"],
		cost: definition.cost ?? known?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: definition.contextWindow ?? known?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
		maxTokens: definition.maxTokens ?? known?.maxTokens ?? DEFAULT_MAX_TOKENS,
		...(thinkingLevelMap === undefined ? {} : { thinkingLevelMap }),
		...(promptCache === undefined ? {} : { promptCache }),
		...(inputLimits === undefined ? {} : { inputLimits }),
		...(definition.headers === undefined ? {} : { headers: definition.headers }),
		...mergedCompat(config.compat, definition.compat),
	};
}

function applyOverride(model: Model<Api>, override: ModelOverride | undefined): Model<Api> {
	if (override === undefined) return model;
	const { cost, compat, headers, thinkingLevelMap, promptCache, ...fields } = override;
	return {
		...model,
		...fields,
		...(cost === undefined ? {} : { cost: { ...model.cost, ...cost } }),
		...(thinkingLevelMap === undefined ? {} : { thinkingLevelMap: { ...model.thinkingLevelMap, ...thinkingLevelMap } }),
		...(promptCache === undefined ? {} : { promptCache: { ...model.promptCache, ...promptCache } }),
		...(headers === undefined ? {} : { headers: { ...model.headers, ...headers } }),
		...mergedCompat(model.compat, compat),
	};
}

function mergedCompat(base: Model<Api>["compat"], extra: object | undefined): { compat?: NonNullable<Model<Api>["compat"]> } {
	// The schema accepts the union of every API's compat fields, as Pi does; each API reads only its own.
	const compat = { ...base, ...extra } as NonNullable<Model<Api>["compat"]>;
	return Object.keys(compat).length === 0 ? {} : { compat };
}

/**
 * Key precedence, as in Pi: a key stored in the Keychain, then the configured `apiKey`, then the built-in provider's
 * own sources (its environment variables). Configured headers apply to every resolution, and `authHeader` also sends
 * the key as `Authorization: Bearer`.
 */
function configuredKeyAuth(
	config: ProviderConfig,
	environment: ConfigEnvironment,
	inherited: ApiKeyAuth | undefined,
): ApiKeyAuth {
	const rawKey = config.apiKey;
	const withConfigured = async (result: AuthResult | undefined): Promise<AuthResult | undefined> => {
		if (result === undefined) return undefined;
		let headers = result.auth.headers;
		if (config.headers !== undefined) {
			const resolved = await Promise.all(
				Object.entries(config.headers).map(
					async ([name, value]) => [name, await resolveConfigValue(value, environment, `header "${name}"`)] as const,
				),
			);
			headers = { ...headers, ...Object.fromEntries(resolved) };
		}
		if (config.authHeader === true) {
			if (result.auth.apiKey === undefined) throw new Error('"authHeader" needs an API key');
			headers = { ...headers, Authorization: `Bearer ${result.auth.apiKey}` };
		}
		return headers === undefined ? result : { ...result, auth: { ...result.auth, headers } };
	};
	return {
		name: inherited?.name ?? "API key",
		check: async (input) => {
			if (input.credential?.key) return { type: "api_key", source: "stored credential" };
			if (rawKey !== undefined) {
				const available = referencedVariables(rawKey).every((name) => environment.env(name) !== undefined);
				return available ? { type: "api_key", source: "configured API key" } : undefined;
			}
			if (inherited === undefined) return { type: "api_key", source: "keyless" };
			if (inherited.check !== undefined) return inherited.check(input);
			const resolved = await inherited.resolve(input);
			return resolved === undefined ? undefined : { type: "api_key", source: resolved.source ?? "provider" };
		},
		resolve: async (input) => {
			input.signal.throwIfAborted();
			if (input.credential?.key) {
				return withConfigured({ auth: { apiKey: input.credential.key }, source: "stored credential" });
			}
			if (rawKey !== undefined) {
				const apiKey = await resolveConfigValue(rawKey, environment, "apiKey");
				input.signal.throwIfAborted();
				return withConfigured({ auth: { apiKey }, source: "configured API key" });
			}
			if (inherited === undefined) return withConfigured({ auth: {}, source: "keyless" });
			return withConfigured(await inherited.resolve(input));
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

/** Strip `//` line comments and trailing commas, leaving string literals untouched (same rules as Pi). */
function stripJsonComments(input: string): string {
	return input
		.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/g, (match) => (match[0] === '"' ? match : ""))
		.replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (match, tail: string | undefined) => tail ?? (match[0] === '"' ? match : ""));
}

function describeValidationError(error: TLocalizedValidationError): string[] {
	const path = error.instancePath.replace(/^\//, "").replaceAll("/", ".");
	const at = (name?: string) => (name === undefined ? path || "root" : path === "" ? name : `${path}.${name}`);
	switch (error.keyword) {
		// Each unknown property also fails its `false` property schema; the additionalProperties entry names it.
		case "boolean":
			return [];
		case "additionalProperties":
			return ((error.params as { additionalProperties?: string[] }).additionalProperties ?? []).map(
				(name) => `${at(name)}: unknown property`,
			);
		case "required":
			return ((error.params as { requiredProperties?: string[] }).requiredProperties ?? []).map(
				(name) => `${at(name)}: required`,
			);
		case "enum": {
			const allowed = (error.params as { allowedValues?: unknown[] }).allowedValues ?? [];
			return [`${at()}: must be one of ${allowed.map((value) => JSON.stringify(value)).join(", ")}`];
		}
		default:
			return [`${at()}: ${error.message}`];
	}
}
