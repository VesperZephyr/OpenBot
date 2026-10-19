/** Host-owned connector configuration and mutation identities. Contains no credentials or process output. */
import { defineDoc, type Harness } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord/context";
import { CONNECTOR_LIMITS, ProtocolError, type ConnectorDefinition, type ConnectorTool } from "@openbot/protocol";
type RecordState = ConnectorDefinition & { readonly cleanupPending?: boolean; readonly tools: readonly ConnectorTool[] };
type Mutation = { readonly requestId: string; readonly fingerprint: string; readonly connectorId: string; readonly finished: boolean };
type Mutable<T> = unknown extends T
	? import("@openbot/protocol").JsonValue
	: T extends readonly (infer U)[]
		? Mutable<U>[]
		: T extends object
			? { -readonly [K in keyof T]: Mutable<T[K]> }
			: T;
export const ConnectorsDoc = defineDoc<Mutable<{ records: Record<string, RecordState>; mutations: Record<string, Mutation> }>>({
	kind: "openbot.connectors",
	version: 1,
	scope: "session",
	initial: () => ({ records: {}, mutations: {} }),
});
const copy = <T>(value: T): Mutable<T> => JSON.parse(JSON.stringify(value));
export function connectorStore(harness: Harness, context: Context) {
	const read = async () => await harness.snapshot(ConnectorsDoc, context);
	return {
		async list(): Promise<RecordState[]> {
			return Object.values((await read())?.records ?? {});
		},
		async get(id: string): Promise<RecordState | undefined> {
			return (await read())?.records[id];
		},
		async operation(id: string): Promise<Mutation | undefined> {
			return (await read())?.mutations[id];
		},
		async begin(requestId: string, fingerprint: string, definition: ConnectorDefinition, expectedRevision: number): Promise<boolean> {
			return harness.commit(async (tx) => {
				const doc = await tx.doc(ConnectorsDoc),
					prior = doc.mutations[requestId];
				if (prior) {
					if (prior.fingerprint !== fingerprint) throw new ProtocolError("request_conflict", "Connector request identity changed");
					return false;
				}
				const existing = doc.records[definition.connectorId];
				if ((existing?.revision ?? 0) !== expectedRevision || (existing?.removed && !definition.removed))
					throw new ProtocolError("request_conflict", "Connector changed. Reload before continuing.");
				if (
					Object.keys(doc.mutations).length >= CONNECTOR_LIMITS.receipts ||
					(!existing &&
						(Object.keys(doc.records).length >= CONNECTOR_LIMITS.retained ||
							Object.values(doc.records).filter((record) => !record.removed).length >= CONNECTOR_LIMITS.installed))
				)
					throw new ProtocolError("invalid_request", "Connector capacity reached");
				doc.records[definition.connectorId] = copy({
					...definition,
					tools: existing?.tools ?? [],
					...(definition.removed ? { cleanupPending: true } : {}),
				});
				doc.mutations[requestId] = { requestId, fingerprint, connectorId: definition.connectorId, finished: false };
				return true;
			}, context);
		},
		async finish(requestId: string, tools?: readonly ConnectorTool[]): Promise<void> {
			await harness.commit(async (tx) => {
				const doc = await tx.doc(ConnectorsDoc),
					operation = doc.mutations[requestId];
				if (!operation) return;
				operation.finished = true;
				const record = doc.records[operation.connectorId];
				if (record && tools) record.tools = copy(tools);
				if (record?.removed) delete record.cleanupPending;
			}, context);
		},
	};
}
