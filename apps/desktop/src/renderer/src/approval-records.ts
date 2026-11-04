import type { PendingApproval } from "@openbot/protocol";

export type ApprovalPress = "allow_once" | "deny" | "always_allow";

export type SettledApproval = {
	readonly approvalId: string;
	readonly botId: string;
	readonly conversationId: string;
	readonly callId: string;
	readonly decision: ApprovalPress;
	readonly action: string;
	readonly detail: string;
	readonly at: number;
};

const MAX_RECORDS = 32;
let settledList: readonly SettledApproval[] = [];
const listeners = new Set<() => void>();
const taskConversations = new Map<string, string>();

function publish(next: readonly SettledApproval[]) {
	settledList = next.length > MAX_RECORDS ? next.slice(next.length - MAX_RECORDS) : next;
	for (const listener of listeners) listener();
}

export function rememberApproval(record: SettledApproval) {
	publish([...settledList.filter((item) => item.approvalId !== record.approvalId), record]);
}

export function forgetApproval(approvalId: string) {
	publish(settledList.filter((item) => item.approvalId !== approvalId));
}

export function subscribeApprovalRecords(listener: () => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function approvalRecordSnapshot(): readonly SettledApproval[] {
	return settledList;
}

export type RemoteApproval = {
	readonly approvalId: string;
	readonly decision: "allow" | "deny";
	readonly at: number;
	readonly tool: string;
	readonly conversationId: string;
};

/** Memory records win for the same id. Remote rows fill decisions that are no longer in memory. */
export function mergeApprovalRecords(
	conversationId: string | undefined,
	memory: readonly SettledApproval[],
	remote: readonly RemoteApproval[],
	pending: readonly string[],
): readonly SettledApproval[] {
	if (!conversationId) return [];
	const pendingIds = new Set(pending);
	const byId = new Map<string, SettledApproval>();
	for (const record of memory) {
		if (record.conversationId === conversationId && !pendingIds.has(record.approvalId)) byId.set(record.approvalId, record);
	}
	for (const item of remote) {
		if (item.conversationId !== conversationId || pendingIds.has(item.approvalId) || byId.has(item.approvalId)) continue;
		byId.set(item.approvalId, {
			approvalId: item.approvalId,
			botId: "",
			conversationId: item.conversationId,
			callId: item.approvalId,
			decision: item.decision === "deny" ? "deny" : "allow_once",
			action: item.tool,
			detail: item.tool,
			at: item.at,
		});
	}
	return [...byId.values()].sort((a, b) => a.at - b.at || a.approvalId.localeCompare(b.approvalId));
}

/** Records for one conversation. Missing id matches nothing, so a task view cannot show every bot's records. */
export function settledApprovals(conversationId: string | undefined, pending: readonly string[]): readonly SettledApproval[] {
	if (!conversationId) return [];
	const pendingIds = new Set(pending);
	return settledList.filter((record) => record.conversationId === conversationId && !pendingIds.has(record.approvalId));
}

export function settledForCall(conversationId: string | undefined, callId: string): SettledApproval | undefined {
	if (!conversationId) return undefined;
	return settledList.find((record) => record.conversationId === conversationId && record.callId === callId);
}

export function retireApprovalRecords(input: { readonly conversationId: string | undefined; readonly runActive: boolean; readonly latestUserAt?: number }) {
	if (!input.conversationId) return;
	if (!input.runActive) {
		publish(settledList.filter((record) => record.conversationId !== input.conversationId));
		return;
	}
	if (input.latestUserAt === undefined) return;
	const latestUserAt = input.latestUserAt;
	publish(settledList.filter((record) => record.conversationId !== input.conversationId || record.at >= latestUserAt));
}

export function rememberTaskConversation(taskId: string, approvals: readonly Pick<PendingApproval, "conversationId">[]): string | undefined {
	const found = approvals.find((approval) => approval.conversationId)?.conversationId ?? taskConversations.get(taskId);
	if (found) taskConversations.set(taskId, found);
	return found;
}

export function resetApprovalRecords() {
	settledList = [];
	taskConversations.clear();
	for (const listener of listeners) listener();
}

export function approvalChoices(busy: ApprovalPress | null) {
	const disabled = busy !== null;
	return {
		allow: { disabled, loading: busy === "allow_once" },
		deny: { disabled, loading: busy === "deny" },
		always: { disabled, loading: busy === "always_allow" },
	};
}
