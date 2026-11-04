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

/** Header copy. An approval is shown on its card, so the title stays Working or Idle. */
export function headerStatusLabel(status: ConversationPresence): "Working" | "Idle" {
	return status === "idle" ? "Idle" : "Working";
}
