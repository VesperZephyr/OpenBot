import { RunsDoc, isTerminal } from "./runs.ts";
import { GroupsDoc } from "./groups.ts";
import { pruneUsage } from "./usage.ts";
import { defineDoc, type Harness } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord/context";
import { ProtocolError, type Group, type Routine, type RoutineOccurrence } from "@openbot/protocol";
import type { Tx } from "@earendil-works/pi-durable";

export const ROUTINE_DESTINATION_BLOCKED = "Report destination changed. Edit the routine to confirm its group again.";

/** Group changes withdraw destination authority in the same transaction as membership changes. */
export async function invalidateRoutineDestinations(tx: Tx, group: Group): Promise<void> {
	const state = await tx.doc(RoutinesDoc);
	for (const r of Object.values(state.routines)) {
		if (r.deleted || r.reportTo?.groupId !== group.groupId || r.destinationBlocked) continue;
		if (group.status === "active" && group.revision === r.reportTo.groupRevision && group.memberIds.includes(r.botId)) continue;
		r.enabled = false;
		r.destinationBlocked = true;
		r.revision++;
		for (const o of Object.values(state.occurrences)) {
			if (o.routineId !== r.routineId || o.published || o.state === "skipped") continue;
			o.stopped = true;
			o.destinationBlocked = true;
			o.reason = ROUTINE_DESTINATION_BLOCKED;
		}
	}
}
export type RoutineState = {
	routines: Record<string, Routine>;
	occurrences: Record<string, RoutineOccurrence>;
	receipts: Record<string, { fingerprint: string; result: Routine | RoutineOccurrence }>;
	absenceDays: number;
	lastActiveAt: number;
	absencePaused: boolean;
};
type Stored<T> = T extends readonly (infer U)[] ? Stored<U>[] : T extends object ? { -readonly [K in keyof T]: Stored<T[K]> } : T;
export const RoutinesDoc = defineDoc<Stored<RoutineState>>({
	kind: "openbot.routines",
	version: 1,
	scope: "session",
	initial: () => ({ routines: {}, occurrences: {}, receipts: {}, absenceDays: 7, lastActiveAt: 0, absencePaused: false }),
});
export function routineStore(harness: Harness, context: Context) {
	return {
		async read(): Promise<RoutineState> {
			return (
				(await harness.snapshot(RoutinesDoc, context)) ?? {
					routines: {},
					occurrences: {},
					receipts: {},
					absenceDays: 7,
					lastActiveAt: 0,
					absencePaused: false,
				}
			);
		},
		async change<T>(fn: (state: RoutineState) => T, destination?: { botId: string; reportTo: NonNullable<Routine["reportTo"]> }): Promise<T> {
			return harness.commit(async (tx) => {
				if (destination) {
					const group = (await tx.doc(GroupsDoc)).groups[destination.reportTo.groupId];
					if (!group || group.status !== "active" || group.revision !== destination.reportTo.groupRevision || !group.memberIds.includes(destination.botId))
						throw new ProtocolError("invalid_request", ROUTINE_DESTINATION_BLOCKED);
				}
				const state = await tx.doc(RoutinesDoc);
				const previous = Object.values(state.occurrences);
				// Transaction draft proxies must never escape into Host responses.
				const value = fn(state);
				const result: T = value === undefined ? value : JSON.parse(JSON.stringify(value));
				const removed = previous.filter((o) => !state.occurrences[o.occurrenceId] && o.published && o.runId);
				if (removed.length) {
					const runs = await tx.doc(RunsDoc);
					for (const o of removed) {
						const run = runs.runs[o.runId!];
						if (run?.origin === "routine" && isTerminal(run.state)) delete runs.runs[run.runId];
					}
					await pruneUsage(tx, new Set(Object.keys(runs.runs)));
				}
				return result;
			}, context);
		},
	};
}
