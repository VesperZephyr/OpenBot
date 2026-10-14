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

export type TranscriptItem =
	| { readonly kind: "user"; readonly id: string; readonly parts: readonly MessagePart[] }
	| {
			readonly kind: "assistant";
			readonly id: string;
			readonly parts: readonly MessagePart[];
			/** Set when the response ended without a normal stop, such as an error or abort. */
			readonly error?: string;
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
};

export type ProviderSummary = {
	readonly providerId: string;
	readonly name: string;
	readonly configured: boolean;
};

/** Settings as returned to renderers: credentials are never included, only whether one is stored. */
export type RedactedSettings = {
	readonly defaultModel?: ModelRef;
	readonly providers: readonly ProviderSummary[];
	readonly dataDirectory: string;
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
	readonly runId: RunId;
	readonly conversationId: string;
	readonly tool: string;
	readonly args: unknown;
	readonly argsDigest: string;
	readonly target: ExecutionTarget;
	readonly deadline: number;
};
