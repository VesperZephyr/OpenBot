/** Trusted executor receipts and Host-owned completion delivery; output is untrusted task data. */
export const BACKGROUND_LIMITS = { pending: 64, perRun: 8, retained: 4096, batch: 16, outputBytes: 16384 } as const;
export type BackgroundTaskKey = { readonly taskId: string; readonly invocationId: string };
export type BackgroundTaskReceipt = BackgroundTaskKey & {
	readonly conversationId: string;
	readonly runId?: string;
	readonly botId?: string;
	readonly status: "running" | "succeeded" | "failed" | "cancelled" | "unknown";
	readonly output?: string;
	readonly truncated?: boolean;
	readonly consumed: boolean;
	readonly finishedAt?: number;
	readonly exit?: { readonly code: number | null; readonly signal: string | null };
};
export type BackgroundRecord = {
	readonly invocationId: string;
	readonly argsDigest: string;
	readonly targetId: string;
	readonly sourceRunId: string;
	readonly botId: string;
	readonly conversationId: string;
	readonly channelId?: string;
	readonly taskId?: string;
	readonly deliveryId?: string;
	readonly continuationRunId?: string;
	readonly createdAt: number;
	readonly state: "reserved" | "running" | "ready" | "queued" | "delivering" | "delivered" | "suppressed" | "attention";
	readonly receipt?: BackgroundTaskReceipt;
	readonly acknowledged?: boolean;
	readonly reason?: string;
};
export function validBackgroundKeys(value: unknown): value is readonly BackgroundTaskKey[] {
	return (
		Array.isArray(value) &&
		value.length <= BACKGROUND_LIMITS.batch &&
		value.every(
			(key) =>
				key &&
				typeof key === "object" &&
				Object.keys(key).length === 2 &&
				typeof key.taskId === "string" &&
				key.taskId.length > 0 &&
				key.taskId.length <= 128 &&
				typeof key.invocationId === "string" &&
				key.invocationId.length > 0 &&
				key.invocationId.length <= 2048,
		)
	);
}
