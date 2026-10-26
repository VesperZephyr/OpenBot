import { defineDoc, type Harness } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord/context";
import type { LifecycleRecord } from "@openbot/protocol";
const LifecycleDoc = defineDoc<{
	revision: number;
	userPaused: boolean;
	needsResume: boolean;
	autoResume?: boolean;
	lastReason?: NonNullable<LifecycleRecord["lastReason"]>;
}>({ kind: "openbot.lifecycle", version: 1, scope: "session", initial: () => ({ revision: 0, userPaused: false, needsResume: false }) });
export interface LifecycleStore {
	read(): Promise<LifecycleRecord>;
	write(record: LifecycleRecord): Promise<void>;
}
export function lifecycleStore(harness: Harness, context: Context): LifecycleStore {
	return {
		async read() {
			return (await harness.snapshot(LifecycleDoc, context)) ?? { revision: 0, userPaused: false, needsResume: false };
		},
		async write(record) {
			await harness.commit(async (tx) => {
				const doc = await tx.doc(LifecycleDoc);
				delete doc.lastReason;
				delete doc.autoResume;
				Object.assign(doc, JSON.parse(JSON.stringify(record)));
			}, context);
		},
	};
}
