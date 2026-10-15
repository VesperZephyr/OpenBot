/**
 * Bring-your-own-key model configuration: the `providers` section of `~/.openbot/config.json`.
 *
 * The provider shape follows Pi's `models.json`, restricted to the APIs OpenBot supports, so entries can be copied
 * between the two. Parsing and provider construction are pure and synchronous; reading the file, environment access,
 * and `!command` execution are supplied by the Host. Credentials are resolved only when a request needs them and are
 * never stored in the returned status.
 */
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { type Api, type ApiKeyAuth, createProvider, type Model, type Provider } from "@earendil-works/pi-ai";
import { ProviderCompatSchema } from "@earendil-works/pi-ai/providers/compat-schema";
import {
	ModelCostSchema,
	ModelInputModalitySchema,
	ThinkingLevelMapSchema,
} from "@earendil-works/pi-ai/providers/model-schema";
import { type Static, Type } from "typebox";
import { Compile } from "typebox/compile";
import type { TLocalizedValidationError } from "typebox/error";

export const SUPPORTED_MODEL_APIS = ["openai-completions", "openai-responses", "anthropic-messages"] as const;

const PROVIDER_ID = /^[a-z0-9][a-z0-9_-]*$/;
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;

const ApiSchema = Type.Enum(SUPPORTED_MODEL_APIS);
const PositiveInteger = Type.Integer({ minimum: 1 });

const ModelSchema = Type.Object(
	{
		id: Type.String({ minLength: 1 }),
		name: Type.Optional(Type.String()),
		api: Type.Optional(ApiSchema),
		baseUrl: Type.Optional(Type.String({ minLength: 1 })),
		reasoning: Type.Optional(Type.Boolean()),
		input: Type.Optional(Type.Array(ModelInputModalitySchema)),
		contextWindow: Type.Optional(PositiveInteger),
		maxTokens: Type.Optional(PositiveInteger),
		cost: Type.Optional(ModelCostSchema),
		thinkingLevelMap: Type.Optional(ThinkingLevelMapSchema),
		compat: Type.Optional(ProviderCompatSchema),
	},
	{ additionalProperties: false },
);

const ProviderSchema = Type.Object(
	{
		name: Type.Optional(Type.String()),
		baseUrl: Type.String({ minLength: 1 }),
		api: ApiSchema,
		apiKey: Type.Optional(Type.String({ minLength: 1 })),
		headers: Type.Optional(Type.Record(Type.String(), Type.String())),
		compat: Type.Optional(ProviderCompatSchema),
		models: Type.Array(ModelSchema, { minItems: 1 }),
	},
	{ additionalProperties: false },
);

const ConfigSchema = Type.Object(
	{
		$schema: Type.Optional(Type.String()),
		providers: Type.Optional(Type.Record(Type.String(), ProviderSchema)),
	},
	{ additionalProperties: false },
);

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
 * Parse configuration text and build one pi-ai provider per valid entry. `undefined` text means there is no file.
 * A file that does not parse or validate yields no providers; a provider that cannot be built is skipped alone.
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

	const providers: Provider[] = [];
	const statuses: ConfiguredProviderStatus[] = [];
	const errors: string[] = [];
	for (const [providerId, config] of Object.entries(parsed.providers ?? {})) {
		if (!PROVIDER_ID.test(providerId)) {
			errors.push(`providers.${providerId}: IDs use lowercase letters, digits, "-" and "_"`);
			continue;
		}
		if (options.reservedIds.has(providerId)) {
			errors.push(`providers.${providerId}: "${providerId}" is a built-in provider; choose another ID`);
			continue;
		}
		const duplicate = findDuplicate(config.models.map((model) => model.id));
		if (duplicate !== undefined) {
			errors.push(`providers.${providerId}.models: model "${duplicate}" is listed twice`);
			continue;
		}
		const name = config.name ?? providerId;
		providers.push(
			createProvider({
				id: providerId,
				name,
				baseUrl: config.baseUrl,
				auth: { apiKey: configuredKeyAuth(name, config, options.environment) },
				models: config.models.map((model) => toModel(providerId, config, model, options.catalog)),
				api: {
					"openai-completions": openAICompletionsApi(),
					"openai-responses": openAIResponsesApi(),
					"anthropic-messages": anthropicMessagesApi(),
				},
			}),
		);
		statuses.push({
			providerId,
			name,
			keyAvailable: config.apiKey === undefined || referencedVariables(config.apiKey).every((v) => options.environment.env(v) !== undefined),
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
 * and a gateway relaying the same model often rejects those request features. Configure `compat` explicitly instead.
 */
function toModel(providerId: string, provider: ProviderConfig, entry: ModelConfig, catalog: readonly Model<Api>[]): Model<Api> {
	const api = entry.api ?? provider.api;
	const sameApi = catalog.find((model) => model.id === entry.id && model.api === api);
	const known = sameApi ?? catalog.find((model) => model.id === entry.id);
	const thinkingLevelMap = entry.thinkingLevelMap ?? sameApi?.thinkingLevelMap;
	// The schema accepts the union of every API's compat fields, as Pi's models.json does; each API reads only its own.
	const compat = { ...provider.compat, ...entry.compat } as NonNullable<Model<Api>["compat"]>;
	return {
		id: entry.id,
		name: entry.name ?? known?.name ?? entry.id,
		api,
		provider: providerId,
		baseUrl: entry.baseUrl ?? provider.baseUrl,
		reasoning: entry.reasoning ?? known?.reasoning ?? false,
		input: entry.input ?? known?.input ?? ["text"],
		cost: entry.cost ?? known?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: entry.contextWindow ?? known?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
		maxTokens: entry.maxTokens ?? known?.maxTokens ?? DEFAULT_MAX_TOKENS,
		...(thinkingLevelMap === undefined ? {} : { thinkingLevelMap }),
		...(sameApi?.promptCache === undefined ? {} : { promptCache: sameApi.promptCache }),
		...(sameApi?.inputLimits === undefined ? {} : { inputLimits: sameApi.inputLimits }),
		...(Object.keys(compat).length === 0 ? {} : { compat }),
	};
}

/**
 * A key stored in the Keychain (pi-ai's credential store) wins over the configured `apiKey`; headers are always
 * resolved from the configuration. A provider without `apiKey` is treated as keyless.
 */
function configuredKeyAuth(name: string, config: ProviderConfig, environment: ConfigEnvironment): ApiKeyAuth {
	const rawKey = config.apiKey;
	const rawHeaders = config.headers;
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

/** Strip `//` line comments and trailing commas, leaving string literals untouched (same rules as Pi). */
function stripJsonComments(input: string): string {
	return input
		.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/g, (match) => (match[0] === '"' ? match : ""))
		.replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (match, tail: string | undefined) => tail ?? (match[0] === '"' ? match : ""));
}

function describeValidationError(error: TLocalizedValidationError): string[] {
	const path = error.instancePath.replace(/^\//, "").replaceAll("/", ".");
	switch (error.keyword) {
		// Each unknown property also fails its `false` property schema; the additionalProperties entry names it.
		case "boolean":
			return [];
		case "additionalProperties": {
			const names = (error.params as { additionalProperties?: string[] }).additionalProperties ?? [];
			return names.map((name) => `${path === "" ? name : `${path}.${name}`}: unknown property`);
		}
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

function findDuplicate(values: readonly string[]): string | undefined {
	const seen = new Set<string>();
	for (const value of values) {
		if (seen.has(value)) return value;
		seen.add(value);
	}
	return undefined;
}
