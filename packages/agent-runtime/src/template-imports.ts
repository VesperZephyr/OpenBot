import { defineDoc } from "@earendil-works/pi-durable";
import { TEMPLATE_LIMITS } from "@openbot/protocol";
import type { BotRecord } from "./bots.ts";
export type TemplateImportReceipt = { requestId: string; requestDigest: string; botId: string; committedAt: number };
export const TemplateImportsDoc = defineDoc<{ receipts: Record<string, TemplateImportReceipt> }>({
	kind: "openbot.template-imports",
	version: 1,
	scope: "session",
	initial: () => ({ receipts: {} }),
});
export function validateTemplateReceipts(
	receipts: Record<string, TemplateImportReceipt>,
	bots: Record<string, BotRecord>,
): void {
	if (Object.keys(receipts).length > TEMPLATE_LIMITS.receipts) throw Error("Invalid template import receipts");
	for (const [id, r] of Object.entries(receipts)) {
		if (
			!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ||
			r.requestId !== id ||
			!/^[a-f0-9]{64}$/.test(r.requestDigest) ||
			r.botId !== `bot_template_${id}` ||
			!Number.isSafeInteger(r.committedAt) ||
			r.committedAt < 0 ||
			!bots[r.botId] ||
			bots[r.botId]!.kind !== "specialist" ||
			Object.keys(r).length !== 4
		)
			throw Error("Invalid template import receipts");
	}
}
