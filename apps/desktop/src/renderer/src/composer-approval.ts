export function hasPendingApproval(
	conversationKey: string,
	state: {
		readonly conversations: Readonly<Record<string, { readonly approvals: readonly unknown[] } | undefined>>;
		readonly groupSnapshots: Readonly<Record<string, { readonly tasks: readonly { readonly conversation?: { readonly approvals: readonly unknown[] } | undefined }[] } | undefined>>;
	},
): boolean {
	if (conversationKey.startsWith("bot:")) return (state.conversations[conversationKey.slice(4)]?.approvals.length ?? 0) > 0;
	if (!conversationKey.startsWith("group:")) return false;
	return state.groupSnapshots[conversationKey.slice(6)]?.tasks.some((task) => (task.conversation?.approvals.length ?? 0) > 0) ?? false;
}
