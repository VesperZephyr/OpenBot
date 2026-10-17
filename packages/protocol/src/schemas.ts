/**
 * Runtime schemas for the params of every Host method. Desktop main checks a renderer call before forwarding it, and
 * the Host checks every request before dispatch, so a handler only ever sees params of its declared shape. Handlers
 * still enforce rules that need state or meaning (an empty message, an unknown Bot, a URL scheme).
 */
import { type Static, type TSchema, Type } from "typebox";
import { Compile, type Validator } from "typebox/compile";
import type { TLocalizedValidationError } from "typebox/error";
import { type HostMethod, type HostParams, MODEL_APIS } from "./index.ts";

const Id = Type.String({ minLength: 1, maxLength: 256 });
const NoParams = Type.Object({}, { additionalProperties: false });
const strict = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const ModelRef = strict({ provider: Id, modelId: Id });
const ThinkingLevel = Type.Enum(["off", "low", "medium", "high"]);
const BotOnly = strict({ botId: Id });
const GrantAccess = Type.Enum(["read", "readwrite"]);
const AlwaysAllowScope = Type.Union([
	strict({
		kind: Type.Literal("command"),
		rule: strict({
			program: Type.String({ minLength: 1 }),
			subcommand: Type.Optional(Type.String({ minLength: 1 })),
			exact: Type.Optional(Type.String({ minLength: 1 })),
		}),
	}),
	strict({ kind: Type.Literal("folder"), path: Type.String({ minLength: 1, maxLength: 4096 }), access: GrantAccess }),
]);

/** Provider IDs declared from the app: lower-case, file- and Keychain-friendly, never a `search:` key. */
export const PROVIDER_ID_PATTERN = "^[a-z0-9][a-z0-9._-]{0,63}$";

export const HOST_PARAM_SCHEMAS = {
	"host.status": NoParams,
	"bots.list": NoParams,
	"bots.management.history": NoParams,
	"bots.create": strict({
		requestId: Id,
		name: Type.String({ minLength: 1, maxLength: 200 }),
		role: Type.Optional(Type.String({ maxLength: 200 })),
		instructions: Type.Optional(Type.String()),
		model: Type.Optional(ModelRef),
	}),
	"bots.update": strict({
		botId: Id,
		name: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
		role: Type.Optional(Type.String({ maxLength: 200 })),
		instructions: Type.Optional(Type.String()),
		model: Type.Optional(Type.Union([ModelRef, Type.Null()])),
		thinkingLevel: Type.Optional(ThinkingLevel),
		pinned: Type.Optional(Type.Boolean()),
		status: Type.Optional(Type.Enum(["active", "hidden"])),
	}),
	"conversations.snapshot": BotOnly,
	"conversations.markRead": BotOnly,
	"messages.submit": strict({ botId: Id, requestId: Id, text: Type.String() }),
	"runs.cancel": strict({ runId: Id }),
	"approvals.decide": strict({
		approvalId: Id,
		decision: Type.Union([Type.Enum(["allow_once", "deny"]), strict({ kind: Type.Literal("always_allow"), scope: AlwaysAllowScope })]),
	}),
	"settings.get": NoParams,
	"settings.update": strict({ language: Type.Optional(Type.Union([Type.Literal("en"), Type.Literal("zh-CN")])), setupComplete: Type.Optional(Type.Boolean()), defaultModel: Type.Optional(Type.Union([ModelRef, Type.Null()])) }),
	"models.list": NoParams,
	"credentials.set": strict({ providerId: Id, apiKey: Type.String({ maxLength: 16_384 }) }),
	"credentials.delete": strict({ providerId: Id }),
	"bots.memory.get": BotOnly,
	"bots.memory.update": strict({ botId: Id, content: Type.String() }),
	"conversations.reset": BotOnly,
	"policy.get": NoParams,
	"policy.update": strict({
		commandSetting: Type.Optional(Type.Enum(["ask", "allow", "never"])),
		readOnlyDefault: Type.Optional(Type.Boolean()),
	}),
	"policy.rules.delete": strict({ id: Id }),
	"grants.list": NoParams,
	"grants.revoke": strict({ id: Id }),
	"grants.add": strict({ path: Type.String({ minLength: 1, maxLength: 4096 }), access: GrantAccess }),
	"models.addProvider": strict({
		id: Type.String({ pattern: PROVIDER_ID_PATTERN }),
		name: Type.String({ minLength: 1, maxLength: 100 }),
		baseUrl: Type.String({ minLength: 1, maxLength: 2048 }),
		api: Type.Enum(MODEL_APIS),
		modelIds: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { minItems: 1, maxItems: 50 }),
	}),
	"models.test": ModelRef,
	"conversations.subscribe": strict({ botId: Type.Union([Id, Type.Null()]) }),
	"bots.duplicate": strict({ botId: Id, requestId: Id }),
	"bots.delete": BotOnly,
	"files.resolveReveal": strict({ path: Type.String({ minLength: 1, maxLength: 4096 }) }),
} as const satisfies { readonly [M in HostMethod]: TSchema };

/**
 * Compile-time proof that a validated value is a valid params value of its method. Methods without params are
 * `Record<string, never>`; their schema rejects every property at runtime, which `Static` cannot express.
 */
type Proven = {
	[M in HostMethod]: Static<(typeof HOST_PARAM_SCHEMAS)[M]> extends HostParams<M>
		? true
		: HostParams<M> extends Record<string, never>
			? true
			: M;
};
const proven: { [M in HostMethod]: true } = {} as Proven;
void proven;

const compiled = new Map<HostMethod, Validator>();

/**
 * Check `params` against the method's schema. Returns `undefined` when valid, else a readable message naming the
 * offending field (never the value, which may be a secret).
 */
export function paramsError(method: HostMethod, params: unknown): string | undefined {
	let validator = compiled.get(method);
	if (validator === undefined) {
		validator = Compile(HOST_PARAM_SCHEMAS[method] as TSchema);
		compiled.set(method, validator);
	}
	if (validator.Check(params)) return undefined;
	const problems = validator.Errors(params).flatMap(describe);
	return `Invalid parameters for ${method}: ${problems.length > 0 ? problems.join("; ") : "wrong shape"}`;
}

function describe(error: TLocalizedValidationError): string[] {
	const path = error.instancePath.replace(/^\//, "").replaceAll("/", ".");
	const at = (name?: string) => (name === undefined ? path || "params" : path === "" ? name : `${path}.${name}`);
	switch (error.keyword) {
		// Each unknown property also fails its `false` property schema; the additionalProperties entry names it.
		case "boolean":
			return [];
		case "additionalProperties":
			return names(error.params, "additionalProperties").map((name) => `${at(name)}: unknown property`);
		case "required":
			return names(error.params, "requiredProperties").map((name) => `${at(name)}: required`);
		default:
			return [`${at()}: ${error.message}`];
	}
}

/** Property names TypeBox lists in an error's params under `key`. */
function names(params: object, key: string): string[] {
	const value: unknown = key in params ? Reflect.get(params, key) : undefined;
	return Array.isArray(value) ? value.filter((name): name is string => typeof name === "string") : [];
}
