import type { ArtifactOperation, ArtifactOperationResult, ArtifactRef } from "./artifacts.ts";
import type { BotId } from "./bots.ts";
import type { SkillOperation, SkillResult } from "./skills.ts";
import type { ExecutionTarget } from "./target.ts";
import type { ExecutorToolName } from "./tools.ts";

// ---------------------------------------------------------------------------
// Executor protocol (Section 6.2)

/** Executor-protocol invocation, identical for the local executor and any future target. */
export type ToolInvocation = {
 readonly connector?:import("./connectors.ts").ConnectorBinding;
	readonly completionTracking?: boolean;
 readonly authorityRevision?: number;
	readonly runId?: string;
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

export type ToolFailureReason = "approval_expired" | "permission_revoked" | "approval_denied";
export type ToolOutcome = {
 readonly failureReason?:ToolFailureReason;
	readonly status: InvocationStatus;
	/** Bounded text for the model. */
	readonly output: string;
	/** Validated JSON for programmatic callers; absent for existing text-only work tools. */
	readonly value?: import("./app-capabilities.ts").JsonValue;
	/** Command exit details, separate from whether the invocation itself succeeded. */
	readonly exit?: { readonly code: number | null; readonly signal: string | null };
	readonly truncated?: boolean;
	/** Set when `local_exec` moved the command to the background; `task_output` and `task_stop` take it. */
	readonly taskId?: string;
	readonly artifact?: ArtifactRef;
	readonly routineProposal?: import("./routines.ts").RoutineProposal;
};

/** Host to executor. */
export type ExecutorRequest =
 | {readonly kind:"connector.control";readonly messageId:string;readonly requestId:string;readonly targetId:string;readonly authorityRevision:number;readonly operation:import("./connectors.ts").ConnectorControl}
 | {readonly kind:"tasks.inspect";readonly messageId:string;readonly targetId:string;readonly keys:readonly import("./background.ts").BackgroundTaskKey[];readonly acknowledge?:boolean}
 | {readonly kind:"skill.request"; readonly messageId:string; readonly requestId:string; readonly targetId:string; readonly operation:SkillOperation; readonly authorityRevision?:number}
	| {
			readonly kind: "artifact.request";
			readonly messageId: string;
			readonly requestId: string;
			readonly targetId: string;
			readonly operation: ArtifactOperation;
	  }
 | {readonly kind:"policy.sync";readonly messageId:string;readonly targetId:string;readonly revision:number}
 | {readonly kind:"execution.revoke";readonly messageId:string;readonly targetId:string;readonly invocationIds:readonly string[]}
 | {readonly kind:"execution.quiesce";readonly messageId:string;readonly targetId:string}
	| { readonly kind: "tool.invoke"; readonly invocation: ToolInvocation }
	| { readonly kind: "tool.cancel"; readonly invocationId: string }
	/** Read-only receipt lookup; the executor answers with `tool.status`. */
	| { readonly kind: "tool.status"; readonly invocationId: string }
	/** The Host committed the outcome; the receipt may be pruned after the retention period. */
	| { readonly kind: "result.ack"; readonly invocationId: string }
	/** The conversation's work was stopped: stop its background tasks too. */
	| { readonly kind: "tasks.stop"; readonly conversationId: string; readonly runId?: string };

/** Executor to Host. */
export type ExecutorMessage =
 | {readonly kind:"connector.response";readonly messageId:string;readonly result?:import("./connectors.ts").ConnectorConnection;readonly error?:string}
 | {readonly kind:"connector.changed";readonly connectorId:string}
 | {readonly kind:"tasks.inspected";readonly messageId:string;readonly receipts?:readonly import("./background.ts").BackgroundTaskReceipt[];readonly error?:string}
 | {readonly kind:"skill.response"; readonly messageId:string; readonly result?:SkillResult; readonly error?:string; readonly uncertain?:boolean}
	| { readonly kind: "artifact.response"; readonly messageId: string; readonly result: ArtifactOperationResult; readonly error?: never }
	| { readonly kind: "artifact.response"; readonly messageId: string; readonly error: string; readonly result?: never }
 | {readonly kind:"policy.synced";readonly messageId:string;readonly confirmed:boolean}
 | {readonly kind:"execution.quiesced";readonly messageId:string;readonly confirmed:boolean}
	| {
			readonly kind: "executor.hello";
			readonly protocolVersion: typeof import("./version.ts").PROTOCOL_VERSION;
			readonly targetId: string;
			/** New for every executor process, so the Host can tell a restarted executor apart. */
			readonly instanceId: string;
			readonly tools: readonly ExecutorToolName[];
	  }
	| { readonly kind: "tool.progress"; readonly invocationId: string; readonly output: string }
	| { readonly kind: "tool.result"; readonly invocationId: string; readonly outcome: ToolOutcome }
	| {
			readonly kind: "tool.status";
   readonly argsDigest?:string;
   readonly tool?:string;
			readonly invocationId: string;
			readonly status: InvocationStatus | "accepted" | "absent";
			readonly outcome?: ToolOutcome;
	  };
