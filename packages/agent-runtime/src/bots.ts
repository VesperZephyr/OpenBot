import { defineDoc } from "@earendil-works/pi-durable";
import type { BotProfile } from "@openbot/protocol";
/** Pi IDs are branded numbers; the record keeps the Pi conversation ID in that form. */
export type BotRecord = Omit<BotProfile, "kind" | "revision" | "defaultSkills"> & {
	readonly revision?: number;
	readonly kind?: BotProfile["kind"];
	readonly conversationId: number;
	readonly defaultSkills?: { name: string; revision: number; sha256: string }[];
};

/** Session-scoped Bot index stored next to Pi's own documents. */
export const BotsDoc = defineDoc<{ bots: Record<string, BotRecord> }>({
	kind: "openbot.bots",
	version: 1,
	scope: "session",
	initial: () => ({ bots: {} }),
});
