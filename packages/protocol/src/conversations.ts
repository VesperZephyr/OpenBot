import type { ArtifactRef } from "./artifacts.ts";
import type { PendingApproval } from "./approvals.ts";
import type { BotId } from "./bots.ts";
import type { RunRecord } from "./runs.ts";
import type { SkillRef } from "./skills.ts";

// ---------------------------------------------------------------------------
// Domain data

export type ConversationKey = `bot:${string}` | `group:${string}`;
export type ConversationPreview = { readonly id: string; readonly senderId: string; readonly text: string; readonly at: number };
export type ConversationSummary = {
	readonly conversationKey: ConversationKey;
	readonly latest?: ConversationPreview;
	readonly incomingCount: number;
	readonly readThrough: number;
	readonly unreadCount: number;
	/** Set when the user deleted this conversation. The Bot or group identity is unchanged. */
	readonly deleted?: boolean;
};

export type ConversationSearchHit = {
	readonly conversationKey: ConversationKey;
	readonly messageId: string;
	readonly senderId: string;
	readonly at: number;
	readonly snippet: string;
	readonly matchStart: number;
	readonly matchEnd: number;
};
export type ConversationSearchResult = { readonly items: readonly ConversationSearchHit[]; readonly nextCursor?: string };

export type MessagePart = { readonly type: "text"; readonly text: string };

/**
 * `interrupted`: the call may have partly run and its effect is unknown (Section 5.1); the user should check it.
 * `cancelled`: the call was aborted because the user stopped its Run.
 */
export type ToolCallStatus = "pending" | "running" | "succeeded" | "failed" | "interrupted" | "cancelled";

export type TranscriptItem =
	| { readonly kind: "outcome"; readonly id: string; readonly runId: string; readonly category: "failed" | "cancelled" | "withdrawn" | "empty" | "stopping" | "interrupted" | "queued_cancelled"; readonly at?: number }
	| {
			readonly kind: "user";
			readonly source?:"background" | "routine";
			readonly id: string;
			readonly parts: readonly MessagePart[];
			readonly at?: number;
			readonly attachments?: readonly ArtifactRef[];
 readonly skills?:readonly SkillRef[];
			readonly error?: string;
	  }
	| {
			readonly kind: "assistant";
 readonly routine?: import("./routines.ts").RoutineReport;
 readonly artifacts?: readonly ArtifactRef[];
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
   readonly failureReason?:import("./executor.ts").ToolFailureReason;
			/** Bounded text the model received, or the running output while the call is live. */
			readonly output?: string;
			/** Set when a `local_exec` call moved its command to the background. */
			readonly taskId?: string;
			readonly artifact?: ArtifactRef;
	readonly routineProposal?: import("./routines.ts").RoutineProposal;
			readonly execution?: import("./app-execution.ts").AppExecution;
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
 readonly activity?: { readonly runId: string; readonly labelKey: import("./activity.ts").ActivityLabel };
 readonly toolRunning?: boolean;
 readonly tools?: readonly { readonly callId: string; readonly output?: string }[];
	readonly state: Extract<RunState, "running" | "waiting_approval" | "waiting_user" | "cancelling">;
	/** Text of the response being generated, committed at Pi's progress interval. */
	readonly partial?: readonly MessagePart[];
	readonly retry?: { readonly at: number; readonly error: string };
};

export type ConversationSnapshot = {
 readonly messageMode?: boolean;
 /** Latest failed user input, independent of the visible history window. */
 readonly retry?:{readonly outcomeId?:string;readonly text:string;readonly artifactIds?:readonly string[];readonly skills?:readonly SkillRef[]};
 /** Attention derived from committed outcomes, independent of the displayed history page. */
 readonly attention?: boolean;
	readonly backgroundTasks?:readonly import("./background.ts").BackgroundRecord[];
	/** Incoming committed messages present in this snapshot; safe upper bound for a read acknowledgement. */
	readonly readCursor?: number;
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

export type PendingMessage = { readonly source?:"background" | "routine"; readonly id: string; readonly parts: readonly MessagePart[]; readonly attachments?: readonly ArtifactRef[]; readonly skills?:readonly SkillRef[] };
