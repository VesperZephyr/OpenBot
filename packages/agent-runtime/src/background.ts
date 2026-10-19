/** Host-owned durable completion subscriptions. Executor receipts remain in the executor database. */
import { defineDoc, type Harness } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord/context";
import { BACKGROUND_LIMITS, ProtocolError, type BackgroundRecord } from "@openbot/protocol";
import { GroupsDoc } from "./groups.ts";
import { RunsDoc } from "./runs.ts";
type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
const copy = <T>(value: T): Mutable<T> => JSON.parse(JSON.stringify(value));
export const BackgroundDoc = defineDoc<Mutable<{ records: Record<string, BackgroundRecord> }>>({
	kind: "openbot.background-completions",
	version: 1,
	scope: "session",
	initial: () => ({ records: {} }),
});
export const backgroundTerminal = (record: BackgroundRecord) => ["delivered", "suppressed", "attention"].includes(record.state);
export function backgroundStore(harness: Harness, context: Context) {
	const read = async () => (await harness.snapshot(BackgroundDoc, context))?.records ?? {};
	return {
		async list(): Promise<BackgroundRecord[]> {
			return Object.values(await read());
		},
		async get(id: string): Promise<BackgroundRecord | undefined> {
			return (await read())[id];
		},
		async reserve(record: BackgroundRecord): Promise<void> {
			await harness.commit(async (tx) => {
				const doc = await tx.doc(BackgroundDoc),
					existing = doc.records[record.invocationId];
				if (existing) {
					if (
						existing.argsDigest !== record.argsDigest ||
						existing.sourceRunId !== record.sourceRunId ||
						existing.conversationId !== record.conversationId ||
						existing.targetId !== record.targetId
					)
						throw new ProtocolError("request_conflict", "Background task identity changed");
					return;
				}
				const records = Object.values(doc.records),
					pending = records.filter((r) => !backgroundTerminal(r));
				if (
					pending.length >= BACKGROUND_LIMITS.pending ||
					pending.filter((r) => r.sourceRunId === record.sourceRunId).length >= BACKGROUND_LIMITS.perRun ||
					records.filter((r) => r.taskId).length >= BACKGROUND_LIMITS.retained
				)
					throw new ProtocolError(
						"invalid_request",
						"Background task capacity reached; stop pending work or review local history before starting another command",
					);
				doc.records[record.invocationId] = copy(record);
			}, context);
		},
		async bind(id: string, taskId?: string): Promise<BackgroundRecord | undefined> {
			await harness.commit(async (tx) => {
				const doc = await tx.doc(BackgroundDoc),
					record = doc.records[id];
				if (!record) return;
				if (!taskId) {
					if (!record.taskId) delete doc.records[id];
					return;
				}
				if (record.taskId) {
					if (record.taskId !== taskId) throw new ProtocolError("request_conflict", "Background task identity changed");
					return;
				}
				record.taskId = taskId;
				if (backgroundTerminal(record)) return;
				record.state = "running";
				if (!record.channelId || record.channelId === "direct") return;
				const groups = await tx.doc(GroupsDoc),
					run = (await tx.doc(RunsDoc)).runs[record.sourceRunId];
				const source = Object.values(groups.deliveries).find((d) => run?.requestIds.includes(`delivery:${d.deliveryId}`));
				const root = source?.rootId ? groups.roots?.[source.rootId] : undefined;
				const group = groups.groups[record.channelId];
				if (
					!source ||
					source.state !== "pending" ||
					source.transferId ||
					!root ||
					root.state !== "running" ||
					!group ||
					group.status !== "active" ||
					root.automaticDeliveries >= 12
				) {
					record.state = "suppressed";
					record.reason = "The originating group task is no longer eligible";
					return;
				}
				root.automaticDeliveries++;
				const deliveryId = `background:${id}`;
				record.deliveryId = deliveryId;
				groups.deliveries[deliveryId] = {
					deliveryId,
					rootId: root.rootId,
					groupId: source.groupId,
					postId: source.postId,
					botId: source.botId,
					input: "",
					state: "pending",
					origin: "background",
					backgroundSourceId: source.deliveryId,
					backgroundReady: false,
					depth: source.depth ?? 0,
					ancestry: copy(source.ancestry ?? [source.botId]),
				};
			}, context);
			return (await read())[id];
		},
		async update(
			id: string,
			patch: Partial<Pick<BackgroundRecord, "state" | "receipt" | "continuationRunId" | "reason" | "acknowledged">>,
			input?: string,
		): Promise<void> {
			await harness.commit(async (tx) => {
				const record = (await tx.doc(BackgroundDoc)).records[id];
				if (!record) return;
				if (record.state === "suppressed" && patch.state && patch.state !== "suppressed") return;
				Object.assign(record, copy(patch));
				if (record.deliveryId) {
					const delivery = (await tx.doc(GroupsDoc)).deliveries[record.deliveryId];
					if (delivery?.state === "pending") {
						if (["suppressed", "attention"].includes(record.state)) {
							delivery.state = "cancelled";
							delivery.closed = true;
						} else if (input !== undefined) {
							delivery.input = input;
							delivery.backgroundReady = true;
						}
					}
				}
			}, context);
		},
	};
}
