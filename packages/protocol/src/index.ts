/**
 * Versioned OpenBot data contracts shared by Desktop, the Host Runtime, and executors.
 * This package contains types and pure helpers only: no Pi, Electron, or Node dependencies.
 */

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

export type BotProfile = {
	readonly botId: BotId;
	readonly name: string;
	/** Short job label shown under the name, such as "Research". */
	readonly role: string;
	/** Standing instructions: the Bot's description in Grok Bot terms. */
	readonly instructions: string;
	readonly model?: ModelRef;
	readonly pinned: boolean;
	readonly status: "active" | "hidden";
	readonly createdAt: number;
};

/** Sidebar state, in priority order: needs_attention > working > unread > idle. */
export type BotActivity = "needs_attention" | "working" | "unread" | "idle";

export type BotSummary = BotProfile & { readonly activity: BotActivity };

export type MessagePart = { readonly type: "text"; readonly text: string };

export type ToolCallStatus = "pending" | "running" | "succeeded" | "failed";

export type TranscriptItem =
	| { readonly kind: "user"; readonly id: string; readonly parts: readonly MessagePart[] }
	| {
			readonly kind: "assistant";
			readonly id: string;
			readonly parts: readonly MessagePart[];
			/** Set when the response ended without a normal stop, such as an error or abort. */
			readonly error?: string;
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
	  }
	| { readonly kind: "other"; readonly id: string; readonly entryKind: string };

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
	readonly botId: BotId;
	readonly items: readonly TranscriptItem[];
	readonly live?: LiveRun;
	/** Tool calls of this Bot that wait for the user's decision, oldest first. */
	readonly approvals: readonly PendingApproval[];
};

/** A tool call stopped before dispatch until the user decides (Section 5.3). */
export type PendingApproval = {
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
};

export type ApprovalDecision = "allow_once" | "deny";

export type ProviderSummary = {
	readonly providerId: string;
	readonly name: string;
	/** `builtin` providers ship with OpenBot; `config` providers come from the user's model configuration file. */
	readonly source: "builtin" | "config";
	/** A key is available: stored in the Keychain, or (config providers) resolvable from the configuration. */
	readonly configured: boolean;
	/** A key is stored in the Keychain for this provider. */
	readonly keyStored: boolean;
};

/** Settings as returned to renderers: credentials are never included, only whether one is stored. */
export type RedactedSettings = {
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
			readonly name?: string;
			readonly role?: string;
			readonly instructions?: string;
			readonly model?: ModelRef | null;
			readonly pinned?: boolean;
			readonly status?: BotProfile["status"];
		};
		result: BotProfile;
	};
	"conversations.snapshot": { params: { readonly botId: BotId }; result: ConversationSnapshot };
	"conversations.markRead": { params: { readonly botId: BotId }; result: null };
	"messages.submit": {
		params: { readonly botId: BotId; readonly requestId: string; readonly text: string };
		result: { readonly accepted: true };
	};
	"runs.cancel": { params: { readonly botId: BotId }; result: null };
	"approvals.decide": { params: { readonly approvalId: string; readonly decision: ApprovalDecision }; result: null };
	"settings.get": { params: Record<string, never>; result: RedactedSettings };
	"settings.update": { params: { readonly defaultModel?: ModelRef | null }; result: RedactedSettings };
	"models.list": { params: Record<string, never>; result: readonly ModelSummary[] };
	"credentials.set": {
		params: { readonly providerId: string; readonly apiKey: string };
		result: RedactedSettings;
	};
	"credentials.delete": { params: { readonly providerId: string }; result: RedactedSettings };
};

export type HostMethod = keyof HostMethods;
export type HostParams<M extends HostMethod> = HostMethods[M]["params"];
export type HostResult<M extends HostMethod> = HostMethods[M]["result"];

export const HOST_METHODS = [
	"host.status",
	"bots.list",
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
 * Shape check for an incoming request. The method is only checked to be a string, so a request for an unknown
 * method still gets an `unknown_method` response instead of being dropped; check it with `isHostMethod`.
 */
export function isRequestEnvelope(value: unknown): value is Omit<RequestEnvelope, "method"> & { readonly method: string } {
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
		"params" in value &&
		typeof value.params === "object" &&
		value.params !== null
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
	/** Directories the invocation may touch with file tools, canonical and absolute. */
	readonly grants: readonly string[];
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
};

/** Host to executor. */
export type ExecutorRequest =
	| { readonly kind: "tool.invoke"; readonly invocation: ToolInvocation }
	| { readonly kind: "tool.cancel"; readonly invocationId: string };

/** Executor to Host. */
export type ExecutorMessage =
	| {
			readonly kind: "executor.hello";
			readonly protocolVersion: typeof PROTOCOL_VERSION;
			readonly targetId: string;
			readonly tools: readonly ExecutorToolName[];
	  }
	| { readonly kind: "tool.progress"; readonly invocationId: string; readonly output: string }
	| { readonly kind: "tool.result"; readonly invocationId: string; readonly outcome: ToolOutcome };

// ---------------------------------------------------------------------------
// Tool catalog: what the model is offered. Schemas are plain JSON Schema so that this package stays dependency-free.

export type ToolCapability = "files.read" | "files.write" | "commands" | "web";

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

export const TOOL_CATALOG = [
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
		parameters: object(
			{ path: string("Absolute path, or relative to the workspace."), content: string("The complete file content.") },
			["path", "content"],
		),
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
			},
			["path", "old_text", "new_text"],
		),
	},
	{
		name: "local_exec",
		capability: "commands",
		destination: "executor",
		description:
			"Run a shell command on this Mac with /bin/zsh. The user approves each command. Each call starts fresh in the working directory; cd and variables do not persist. Prefer the file tools for reading and editing files.",
		parameters: object(
			{
				command: string("The command line to run."),
				description: string("What the command does, in five to ten words; shown to the user."),
				cwd: string("Working directory. Defaults to the workspace."),
				timeout_seconds: { type: "integer", minimum: 1, maximum: 600, description: "Default 120." },
			},
			["command", "description"],
		),
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
] as const satisfies readonly ToolDefinition[];

export type ToolName = (typeof TOOL_CATALOG)[number]["name"];
export type ExecutorToolName = Extract<(typeof TOOL_CATALOG)[number], { destination: "executor" }>["name"];

export function toolDefinition(name: string): ToolDefinition | undefined {
	return TOOL_CATALOG.find((tool) => tool.name === name);
}
