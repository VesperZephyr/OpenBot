import type { BotAvatar } from "./avatars.ts";
import type { ModelRef, ThinkingLevel } from "./models.ts";
import type { RunRecord } from "./runs.ts";
import type { SkillRef } from "./skills.ts";

export type BotId = string;

export type BotProfile = {
	readonly avatar?: BotAvatar;
	/** Exact reviewed procedures applied only to new direct user messages. */
	readonly defaultSkills?: readonly SkillRef[];
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
	readonly appBinding?: import("./app-execution.ts").AppMutationBinding;
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

/** Sidebar state, in priority order: needs_attention > working > queued > unread > idle. */
export type BotActivity = "needs_attention" | "working" | "queued" | "unread" | "idle";

export type BotSummary = BotProfile & {
	readonly activity: BotActivity;
	/** Tool calls of this Bot waiting for the user's decision. */
	readonly pendingApprovals: number;
	/** The Bot's newest Run since the Host started, including a finished one; drives notifications. */
	readonly lastRun?: Pick<RunRecord, "runId" | "state" | "error">;
};
