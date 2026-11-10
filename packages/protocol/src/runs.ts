import type { BotId } from "./bots.ts";
import type { LifecycleReason } from "./lifecycle.ts";

export type RunId = string;

export type RunRecord = {
	readonly channelId?: string;
	readonly runId: RunId;
	readonly botId: BotId;
	readonly state: "queued" | "running" | "completed" | "failed" | "cancelled" | "needs_attention";
 readonly interruption?: {readonly reason:LifecycleReason|"permission_revoked";readonly requestedAt:number;readonly settledAt?:number};
	/** OpenBot request IDs of every message in this Run, first one starts it. */
	readonly requestIds: readonly string[];
	readonly createdAt: number;
	readonly startedAt?: number;
	readonly endedAt?: number;
	readonly error?: string;
};
