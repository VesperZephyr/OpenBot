/** Header status from a conversation snapshot. No inferred activity. */
export type ConversationPresence = "working" | "awaiting_approval" | "idle";

export function conversationPresence(input: {
	readonly approvals: number;
	readonly live: boolean;
	readonly pending: number;
	readonly runState?: string | undefined;
}): ConversationPresence {
	if (input.approvals > 0) return "awaiting_approval";
	if (input.live || input.pending > 0 || input.runState === "running" || input.runState === "queued") return "working";
	return "idle";
}

export function presenceLabel(status: ConversationPresence): "Working" | "Waiting for approval" | "Idle" {
	if (status === "working") return "Working";
	if (status === "awaiting_approval") return "Waiting for approval";
	return "Idle";
}
