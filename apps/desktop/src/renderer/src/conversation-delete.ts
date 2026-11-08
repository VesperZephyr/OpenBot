import type { ConversationKey } from "@openbot/protocol";
import { clearConversationApprovals } from "./approval-records";

export type ListedConversation = {
	readonly key: ConversationKey;
	readonly core?: boolean;
};

export type ConversationView = {
	readonly kind: string;
	readonly botId?: string;
	readonly groupId?: string;
};

/** The chat a view is showing, when that view is a direct chat or a group. */
export function conversationKeyOf(view: ConversationView): ConversationKey | undefined {
	if (view.kind === "bot" && view.botId) return `bot:${view.botId}`;
	if (view.kind === "group" && view.groupId) return `group:${view.groupId}`;
	return undefined;
}

export function conversationRemoved(
	summaries: Readonly<Record<string, { readonly deleted?: boolean } | undefined>>,
	key: string,
): boolean {
	return summaries[key]?.deleted === true;
}

/** Active Bots whose direct chat is still in the list. */
export function directChatVisible(
	bot: { readonly status: string },
	summaries: Readonly<Record<string, { readonly deleted?: boolean } | undefined>>,
	botId: string,
): boolean {
	return bot.status === "active" && !conversationRemoved(summaries, `bot:${botId}`);
}

/** A specialist Bot whose direct chat was deleted. Hidden and active Bots both stay findable here. */
export function awaitingNewChat(
	bot: { readonly status: string; readonly kind?: string },
	summaries: Readonly<Record<string, { readonly deleted?: boolean } | undefined>>,
	botId: string,
): boolean {
	return bot.kind !== "core" && bot.status !== "deleted" && conversationRemoved(summaries, `bot:${botId}`);
}

/** Local view of a reopened chat: the deleted thread's preview and unread count are not the new chat. */
export function freshConversationSummary<T extends { readonly incomingCount: number; readonly deleted?: boolean; readonly latest?: unknown }>(
	summary: T,
): Omit<T, "deleted" | "latest"> & { readonly readThrough: number; readonly unreadCount: number } {
	const { deleted: _deleted, latest: _latest, ...rest } = summary;
	return { ...rest, readThrough: summary.incomingCount, unreadCount: 0 };
}

/** Where to land after the open chat is removed. Core stays ahead of other remaining chats. */
export function replacementChat(entries: readonly ListedConversation[]): ConversationView {
	const next = entries.find((entry) => entry.core) ?? entries[0];
	if (!next) return { kind: "home" };
	if (next.key.startsWith("group:")) return { kind: "group", groupId: next.key.slice(6) };
	return { kind: "bot", botId: next.key.slice(4) };
}

/**
 * Confirmation is the gate. A cancelled delete leaves the list, the selection, and every approval record alone.
 * A confirmed delete removes that conversation, clears only its approval log, and moves a selection that pointed at it.
 */
export function planConversationDelete<V extends ConversationView>(input: {
	readonly confirmed: boolean;
	readonly deletedKey: ConversationKey;
	readonly conversationId: string | undefined;
	readonly entries: readonly ListedConversation[];
	readonly view: V;
	readonly lastChat: V;
}): { readonly deleted: boolean; readonly entries: readonly ListedConversation[]; readonly view: V; readonly lastChat: V } {
	if (!input.confirmed) return { deleted: false, entries: input.entries, view: input.view, lastChat: input.lastChat };
	clearConversationApprovals(input.conversationId);
	const entries = input.entries.filter((entry) => entry.key !== input.deletedKey);
	const next = replacementChat(entries) as V;
	return {
		deleted: true,
		entries,
		view: conversationKeyOf(input.view) === input.deletedKey ? next : input.view,
		lastChat: conversationKeyOf(input.lastChat) === input.deletedKey ? next : input.lastChat,
	};
}
