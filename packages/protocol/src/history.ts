import type { ConversationKey, GroupPost, TranscriptItem } from "./index.ts";
export type TimelinePosition = { kind: "latest" } | { kind: "around"; rowId: string } | { kind: "cursor"; cursor: string };
export type TimelineRow = {
	id: string;
	ordinal: number;
	revision: number;
	content:
		| { kind: "direct"; item: TranscriptItem }
		| { kind: "group"; post: GroupPost }
		| { kind: "large"; originalKind: string; preview: string; detail: string };
};
export type TimelineWindow = {
	conversationKey: ConversationKey;
	generation: string;
	revision: number;
	rows: readonly TimelineRow[];
	before?: string;
	after?: string;
	atLatest: boolean;
	readCursor?: number;
};
export type WindowInput = { conversationKey: ConversationKey; deliveryId?: string; position: TimelinePosition; limit?: number };
export type WindowResult =
	| { status: "ready"; window: TimelineWindow }
	| { status: "building" }
	| { status: "unavailable"; retryable: boolean };
export type DetailInput = { conversationKey: ConversationKey; detail: string; part: number };
export type DetailResult = { text: string; nextPart?: number; revision: number };
export type IndexStatus = { state: "ready" | "building" | "unavailable"; retryable: boolean };
