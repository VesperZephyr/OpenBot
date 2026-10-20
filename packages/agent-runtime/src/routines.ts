import { RunsDoc, isTerminal } from "./runs.ts";
import { pruneUsage } from "./usage.ts";
import { defineDoc, type Harness } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord/context";
import type { Routine, RoutineOccurrence } from "@openbot/protocol";
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
		async change<T>(fn: (state: RoutineState) => T): Promise<T> {
			return harness.commit(async (tx) => {
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
