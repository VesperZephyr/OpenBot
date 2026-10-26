import { RunsDoc, isTerminal } from "./runs.ts";
import { assertReportInputs, captureReportInputs, validReportInputs, ROUTINE_INPUTS_BLOCKED } from "./routine-inputs.ts";
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
		if (group.status === "active" && (group.deliveryRevision ?? group.revision) === r.reportTo.groupRevision && group.memberIds.includes(r.botId)) continue;
		r.enabled = false;
		r.destinationBlocked = true;
		r.executionRevision = (r.executionRevision ?? r.revision) + 1;
		r.revision++;
		for (const o of Object.values(state.occurrences)) {
			if (o.routineId !== r.routineId || o.published || o.state === "skipped") continue;
			o.stopped = true;
			o.destinationBlocked = true;
			o.reason = ROUTINE_DESTINATION_BLOCKED;
		}
	}
}
/** Source edits withdraw dependent execution/publication authority before the transaction commits. */
function invalidateReportInputs(state: Stored<RoutineState>): void {
	for (const r of Object.values(state.routines)) {
		if (!r.reportInputs || r.deleted || r.inputsBlocked || r.destinationBlocked || validReportInputs(state.routines, r.reportTo, r.reportInputs, r.routineId)) continue;
		r.enabled = false;
		r.inputsBlocked = true;
		r.executionRevision = (r.executionRevision ?? r.revision) + 1;
		r.revision++;
		for (const o of Object.values(state.occurrences)) {
			if (o.routineId !== r.routineId || o.published || o.state === "skipped") continue;
			o.stopped = true;
			o.inputsBlocked = true;
			o.reason = ROUTINE_INPUTS_BLOCKED;
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
		async captureInputs(occurrenceId: string, now: number): Promise<RoutineOccurrence | undefined> {
			return harness.commit(async (tx) => {
				const state = await tx.doc(RoutinesDoc);
				invalidateReportInputs(state);
				const o = state.occurrences[occurrenceId];
				if (!o) return;
				const r = state.routines[o.routineId];
				if (o.reportInputs && !o.inputSnapshot && !o.stopped && r && (r.executionRevision ?? r.revision) === o.revision && !r.deleted) {
					const group = (await tx.doc(GroupsDoc));
					const destination = o.reportTo && group.groups[o.reportTo.groupId];
					if (destination?.status === "active" && (destination.deliveryRevision ?? destination.revision) === o.reportTo?.groupRevision && destination.memberIds.includes(o.botId)) {
						const snapshot = captureReportInputs(state.routines, state.occurrences, group.posts[destination.groupId] ?? [], o, now);
						if (snapshot) o.inputSnapshot = JSON.parse(JSON.stringify(snapshot));
					}
				}
				return JSON.parse(JSON.stringify(o));
			}, context);
		},
		async change<T>(fn: (state: RoutineState) => T, destination?: { botId: string; reportTo: NonNullable<Routine["reportTo"]>; reportInputs?: NonNullable<Routine["reportInputs"]>; routineId?: string }): Promise<T> {
			return harness.commit(async (tx) => {
				if (destination) {
					const group = (await tx.doc(GroupsDoc)).groups[destination.reportTo.groupId];
					if (!group || group.status !== "active" || (group.deliveryRevision ?? group.revision) !== destination.reportTo.groupRevision || !group.memberIds.includes(destination.botId))
						throw new ProtocolError("invalid_request", ROUTINE_DESTINATION_BLOCKED);
				}
				const state = await tx.doc(RoutinesDoc);
				if (destination?.reportInputs) assertReportInputs(state.routines, destination.reportTo, destination.reportInputs, destination.routineId);
				const previous = Object.values(state.occurrences);
				// Transaction draft proxies must never escape into Host responses.
				const value = fn(state);
				invalidateReportInputs(state);
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
