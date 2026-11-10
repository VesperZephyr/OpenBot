import type { ApprovalState } from "./approvals.ts";
import type { ConversationKey } from "./conversations.ts";
import type { RunRecord } from "./runs.ts";

/**
 * The work one message starts (Section 7.2). Messages sent while a Run is queued or running join it. A Run counts
 * against the active-Run cap from `running` until it is terminal; waiting for approval counts as running.
 */
/** Local recorded model usage; estimates are never provider invoices. */
export type UsageCounters = {
 readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheWrite: number;
 readonly totalTokens: number; readonly reasoning?: number; readonly cacheWrite1h?: number;
};
export type UsageBucket = UsageCounters & {
 readonly modelKey: string; readonly source: "builtin" | "configured" | "unknown"; readonly estimatedUsd?: number;
};
export type UsageSummary = UsageCounters & {
 readonly available: boolean; readonly estimatedUsd?: number; readonly models: readonly UsageBucket[]; readonly truncated: boolean;
};
export type RunEvidence = {
 readonly taskId?: string;
 readonly runId: string; readonly state: RunRecord["state"]; readonly createdAt: number; readonly endedAt?: number;
 readonly conversationKey: ConversationKey; readonly usage: UsageSummary;
 readonly references: readonly { readonly kind: "result" | "tool" | "approval"; readonly messageId: string; readonly approvalId?: string; readonly approvalState?: ApprovalState }[];
 readonly referencesTruncated: boolean;
};
export type BotUsage = { readonly botId: string; readonly total: UsageSummary; readonly runs: readonly RunEvidence[] };
