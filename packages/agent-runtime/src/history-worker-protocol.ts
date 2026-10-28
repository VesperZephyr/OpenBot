import type { ConversationKey, WindowInput } from "@openbot/protocol";
import type { HistoryBatch } from "./history-store.ts";
export type HistoryCommand =
	| { method: "apply"; batch: HistoryBatch }
	| { method: "checkpoint"; partition: string }
	| { method: "compactionOrdinal"; partition: string; rowId: string; head: number }
	| { method: "link"; partition: string; rowId: string }
	| { method: "stageDetail" | "stageMessage"; partition: string; rowId: string; part: number; text: string }
	| { method: "resolveDetail"; key: ConversationKey; token: string }
	| { method: "detail"; key: ConversationKey; token: string; part: number }
	| { method: "context"; key: ConversationKey; rowId: string; before: number; after: number }
	| { method: "window"; input: WindowInput }
	| { method: "search"; query: string; keys: ConversationKey[]; scope: string; cursor?: string }
	| { method: "close" }
	| { method: "cancel" };
export type HistoryRequest = HistoryCommand & { id: number };
export type HistoryResponse = { id: number; value?: unknown; error?: string; code?: string | undefined };
