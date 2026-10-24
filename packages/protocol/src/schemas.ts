import { ROUTINE_SCHEMAS } from "./routine-schemas.ts";
/**
 * Runtime schemas for the params of every Host method. Desktop main checks a renderer call before forwarding it, and
 * the Host checks every request before dispatch, so a handler only ever sees params of its declared shape. Handlers
 * still enforce rules that need state or meaning (an empty message, an unknown Bot, a URL scheme).
 */
import { type Static, type TSchema, Type } from "typebox";
import { Compile, type Validator } from "typebox/compile";
import type { TLocalizedValidationError } from "typebox/error";
import { APP_SEARCH_INPUT } from "./app-capabilities.ts";
import { type HostMethod, type HostParams, MODEL_APIS } from "./index.ts";

const Id = Type.String({ minLength: 1, maxLength: 256 });
const NoParams = Type.Object({}, { additionalProperties: false });
const strict = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const ModelRef = strict({ provider: Id, modelId: Id });
const ThinkingLevel = Type.Enum(["off", "low", "medium", "high"]);
const AvatarBase64 = Type.String({ minLength: 1, maxLength: 409600, pattern: "^[A-Za-z0-9+/]+={0,2}$" });
const AvatarChange = Type.Union([
 strict({ kind: Type.Literal("generated"), version: Type.Literal(1), seed: Type.Integer({ minimum: 0, maximum: 4294967295 }), motif: Type.Enum(["leaf", "glasses", "cap"]) }),
 strict({ kind: Type.Literal("upload"), base64: AvatarBase64 }),
]);
const BotOnly = strict({ botId: Id });
const MemoryScope = Type.Enum(["bot", "shared"]);
const MemoryNoteBase = { botId: Id, requestId: Id, scope: MemoryScope, expectedRevision: Type.Integer({ minimum: 0 }) };
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

const GroupId = Type.String({ pattern: "^group_[a-zA-Z0-9_-]{1,128}$" });
const GroupFields = strict({
	name: Type.String({ minLength: 1, maxLength: 100 }),
	objective: Type.String({ maxLength: 4000 }),
	memberIds: Type.Array(Id, { minItems: 2, maxItems: 6, uniqueItems: true }),
	leadBotId: Id,
});
const ArtifactId = Type.String({ pattern: "^artifact_[a-f0-9]{32}$" });
const ReaderPath = Type.String({ maxLength: 4096 });
const ArtifactList = strict({offset:Type.Integer({minimum:0,maximum:4096}),query:Type.String({maxLength:200})});
const ArtifactPath = Type.String({ minLength: 1, maxLength: 4096 });
const SkillName=Type.String({pattern:"^[a-z0-9]+(?:-[a-z0-9]+)*$",maxLength:64});
const SkillDocument=strict({name:SkillName,description:Type.String({minLength:1,maxLength:300}),inputs:Type.String({minLength:1,maxLength:32768}),requirements:Type.String({minLength:1,maxLength:32768}),steps:Type.String({minLength:1,maxLength:32768}),validation:Type.String({minLength:1,maxLength:32768}),output:Type.String({minLength:1,maxLength:32768}),approvalBoundaries:Type.String({minLength:1,maxLength:32768})});
const ConnectorId=Type.String({pattern:"^[a-z][a-z0-9-]{0,31}$"});
const ConnectorRevision=Type.Integer({minimum:1,maximum:Number.MAX_SAFE_INTEGER});
const ConnectorChange=strict({requestId:Id,connectorId:ConnectorId,expectedRevision:ConnectorRevision});
export const HOST_PARAM_SCHEMAS = {
 ...ROUTINE_SCHEMAS,
 "connectors.list":NoParams,
 "connectors.install":Type.Union([
 strict({requestId:Id,connectorId:ConnectorId,name:Type.String({minLength:1,maxLength:80}),transport:Type.Optional(Type.Literal("stdio")),command:Type.String({minLength:1,maxLength:4096,pattern:"^/"}),args:Type.Array(Type.String({maxLength:2048}),{maxItems:32}),credentialEnv:Type.Optional(Type.String({pattern:"^[A-Z][A-Z0-9_]{0,63}$"}))}),
 strict({requestId:Id,connectorId:ConnectorId,name:Type.String({minLength:1,maxLength:80}),transport:Type.Literal("https"),endpoint:Type.String({minLength:9,maxLength:2048,pattern:"^https://"}),auth:Type.Union([Type.Literal("none"),Type.Literal("bearer")])})]),
 "connectors.connect":ConnectorChange,
 "connectors.disconnect":ConnectorChange,
 "connectors.remove":ConnectorChange,
 "connectors.credential.set":strict({connectorId:ConnectorId,expectedRevision:ConnectorRevision,value:Type.String({minLength:8,maxLength:8192})}),
 "connectors.credential.delete":strict({connectorId:ConnectorId,expectedRevision:ConnectorRevision}),
 "skills.list":NoParams,
 "skills.get":strict({name:SkillName,revision:Type.Optional(Type.Integer({minimum:1}))}),
 "skills.save":strict({requestId:Id,name:SkillName,expectedRevision:Type.Integer({minimum:0}),document:SkillDocument}),
 "skills.delete":strict({requestId:Id,name:SkillName,expectedRevision:Type.Integer({minimum:0})}),
	"observation.wait": strict({
		cursor: Type.Optional(strict({
			streamId: Type.String({ minLength: 1, maxLength: 128 }),
			seq: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
		})),
		waitMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 5000 })),
	}),
	"artifacts.import": strict({ requestId: Id, path: ArtifactPath }),
	"artifacts.export": strict({ requestId: Id, artifactId: ArtifactId, path: ArtifactPath }),
	"artifacts.get": strict({ artifactId: ArtifactId }),
	"files.list": strict({path:ReaderPath}),
	"files.read": strict({path:ArtifactPath}),
	"files.open": strict({path:ArtifactPath}),
	"artifacts.list": ArtifactList,
	"artifacts.read": strict({artifactId:ArtifactId}),
	"artifacts.preview": strict({ artifactId: ArtifactId }),
	"artifacts.remove": strict({ requestId: Id, artifactId: ArtifactId }),
	"collaboration.stop": strict({ rootId: Type.String({ minLength: 1, maxLength: 2048 }) }),
	"groups.list": NoParams,
	"groups.snapshot": strict({ groupId: GroupId }),
	"groups.change": strict({
		requestId: Id,
		action: Type.Enum(["create", "update", "dissolve"]),
		groupId: GroupId,
		expectedRevision: Type.Integer({ minimum: 0 }),
		fields: Type.Optional(GroupFields),
	}),
	"groups.send": strict({
		groupId: GroupId,
		requestId: Id,
		text: Type.String({ minLength: 1, maxLength: 32000 }),
		recipientIds: Type.Optional(Type.Array(Id, { minItems: 1, maxItems: 6, uniqueItems: true })),
	}),

	"host.status": NoParams,
 "lifecycle.get":NoParams,"lifecycle.pause":NoParams,"lifecycle.resume":NoParams,
 "lifecycle.native":strict({sourceId:Id,seq:Type.Integer({minimum:0,maximum:Number.MAX_SAFE_INTEGER}),locked:Type.Boolean(),suspended:Type.Boolean(),quitting:Type.Boolean()}),
 "runs.continue":strict({runId:Id,requestId:Id}),
	"bots.list": NoParams,
	"avatars.source": strict({ path: ArtifactPath }),
	"bots.avatar.get": BotOnly,
	"bots.management.history": NoParams,
	"bots.create": strict({
		requestId: Id,
		name: Type.String({ minLength: 1, maxLength: 200 }),
		role: Type.Optional(Type.String({ maxLength: 200 })),
		instructions: Type.Optional(Type.String()),
		model: Type.Optional(ModelRef),
	}),
	"bots.update": strict({
		avatar: Type.Optional(AvatarChange),
		defaultSkills: Type.Optional(Type.Array(strict({name:SkillName,revision:Type.Integer({minimum:1}),sha256:Type.String({pattern:"^[a-f0-9]{64}$"})}),{maxItems:2})),
		botId: Id,
		expectedRevision: Type.Optional(Type.Integer({ minimum: 1 })),
		name: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
		role: Type.Optional(Type.String({ maxLength: 200 })),
		instructions: Type.Optional(Type.String()),
		model: Type.Optional(Type.Union([ModelRef, Type.Null()])),
		thinkingLevel: Type.Optional(ThinkingLevel),
		pinned: Type.Optional(Type.Boolean()),
		status: Type.Optional(Type.Enum(["active", "hidden"])),
	}),
	"conversations.snapshot": BotOnly,
	"conversations.list": NoParams,
	"conversations.search": APP_SEARCH_INPUT,
	"conversations.markRead": strict({
		conversationKey: Type.TemplateLiteral([Type.Union([Type.Literal("bot:"), Type.Literal("group:")]), Type.String()], {
			pattern: "^(bot|group):.+$",
			maxLength: 262,
		}),
		through: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
	}),
	"messages.submit": strict({
 skills:Type.Optional(Type.Array(strict({name:SkillName,revision:Type.Integer({minimum:1}),sha256:Type.String({pattern:"^[a-f0-9]{64}$"})}),{maxItems:2})),
		botId: Id,
		requestId: Id,
		text: Type.String(),
		artifactIds: Type.Optional(Type.Array(ArtifactId, { maxItems: 4, uniqueItems: true })),
	}),
	"background.stop": strict({invocationId:Type.String({minLength:1,maxLength:2048})}),
	"runs.cancel": strict({ runId: Id }),
	"approvals.decide": strict({
		approvalId: Id,
		decision: Type.Union([Type.Enum(["allow_once", "deny"]), strict({ kind: Type.Literal("always_allow"), scope: AlwaysAllowScope })]),
	}),
	"usage.get": strict({ botId: Id, limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })) }),
	"settings.get": NoParams,
	"settings.update": strict({
		language: Type.Optional(Type.Union([Type.Literal("en"), Type.Literal("zh-CN")])),
		setupComplete: Type.Optional(Type.Boolean()),
		defaultModel: Type.Optional(Type.Union([ModelRef, Type.Null()])),
	}),
	"models.list": NoParams,
	"credentials.status": NoParams,
	"credentials.migrate": NoParams,
	"credentials.set": strict({ providerId: Id, apiKey: Type.String({ maxLength: 16_384 }) }),
	"credentials.delete": strict({ providerId: Id }),
	"bots.memory.get": BotOnly,
	"memory.shared.get": NoParams,
	"memory.shared.update": strict({ content: Type.String(), expectedRevision: Type.Integer({ minimum: 0 }) }),
	"memory.shared.restore": strict({ revision: Type.Integer({ minimum: 0 }), expectedRevision: Type.Integer({ minimum: 0 }) }),
	"bots.memory.note": Type.Union([
		strict({ ...MemoryNoteBase, action: Type.Literal("add"), heading: Type.String({ minLength: 1, maxLength: 120 }), content: Type.String({ minLength: 1, maxLength: 8192 }) }),
		strict({ ...MemoryNoteBase, action: Type.Literal("edit"), noteId: Id, content: Type.String({ minLength: 1, maxLength: 8192 }) }),
		strict({ ...MemoryNoteBase, action: Type.Literal("forget"), noteId: Id }),
		strict({ ...MemoryNoteBase, action: Type.Enum(["share", "unshare"]), noteId: Id, otherRevision: Type.Integer({ minimum: 0 }) }),
	]),
	"bots.memory.source": strict({ botId: Id, scope: MemoryScope, noteId: Id, which: Type.Enum(["original", "changed"]) }),
	"bots.memory.update": strict({ botId: Id, content: Type.String(), expectedRevision: Type.Integer({ minimum: 0 }) }),
	"bots.memory.restore": strict({ botId: Id, revision: Type.Integer({ minimum: 0 }), expectedRevision: Type.Integer({ minimum: 0 }) }),
	"conversations.reset": BotOnly,
	"policy.get": NoParams,
	"policy.update": strict({
		commandSetting: Type.Optional(Type.Enum(["ask", "allow", "never"])),
		readOnlyDefault: Type.Optional(Type.Boolean()),
	}),
 "policy.ask.create": strict({ requestId: Id, expectedRevision: Type.Integer({minimum:0,maximum:Number.MAX_SAFE_INTEGER}), botId: Type.Optional(Id), predicate: Type.Union([
 strict({tool:Type.Literal("local_exec"),program:Type.String({minLength:1,maxLength:4096}),subcommand:Type.Optional(Type.String({minLength:1,maxLength:256})),exact:Type.Optional(Type.String({minLength:1,maxLength:16384})),cwd:Type.Optional(Type.String({minLength:1,maxLength:4096}))}),
 strict({tool:Type.Enum(["artifact_publish","local_read","local_list","local_write","local_edit"]),path:Type.String({minLength:1,maxLength:4096})})
 ])}),
 "policy.ask.delete": strict({requestId:Id, expectedRevision:Type.Integer({minimum:0,maximum:Number.MAX_SAFE_INTEGER}),id:Id}),
 "policy.reconcile": NoParams,
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

const artifactRequest = Compile(
	strict({
		kind: Type.Literal("artifact.request"),
		messageId: Id,
		requestId: Id,
		targetId: Id,
		operation: Type.Union([
            strict({action:Type.Enum(["files-list","files-read","file-open"]),path:ReaderPath}),
            strict({action:Type.Literal("list"),offset:Type.Integer({minimum:0,maximum:4096}),query:Type.String({maxLength:200})}),
			strict({ action: Type.Literal("avatar-source"), path: ArtifactPath }),
			strict({ action: Type.Literal("avatar-validate"), base64: AvatarBase64 }),
			strict({ action: Type.Literal("import"), path: ArtifactPath }),
			strict({ action: Type.Enum(["get", "preview", "read", "content", "remove"]), artifactId: ArtifactId }),
			strict({ action: Type.Literal("export"), artifactId: ArtifactId, path: ArtifactPath }),
		]),
	}),
);
export const validArtifactRequest = (value: unknown): boolean => artifactRequest.Check(value);
