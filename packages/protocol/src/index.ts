/**
 * Versioned OpenBot data contracts shared by Desktop, the Host Runtime, and executors.
 * This package contains types, parameter schemas, and pure helpers only: no Pi, Electron, or Node dependencies. Its one
 * dependency is TypeBox, for the runtime schemas in `schemas.ts`.
 */

export type MemorySnapshot = {
	readonly content: string;
	readonly revision: number;
	readonly source: "legacy" | "user" | "model" | "restore";
	readonly updatedAt: number | null;
	readonly restoredFrom?: number;
};
export type MemoryState = MemorySnapshot & { readonly history: readonly MemorySnapshot[] };
export const MEMORY_HISTORY_LIMIT = 20;

export const PROTOCOL_VERSION = 1 as const;

/** The execution destination every invocation, grant, and approval is bound to. */
export type ExecutionTarget = { readonly kind: "local"; readonly targetId: string };

/** Accepts only the bound local target; any other kind or identity is a hard error. */
export function assertLocalTarget(target: ExecutionTarget, boundTargetId: string): void {
	if (target.kind !== "local") throw new ProtocolError("target_unsupported", `Unsupported target kind: ${target.kind}`);
	if (target.targetId !== boundTargetId) {
		throw new ProtocolError("target_mismatch", `Target ${target.targetId} is not the bound local target`);
	}
}

export type ProtocolErrorCode =
	| "target_unsupported"
	| "target_mismatch"
	| "request_conflict"
	| "not_found"
	| "invalid_request"
	| "unknown_method"
	| "host_unavailable"
	| "internal";

export class ProtocolError extends Error {
	readonly code: ProtocolErrorCode;

	constructor(code: ProtocolErrorCode, message: string) {
		super(message);
		this.name = "ProtocolError";
		this.code = code;
	}
}

// ---------------------------------------------------------------------------
// Domain data

export type BotId = string;
export type RunId = string;

export type ModelRef = { readonly provider: string; readonly modelId: string };

/** Chat APIs a provider declared in the model configuration file may use. */
export const MODEL_APIS = ["openai-completions", "openai-responses", "anthropic-messages"] as const;
export type ModelApi = (typeof MODEL_APIS)[number];

/** How much a reasoning model thinks before answering; Pi's levels this product offers. */
export type ThinkingLevel = "off" | "low" | "medium" | "high";

export type BotProfile = {
	/** Increments on every profile mutation; legacy profiles start at 1. */
	readonly revision: number;
	readonly kind: "core" | "specialist";
	readonly botId: BotId;
	readonly name: string;
	/** Short job label shown under the name, such as "Research". */
	readonly role: string;
	/** Standing instructions: the Bot's description in Grok Bot terms. */
	readonly instructions: string;
	readonly model?: ModelRef;
	/** Applies only to reasoning models; absent means Pi's default (off). */
	readonly thinkingLevel?: ThinkingLevel;
	readonly pinned: boolean;
	/** `deleted` Bots are hidden everywhere; their conversation stays on disk (Section 8.3). */
	readonly status: "active" | "hidden" | "deleted";
	readonly createdAt: number;
};

/** Immutable authority supplied by the Host adapter, never model arguments. */
export type ManagementAuthority = { readonly origin: "user"; readonly runId: string };
export type BotManagementAction = "create" | "update" | "delete";
export type BotManagementChange = {
	readonly name?: string;
	readonly role?: string;
	readonly instructions?: string;
	readonly model?: ModelRef | null;
	readonly thinkingLevel?: ThinkingLevel;
};
export type BotManagementProposal = {
	readonly invocationId: string;
	readonly approvalId: string;
	readonly actorId: string;
	readonly conversationId: string;
	readonly runId: string;
	readonly origin: "user";
	readonly targetId: string;
	readonly botId: string;
	readonly action: BotManagementAction;
	readonly expectedRevision: number;
	readonly change: BotManagementChange;
	readonly createdAt: number;
	readonly fingerprint: string;
};
export type BotManagementReceipt = BotManagementProposal & {
	readonly result?: BotProfile;
	readonly completedAt?: number;
	readonly outcome?: "denied" | "cancelled" | "failed";
};
export type BotManagementActivity = Omit<BotManagementProposal, "change" | "fingerprint" | "approvalId"> & {
	readonly outcome: "pending" | "succeeded" | "denied" | "cancelled" | "failed";
	readonly resultRevision?: number;
	readonly completedAt?: number;
};

/** Largest Bot memory, in UTF-8 bytes of Markdown. */
export const MEMORY_LIMIT_BYTES = 8192;

/** Sidebar state, in priority order: needs_attention > working > queued > unread > idle. */
export type BotActivity = "needs_attention" | "working" | "queued" | "unread" | "idle";

export type BotSummary = BotProfile & {
	readonly activity: BotActivity;
	/** Tool calls of this Bot waiting for the user's decision. */
	readonly pendingApprovals: number;
	/** The Bot's newest Run since the Host started, including a finished one; drives notifications. */
	readonly lastRun?: Pick<RunRecord, "runId" | "state" | "error">;
};

export type MessagePart = { readonly type: "text"; readonly text: string };

/**
 * `interrupted`: the call may have partly run and its effect is unknown (Section 5.1); the user should check it.
 * `cancelled`: the call was aborted because the user stopped its Run.
 */
export type ToolCallStatus = "pending" | "running" | "succeeded" | "failed" | "interrupted" | "cancelled";

export type TranscriptItem =
	| { readonly kind: "user"; readonly id: string; readonly parts: readonly MessagePart[]; readonly at?: number }
	| {
			readonly kind: "assistant";
			readonly id: string;
			readonly parts: readonly MessagePart[];
			/** The model's visible reasoning, when it returned any. */
			readonly thinking?: string;
			/** Set when the response ended without a normal stop, such as an error or abort. */
			readonly error?: string;
			/** When the response started, in epoch milliseconds. */
			readonly at?: number;
	  }
	| {
			/** One tool call: placed after the assistant text that made it, updated live until its result exists. */
			readonly kind: "tool";
			readonly id: string;
			readonly tool: string;
			readonly args: unknown;
			readonly status: ToolCallStatus;
			/** Bounded text the model received, or the running output while the call is live. */
			readonly output?: string;
			/** Set when a `local_exec` call moved its command to the background. */
			readonly taskId?: string;
	  }
	/** Where earlier messages left the model's context: a compaction summary or a new topic. */
	| { readonly kind: "divider"; readonly id: string; readonly reason: "compaction" | "reset" }
	| { readonly kind: "other"; readonly id: string; readonly entryKind: string }
	/** The user stopped a Run at this point. */
	| { readonly kind: "stopped"; readonly id: string };

export type RunState =
	| "queued"
	| "running"
	| "waiting_approval"
	| "waiting_user"
	| "paused"
	| "cancelling"
	| "needs_attention"
	| "completed"
	| "failed"
	| "cancelled";

/** Live part of a conversation: present while a Run is active. */
export type LiveRun = {
	readonly state: Extract<RunState, "running" | "waiting_approval" | "waiting_user" | "cancelling">;
	/** Text of the response being generated, committed at Pi's progress interval. */
	readonly partial?: readonly MessagePart[];
	readonly retry?: { readonly at: number; readonly error: string };
};

export type ConversationSnapshot = {
	readonly conversationId?: string;
	readonly channelId?: string;
	readonly botId: BotId;
	readonly items: readonly TranscriptItem[];
	readonly live?: LiveRun;
	/** Tool calls of this Bot that wait for the user's decision, oldest first. */
	readonly approvals: readonly PendingApproval[];
	/** The Bot's latest non-terminal Run, if any. */
	readonly run?: RunRecord;
	/**
	 * Messages accepted but not in the transcript yet, oldest first: the messages of a queued Run, and messages sent
	 * while the Bot works, which join its Run after the current tool round.
	 */
	readonly pending?: readonly PendingMessage[];
};

export type PendingMessage = { readonly id: string; readonly parts: readonly MessagePart[] };

/**
 * The work one message starts (Section 7.2). Messages sent while a Run is queued or running join it. A Run counts
 * against the active-Run cap from `running` until it is terminal; waiting for approval counts as running.
 */
export type RunRecord = {
	readonly channelId?: string;
	readonly runId: RunId;
	readonly botId: BotId;
	readonly state: "queued" | "running" | "completed" | "failed" | "cancelled";
	/** OpenBot request IDs of every message in this Run, first one starts it. */
	readonly requestIds: readonly string[];
	readonly createdAt: number;
	readonly startedAt?: number;
	readonly endedAt?: number;
	readonly error?: string;
};

/** A tool call stopped before dispatch until the user decides (Section 5.3). */
export type PendingApproval = {
	readonly conversationId?: string;
	readonly approvalId: string;
	readonly botId: BotId;
	/** The Pi tool call this approval is for; matches the transcript `tool` item's `id`. */
	readonly callId: string;
	readonly tool: string;
	readonly args: unknown;
	readonly target: ExecutionTarget;
	/** Why policy asked, in the user's terms, such as "Runs a command on this Mac". */
	readonly reason: string;
	readonly createdAt: number;
	/**
	 * Scopes the user may choose for **Always allow**, narrowest first. Absent when no single rule or grant would let
	 * this call through (for example a compound command with two unapproved parts, or input that cannot be parsed).
	 */
	readonly alwaysAllowOptions?: readonly AlwaysAllowOption[];
};

/** What **Always allow** creates: a command rule, or a folder grant. */
export type AlwaysAllowScope =
	| { readonly kind: "command"; readonly rule: CommandRuleScope }
	| { readonly kind: "folder"; readonly path: string; readonly access: GrantAccess };

/** One choice on the approval card; `label` is the exact rule or grant the user sees before saving. */
export type AlwaysAllowOption = { readonly label: string; readonly scope: AlwaysAllowScope };

/** `always_allow` answers this call and saves the scope in one step; the scope must be one of the offered options. */
export type ApprovalDecision = "allow_once" | "deny" | { readonly kind: "always_allow"; readonly scope: AlwaysAllowScope };

/** How commands are authorized when no rule or the read-only default applies (Section 5.3). */
export type CommandSetting = "ask" | "allow" | "never";

/**
 * What a command rule matches, per part of a command line. With `exact`, the part's words rendered canonically must
 * equal it; otherwise the program (and `subcommand`, when given, as the second word) with any further arguments.
 */
export type CommandRuleScope = { readonly program: string; readonly subcommand?: string; readonly exact?: string };

export type CommandRule = CommandRuleScope & { readonly id: string; readonly createdAt: number };

export type PolicySettings = {
	readonly commandSetting: CommandSetting;
	/** Read-only commands (`rg`, `ls`, `git status`, …) inside granted folders run without asking. */
	readonly readOnlyDefault: boolean;
	readonly rules: readonly CommandRule[];
};

export type GrantAccess = "read" | "readwrite";

/** A folder Bots may use with file tools without asking. The workspace is an implicit `readwrite` grant. */
export type FolderGrant = {
	readonly id: string;
	/** Canonical and absolute. */
	readonly path: string;
	readonly access: GrantAccess;
	/** Revision of the grants document that created it; increases with every grant change. */
	readonly version: number;
	readonly createdAt: number;
};

/**
 * Lifecycle of an approval in the Host's store (Section 5.3): `pending` until the user decides, `allowed` or `denied`
 * until the call's result is committed (`consumed`), or `withdrawn` when its Run was cancelled first.
 */
export type ApprovalState = "pending" | "allowed" | "denied" | "withdrawn" | "consumed";

export type ApprovalRecord = PendingApproval & {
	readonly state: ApprovalState;
	/** The user's answer; kept when the record becomes `consumed`, so a rerun gets the same answer. */
	readonly decision?: ApprovalDecision;
	readonly decidedAt?: number;
};

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

export type ModelSummary = {
	readonly source?: "builtin" | "custom";
	readonly overridden?: boolean;
	/** Origin only: never credentials, URL paths, query strings or headers. */
	readonly endpoint?: string;
	readonly provider: string;
	readonly modelId: string;
	readonly name: string;
	readonly reasoning: boolean;
	readonly images: boolean;
};

// ---------------------------------------------------------------------------
// Desktop-to-Host methods (Section 6.1). Each entry maps a method name to its params and result.

export type HostMethods = {
	"host.status": { params: Record<string, never>; result: HostStatus };
	"bots.management.history": { params: Record<string, never>; result: readonly BotManagementActivity[] };
	"bots.list": { params: Record<string, never>; result: readonly BotSummary[] };
	"bots.create": {
		params: {
			readonly requestId: string;
			readonly name: string;
			readonly role?: string;
			readonly instructions?: string;
			readonly model?: ModelRef;
		};
		result: BotProfile;
	};
	"bots.update": {
		params: {
			readonly botId: BotId;
			readonly expectedRevision?: number;
			readonly name?: string;
			readonly role?: string;
			readonly instructions?: string;
			readonly model?: ModelRef | null;
			readonly thinkingLevel?: ThinkingLevel;
			readonly pinned?: boolean;
			/** `deleted` is reached only through `bots.delete`. */
			readonly status?: Exclude<BotProfile["status"], "deleted">;
		};
		result: BotProfile;
	};
	"conversations.snapshot": { params: { readonly botId: BotId }; result: ConversationSnapshot };
	"conversations.markRead": { params: { readonly botId: BotId }; result: null };
	"messages.submit": {
		params: { readonly botId: BotId; readonly requestId: string; readonly text: string };
		/** `steered`: the message joined the Bot's running or queued Run instead of starting one. */
		result: { readonly runId: RunId; readonly state: RunRecord["state"]; readonly steered: boolean };
	};
	"runs.cancel": { params: { readonly runId: RunId }; result: { readonly state: RunRecord["state"] } };
	"approvals.decide": { params: { readonly approvalId: string; readonly decision: ApprovalDecision }; result: null };
	"settings.get": { params: Record<string, never>; result: RedactedSettings };
	"settings.update": {
		params: { readonly defaultModel?: ModelRef | null; readonly setupComplete?: boolean; readonly language?: "en" | "zh-CN" };
		result: RedactedSettings;
	};
	"models.list": { params: Record<string, never>; result: readonly ModelSummary[] };
	"credentials.set": {
		params: { readonly providerId: string; readonly apiKey: string };
		result: RedactedSettings;
	};
	"credentials.delete": { params: { readonly providerId: string }; result: RedactedSettings };
	"bots.memory.get": { params: { readonly botId: BotId }; result: MemoryState };
	"bots.memory.update": {
		params: { readonly botId: BotId; readonly content: string; readonly expectedRevision: number };
		result: MemoryState;
	};
	"bots.memory.restore": {
		params: { readonly botId: BotId; readonly revision: number; readonly expectedRevision: number };
		result: MemoryState;
	};
	/** New topic: the Bot's next request starts from an empty context; memory and stored history stay. */
	"conversations.reset": { params: { readonly botId: BotId }; result: null };
	"policy.get": { params: Record<string, never>; result: PolicySettings };
	"policy.update": {
		params: { readonly commandSetting?: CommandSetting; readonly readOnlyDefault?: boolean };
		result: PolicySettings;
	};
	"policy.rules.delete": { params: { readonly id: string }; result: PolicySettings };
	"grants.list": { params: Record<string, never>; result: readonly FolderGrant[] };
	"grants.revoke": { params: { readonly id: string }; result: readonly FolderGrant[] };
	/**
	 * Desktop main sends the folder the user picked in the native dialog; the renderer calls this method with an
	 * opaque `selection` token instead (see `apps/desktop/src/shared/api.ts`) and never supplies a path.
	 */
	"grants.add": { params: { readonly path: string; readonly access: GrantAccess }; result: readonly FolderGrant[] };
	/**
	 * Declare an OpenAI- or Anthropic-compatible provider in the model configuration file, merged with the entries
	 * already there; an entry with the same ID is replaced. Never carries a key: store it with `credentials.set` under
	 * the same ID.
	 */
	"models.addProvider": {
		params: {
			readonly id: string;
			readonly name: string;
			readonly baseUrl: string;
			readonly api: ModelApi;
			readonly modelIds: readonly string[];
		};
		result: RedactedSettings;
	};
	/** Send one tiny real request to the model. A failing endpoint or key is reported in the result, not thrown. */
	"models.test": { params: ModelRef; result: { readonly ok: boolean; readonly error?: string } };
	/**
	 * Choose the one Bot whose `conversation.updated` events Desktop receives; `null` receives none. Replaces the
	 * previous choice. `bots.changed` is always sent.
	 */
	"conversations.subscribe": { params: { readonly botId: BotId | null }; result: null };
	/** A new Bot with the same profile and memory, without history. Idempotent per `requestId`. */
	"bots.duplicate": { params: { readonly botId: BotId; readonly requestId: string }; result: BotProfile };
	/** Cancel the Bot's Run, then mark it `deleted`. Its conversation stays on disk. */
	"bots.delete": { params: { readonly botId: BotId }; result: null };
	/**
	 * The canonical absolute path of an existing file or folder inside the workspace, else `null`. A relative path is
	 * resolved against the workspace. Desktop main asks before it reveals a path in Finder.
	 */
	"files.resolveReveal": { params: { readonly path: string }; result: string | null };
};

export type HostMethod = keyof HostMethods;
export type HostParams<M extends HostMethod> = HostMethods[M]["params"];
export type HostResult<M extends HostMethod> = HostMethods[M]["result"];

export const HOST_METHODS = [
	"host.status",
	"bots.list",
	"bots.management.history",
	"bots.create",
	"bots.update",
	"conversations.snapshot",
	"conversations.markRead",
	"messages.submit",
	"runs.cancel",
	"approvals.decide",
	"settings.get",
	"settings.update",
	"models.list",
	"credentials.set",
	"credentials.delete",
	"bots.memory.get",
	"bots.memory.update",
	"bots.memory.restore",
	"conversations.reset",
	"policy.get",
	"policy.update",
	"policy.rules.delete",
	"grants.list",
	"grants.revoke",
	"grants.add",
	"models.addProvider",
	"models.test",
	"conversations.subscribe",
	"bots.duplicate",
	"bots.delete",
	"files.resolveReveal",
] as const satisfies readonly HostMethod[];

export function isHostMethod(value: unknown): value is HostMethod {
	return typeof value === "string" && (HOST_METHODS as readonly string[]).includes(value);
}

export type HostStatus = {
	readonly protocolVersion: typeof PROTOCOL_VERSION;
	readonly hostVersion: string;
	readonly nodeVersion: string;
	readonly targetId: string;
	readonly startedAt: number;
};

// ---------------------------------------------------------------------------
// Host-to-Desktop events

export type HostEvents = {
	/** The roster or a Bot's sidebar state changed; fetch `bots.list` again. */
	"bots.changed": Record<string, never>;
	/** A conversation's view changed; the payload is the new snapshot. */
	"conversation.updated": ConversationSnapshot;
};

export type HostEventType = keyof HostEvents;

/** One event as a discriminated union, so consumers narrow on `type`. */
export type HostEvent = { [T in HostEventType]: { readonly type: T; readonly payload: HostEvents[T] } }[HostEventType];

// ---------------------------------------------------------------------------
// Envelopes

export type RequestEnvelope<M extends HostMethod = HostMethod> = {
	readonly protocolVersion: typeof PROTOCOL_VERSION;
	readonly kind: "request";
	readonly messageId: string;
	readonly method: M;
	readonly params: HostParams<M>;
};

export type ResponseEnvelope<M extends HostMethod = HostMethod> =
	| {
			readonly protocolVersion: typeof PROTOCOL_VERSION;
			readonly kind: "response";
			readonly messageId: string;
			readonly ok: true;
			readonly result: HostResult<M>;
	  }
	| {
			readonly protocolVersion: typeof PROTOCOL_VERSION;
			readonly kind: "response";
			readonly messageId: string;
			readonly ok: false;
			readonly error: { readonly code: ProtocolErrorCode; readonly message: string };
	  };

/** Ordered event; a gap in `seq` or a new `streamId` requires fresh snapshots. */
export type EventEnvelope = HostEvent & {
	readonly protocolVersion: typeof PROTOCOL_VERSION;
	readonly kind: "event";
	readonly streamId: string;
	readonly seq: number;
};

/** Sent once by the Host after it opened storage and is ready for requests. */
export type ReadyEnvelope = {
	readonly protocolVersion: typeof PROTOCOL_VERSION;
	readonly kind: "ready";
	readonly status: HostStatus;
};

export type HostToDesktop = ResponseEnvelope | EventEnvelope | ReadyEnvelope;

/**
 * Shape check for an incoming request envelope. The method is only checked to be a string and `params` only to be
 * present, so a request for an unknown method or with malformed params still gets a response (`unknown_method`, or
 * `invalid_request` from the method's schema in `schemas.ts`) instead of being dropped.
 */
export function isRequestEnvelope(
	value: unknown,
): value is Omit<RequestEnvelope, "method" | "params"> & { readonly method: string; readonly params: unknown } {
	if (typeof value !== "object" || value === null) return false;
	return (
		"protocolVersion" in value &&
		value.protocolVersion === PROTOCOL_VERSION &&
		"kind" in value &&
		value.kind === "request" &&
		"messageId" in value &&
		typeof value.messageId === "string" &&
		"method" in value &&
		typeof value.method === "string" &&
		"params" in value
	);
}

// ---------------------------------------------------------------------------
// Executor protocol (Section 6.2)

/** Executor-protocol invocation, identical for the local executor and any future target. */
export type ToolInvocation = {
	readonly invocationId: string;
	readonly botId: BotId;
	readonly conversationId: string;
	readonly tool: ExecutorToolName;
	readonly args: Readonly<Record<string, unknown>>;
	readonly argsDigest: string;
	readonly target: ExecutionTarget;
	/** Directories file tools may read and write, canonical and absolute. */
	readonly grants: readonly string[];
	/** Directories file tools may only read, canonical and absolute. */
	readonly readGrants: readonly string[];
	readonly deadline: number;
};

export type InvocationStatus = "succeeded" | "failed" | "cancelled" | "unknown";

export type ToolOutcome = {
	readonly status: InvocationStatus;
	/** Bounded text for the model. */
	readonly output: string;
	/** Command exit details, separate from whether the invocation itself succeeded. */
	readonly exit?: { readonly code: number | null; readonly signal: string | null };
	readonly truncated?: boolean;
	/** Set when `local_exec` moved the command to the background; `task_output` and `task_stop` take it. */
	readonly taskId?: string;
};

/** Host to executor. */
export type ExecutorRequest =
	| { readonly kind: "tool.invoke"; readonly invocation: ToolInvocation }
	| { readonly kind: "tool.cancel"; readonly invocationId: string }
	/** Read-only receipt lookup; the executor answers with `tool.status`. */
	| { readonly kind: "tool.status"; readonly invocationId: string }
	/** The Host committed the outcome; the receipt may be pruned after the retention period. */
	| { readonly kind: "result.ack"; readonly invocationId: string }
	/** The conversation's work was stopped: stop its background tasks too. */
	| { readonly kind: "tasks.stop"; readonly conversationId: string };

/** Executor to Host. */
export type ExecutorMessage =
	| {
			readonly kind: "executor.hello";
			readonly protocolVersion: typeof PROTOCOL_VERSION;
			readonly targetId: string;
			/** New for every executor process, so the Host can tell a restarted executor apart. */
			readonly instanceId: string;
			readonly tools: readonly ExecutorToolName[];
	  }
	| { readonly kind: "tool.progress"; readonly invocationId: string; readonly output: string }
	| { readonly kind: "tool.result"; readonly invocationId: string; readonly outcome: ToolOutcome }
	| {
			readonly kind: "tool.status";
			readonly invocationId: string;
			readonly status: InvocationStatus | "accepted" | "absent";
			readonly outcome?: ToolOutcome;
	  };

// ---------------------------------------------------------------------------
// Tool catalog: what the model is offered. Schemas are plain JSON Schema, which Pi validates tool arguments against.

export type ToolCapability = "files.read" | "files.write" | "commands" | "tasks" | "web" | "memory" | "bot.management";

export type ToolDefinition = {
	readonly name: string;
	readonly description: string;
	readonly parameters: Readonly<Record<string, unknown>>;
	readonly capability: ToolCapability;
	readonly destination: "executor" | "host";
};

const string = (description: string) => ({ type: "string", description });
const integer = (description: string) => ({ type: "integer", minimum: 1, description });
const object = (properties: Record<string, unknown>, required: readonly string[]) => ({
	type: "object",
	properties,
	required,
	additionalProperties: false,
});

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });
const botFields = {
	name: nullable({ type: "string", minLength: 1, maxLength: 100 }),
	role: nullable({ type: "string", maxLength: 500 }),
	instructions: nullable({ type: "string", maxLength: 32000 }),
	model: nullable(
		object({ provider: string("Configured provider ID."), modelId: string("Configured model ID.") }, ["provider", "modelId"]),
	),
	thinkingLevel: nullable({ type: "string", enum: ["off", "low", "medium", "high"] }),
};
export const TOOL_CATALOG = [
	{
		name: "bot_inspect",
		capability: "bot.management",
		destination: "host",
		description:
			"Core only. Inspect the user's Bots and current revisions. Listing omits instructions; select a Bot ID to read its full profile. Omit botId or pass null to list live Bots. Inspect before updating or deleting a Specialist.",
		parameters: object({ botId: nullable(string("Bot ID to inspect, or null to list.")) }, []),
	},
	{
		name: "bot_create",
		capability: "bot.management",
		destination: "host",
		description:
			"Core only. Create one Specialist when the user explicitly requests it. Waits for user approval. Never create Bots proactively. Name is required; null or omitted fields use defaults: empty role/instructions, default model/thinking. Starts with empty memory. Do not retry a denied request.",
		parameters: object({ ...botFields, name: { type: "string", minLength: 1, maxLength: 100 } }, ["name"]),
	},
	{
		name: "bot_update",
		capability: "bot.management",
		destination: "host",
		description:
			"Core only. Update a Specialist at the user's request, with approval. Inspect first and supply the current revision. Null or omitted fields are UNCHANGED; empty role/instructions clears that text. model selects an override; useDefaultModel=true removes the override. Cannot edit Core, memory, identity or permissions. Do not retry a denied request.",
		parameters: object(
			{
				...botFields,
				botId: string("Specialist ID from bot_inspect."),
				expectedRevision: integer("Current revision from bot_inspect."),
				useDefaultModel: nullable({ type: "boolean", description: "True removes the model override; false/null leaves it unchanged." }),
			},
			["botId", "expectedRevision"],
		),
	},
	{
		name: "bot_delete",
		capability: "bot.management",
		destination: "host",
		description:
			"Core only. Delete a Specialist at the user's request, with approval. Inspect first. Stops its work and background commands, removes it from the roster and retains local history. Cannot delete Core. Do not retry a denied request.",
		parameters: object(
			{ botId: string("Specialist ID from bot_inspect."), expectedRevision: integer("Current revision from bot_inspect.") },
			["botId", "expectedRevision"],
		),
	},
	{
		name: "local_read",
		capability: "files.read",
		destination: "executor",
		description:
			"Read a text file on this Mac. Returns numbered lines. Use offset and limit for large files; the result says where to continue when it is cut.",
		parameters: object(
			{
				path: string("Absolute path, or relative to the workspace."),
				offset: integer("First line to return, 1-based."),
				limit: integer("Maximum number of lines to return."),
			},
			["path"],
		),
	},
	{
		name: "local_list",
		capability: "files.read",
		destination: "executor",
		description: "List the entries of a directory on this Mac. Directories end with '/'.",
		parameters: object({ path: string("Absolute path, or relative to the workspace.") }, ["path"]),
	},
	{
		name: "local_write",
		capability: "files.write",
		destination: "executor",
		description: "Create or overwrite a text file on this Mac. Missing parent directories are created.",
		parameters: object({ path: string("Absolute path, or relative to the workspace."), content: string("The complete file content.") }, [
			"path",
			"content",
		]),
	},
	{
		name: "local_edit",
		capability: "files.write",
		destination: "executor",
		description:
			"Replace exact text in a file on this Mac. old_text must appear exactly once unless replace_all is true; read the file first and copy the text exactly, without line numbers.",
		parameters: object(
			{
				path: string("Absolute path, or relative to the workspace."),
				old_text: string("Exact text to replace."),
				new_text: string("Replacement text."),
				replace_all: { type: "boolean", description: "Replace every occurrence instead of exactly one." },
				expected_sha256: string(
					"SHA-256 of the file as you last saw it, from local_read or your last edit. The edit is refused if the file changed since.",
				),
			},
			["path", "old_text", "new_text"],
		),
	},
	{
		name: "local_exec",
		capability: "commands",
		destination: "executor",
		description:
			"Run a shell command on this Mac with /bin/zsh. The user approves each command. Each call starts fresh in the working directory; cd and variables do not persist. Prefer the file tools for reading and editing files. A command still running after 60 seconds moves to the background and the call returns a taskId; long output is cut and saved to a file the result names.",
		parameters: object(
			{
				command: string("The command line to run."),
				description: string("What the command does, in five to ten words; shown to the user."),
				cwd: string("Working directory. Defaults to the workspace."),
				timeout_seconds: {
					type: "integer",
					minimum: 1,
					maximum: 86_400,
					description: "Stop the command after this many seconds, also in the background. Default: no limit.",
				},
				background: { type: "boolean", description: "Start in the background right away and return a taskId." },
			},
			["command", "description"],
		),
	},
	{
		name: "task_output",
		capability: "tasks",
		destination: "executor",
		description:
			"Read a background command's new output since the last read, its status, and its exit code once it ended. wait_seconds waits up to that long for it to end first.",
		parameters: object(
			{
				taskId: string("The taskId local_exec returned."),
				wait_seconds: { type: "integer", minimum: 0, maximum: 60, description: "Wait up to this long for the task to end. Default 0." },
			},
			["taskId"],
		),
	},
	{
		name: "task_stop",
		capability: "tasks",
		destination: "executor",
		description: "Stop a background command and everything it started. Returns its last output.",
		parameters: object({ taskId: string("The taskId local_exec returned.") }, ["taskId"]),
	},
	{
		name: "web_fetch",
		capability: "web",
		destination: "host",
		description:
			"Fetch a public web page and return its main content as Markdown with links. Does not run JavaScript. The first lines give the final URL and a retrieval_outcome; only usable_content means the page was actually read. Long pages are cut; the result names the offset to continue. Private and local network addresses are refused.",
		parameters: object(
			{
				url: string("An http or https URL."),
				offset: { type: "integer", minimum: 0, description: "Character offset into the page's Markdown to continue from." },
			},
			["url"],
		),
	},
	{
		name: "web_search",
		capability: "web",
		destination: "host",
		description:
			"Search the web. Returns numbered results with title, URL, snippet, and published date when known. Snippets are leads, not sources: open pages with web_fetch before relying on them.",
		parameters: object(
			{
				query: string("The search query."),
				count: { type: "integer", minimum: 1, maximum: 10, description: "Number of results. Default 5." },
			},
			["query"],
		),
	},
	{
		name: "memory_update",
		capability: "memory",
		destination: "host",
		description:
			"Save something worth remembering across conversations to your memory: the user's lasting preferences, facts about them and their work, and notes on your role. Memory is Markdown split into ## sections and is limited to 8 KB.",
		parameters: object(
			{
				action: {
					type: "string",
					enum: ["replace", "append"],
					description: "append adds a line to the section; replace sets the whole section, and empty content removes it.",
				},
				section: string("Section heading without the ## prefix, such as Preferences."),
				content: string("Markdown to add, or the complete new section text."),
				expectedRevision: {
					type: "integer",
					minimum: 0,
					description: "Current revision from your latest memory system section. On conflict, review that refreshed section before retrying.",
				},
			},
			["action", "section", "content", "expectedRevision"],
		),
	},
] as const satisfies readonly ToolDefinition[];

export type ToolName = (typeof TOOL_CATALOG)[number]["name"];
export type ExecutorToolName = Extract<(typeof TOOL_CATALOG)[number], { destination: "executor" }>["name"];

export function toolDefinition(name: string): ToolDefinition | undefined {
	return TOOL_CATALOG.find((tool) => tool.name === name);
}
