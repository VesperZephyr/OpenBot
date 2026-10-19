/** Local presentation metadata. These documents are never selected as model prompt sections. */
import { defineDoc, type Harness, type Tx } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord/context";
import {
	ProtocolError,
	type ConversationKey,
	type ConversationPreview,
	type ConversationSnapshot,
	type ConversationSummary,
	type GroupPost,
} from "@openbot/protocol";

type Projection = { messageCount: number; incomingCount: number; latest?: ConversationPreview };
type RecordState = Projection & { readThrough: number };
export const ConversationIndexDoc = defineDoc<{ records: Record<string, RecordState> }>({
	kind: "openbot.conversation-index",
	version: 1,
	scope: "session",
	initial: () => ({ records: {} }),
});

export function previewText(text: string): string {
	const plain = text
		.replace(/```[^\n]*\n?/g, " ")
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/<[^>]*>/g, " ")
		.replace(/^[ \t]*(?:#{1,6}|>|[-*])\s+/gm, "")
		.replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
		.replace(/(?<!\w)([*_])(\S(?:.*?\S)?)\1(?!\w)/g, "$2")
		.replace(/`+/g, "")
		.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return Array.from(plain || text.trim())
		.slice(0, 160)
		.join("");
}
function project(messages: readonly ConversationPreview[]): Projection {
	const latest = messages.at(-1);
	return {
		messageCount: messages.length,
		incomingCount: messages.filter((m) => m.senderId !== "user").length,
		...(latest ? { latest: { ...latest, text: previewText(latest.text) } } : {}),
	};
}
export function directMessages(snapshot: ConversationSnapshot): ConversationPreview[] {
	return snapshot.items.flatMap((item) => {
		if (item.kind !== "user" && item.kind !== "assistant") return [];
        if (item.kind === "user" && item.source === "background") return [];
		const text = [...item.parts.map((p) => p.text), ...(item.kind === "user" ? (item.attachments?.map((a) => a.name) ?? []) : [])].join(
			"\n",
		);
		return text.trim() ? [{ id: item.id, senderId: item.kind === "user" ? "user" : snapshot.botId, text, at: item.at ?? 0 }] : [];
	});
}
export function groupMessages(posts: readonly GroupPost[]): ConversationPreview[] {
	return posts
		.filter((p) => p.kind !== "delegation" && p.kind !== "handoff" && p.text.trim())
		.map((p) => ({ id: p.postId, senderId: p.senderId, text: p.text, at: p.at }));
}
export const directProjection = (snapshot: ConversationSnapshot): Projection => project(directMessages(snapshot));
export const groupProjection = (posts: readonly GroupPost[]): Projection => project(groupMessages(posts));
function summary(key: ConversationKey, record: RecordState): ConversationSummary {
	const { messageCount: _count, ...state } = record;
	return { conversationKey: key, ...state, unreadCount: state.incomingCount - state.readThrough };
}
/** New identities call this with empty history; absent legacy identities start with their old history read. */
export async function projectConversation(tx: Tx, key: ConversationKey, next: Projection): Promise<void> {
	const doc = await tx.doc(ConversationIndexDoc);
	const old = doc.records[key];
	if (old && old.messageCount >= next.messageCount) return;
	doc.records[key] = { ...next, readThrough: old?.readThrough ?? next.incomingCount };
}
export function conversationIndexStore(harness: Harness, context: Context) {
	const read = async () => (await harness.snapshot(ConversationIndexDoc, context))?.records ?? {};
	return {
		async list(): Promise<ConversationSummary[]> {
			return Object.entries(await read()).map(([key, record]) => summary(key as ConversationKey, record));
		},
		async projectDirect(snapshot: ConversationSnapshot): Promise<number> {
			const next = directProjection(snapshot);
			const key: ConversationKey = `bot:${snapshot.botId}`;
			const old = (await read())[key];
			// Streaming changes must not write the session document and trigger every observer again.
			if (!old || old.messageCount < next.messageCount) await harness.commit((tx) => projectConversation(tx, key, next), context);
			return next.incomingCount;
		},
		async markRead(key: ConversationKey, through: number): Promise<boolean> {
			return harness.commit(async (tx) => {
				const record = (await tx.doc(ConversationIndexDoc)).records[key];
				if (!record) throw new ProtocolError("not_found", "Conversation is unavailable");
				if (!Number.isSafeInteger(through) || through < 0 || through > record.incomingCount)
					throw new ProtocolError("invalid_request", "Invalid reading position");
				if (through <= record.readThrough) return false;
				record.readThrough = through;
				return true;
			}, context);
		},
	};
}
