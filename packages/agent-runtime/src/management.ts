/** Local management intents and receipts. Only the Host writes these; results commit with the Bot mutation. */
import { defineDoc, type Harness } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord/context";
import { type BotManagementProposal, type BotManagementReceipt, ProtocolError } from "@openbot/protocol";
export const ManagementDoc = defineDoc<{ operations: Record<string, BotManagementReceipt> }>({
	kind: "openbot.management",
	version: 1,
	scope: "session",
	initial: () => ({ operations: {} }),
});
export function managementStore(harness: Harness, context: Context) {
	return {
		async get(id: string): Promise<BotManagementReceipt | undefined> {
			return (await harness.snapshot(ManagementDoc, context))?.operations[id];
		},
		async list(): Promise<BotManagementReceipt[]> {
			return Object.values((await harness.snapshot(ManagementDoc, context))?.operations ?? {});
		},
		async settle(id: string, outcome: "denied" | "cancelled" | "failed", at: number): Promise<void> {
			await harness.commit(async (tx) => {
				const doc = await tx.doc(ManagementDoc);
				const record = doc.operations[id];
				if (record && !record.result && !record.outcome) doc.operations[id] = { ...record, outcome, completedAt: at };
			}, context);
		},
		async propose(proposal: BotManagementProposal): Promise<BotManagementReceipt> {
			return harness.commit(async (tx) => {
				const doc = await tx.doc(ManagementDoc);
				const existing = doc.operations[proposal.invocationId];
				if (existing && existing.fingerprint !== proposal.fingerprint)
					throw new ProtocolError("request_conflict", "Management invocation arguments changed");
				doc.operations[proposal.invocationId] ??= proposal;
				return JSON.parse(JSON.stringify(doc.operations[proposal.invocationId])) as BotManagementReceipt;
			}, context);
		},
	};
}
