/**
 * Approvals as a Pi session document (`openbot.approvals`, Section 5.3), so a pending request and the user's decision
 * survive a Host restart and commit atomically with the rest of Host state. Only Host code writes it, through
 * `ApprovalStore`; tools never see it.
 */
import type { Context } from "@earendil-works/chord/context";
import { defineDoc, type Harness, type JsonObject } from "@earendil-works/pi-durable";
import type { ApprovalRecord } from "@openbot/protocol";

/** The record as stored: arguments are the JSON object Pi validated for the tool call. */
type StoredApproval = Omit<ApprovalRecord, "args"> & { readonly args: JsonObject };

const ApprovalsDoc = defineDoc<{ approvals: Record<string, StoredApproval> }>({
	kind: "openbot.approvals",
	version: 1,
	scope: "session",
	initial: () => ({ approvals: {} }),
});

/** Durable approval records keyed by `approvalId`. Every `put` and `prune` is one Pi commit. */
export interface ApprovalStore {
	get(approvalId: string): Promise<ApprovalRecord | undefined>;
	put(record: ApprovalRecord): Promise<void>;
	pending(): Promise<readonly ApprovalRecord[]>;
	/**
	 * Delete answered records last changed before `before` (epoch ms): consumed, withdrawn, and decided ones whose
	 * result was committed before the Host could mark them consumed. Pending records are kept.
	 */
	prune(before: number): Promise<void>;
}

export function approvalStore(harness: Harness, context: Context): ApprovalStore {
	const all = async (): Promise<Readonly<Record<string, ApprovalRecord>>> =>
		(await harness.snapshot(ApprovalsDoc, context))?.approvals ?? {};
	return {
		get: async (approvalId) => all().then((records) => records[approvalId]),
		put: async (record) => {
			// A JSON round trip: the draft must not keep references to caller objects, and drops undefined members.
			const copy = JSON.parse(JSON.stringify(record)) as StoredApproval;
			await harness.commit(async (tx) => {
				(await tx.doc(ApprovalsDoc)).approvals[record.approvalId] = copy;
			}, context);
		},
		pending: async () => Object.values(await all()).filter((record) => record.state === "pending"),
		prune: async (before) => {
			const stale = Object.values(await all())
				.filter((record) => record.state !== "pending" && (record.decidedAt ?? record.createdAt) < before)
				.map((record) => record.approvalId);
			if (stale.length === 0) return;
			await harness.commit(async (tx) => {
				const doc = await tx.doc(ApprovalsDoc);
				for (const approvalId of stale) delete doc.approvals[approvalId];
			}, context);
		},
	};
}
