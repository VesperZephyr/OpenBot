/** Generic, bounded report composition. Bot names and business workflows are user configuration. */
import { ProtocolError, type GroupPost, type Routine, type RoutineOccurrence, type RoutineInputSnapshot, type RoutineReportInputs } from "@openbot/protocol";

export const ROUTINE_INPUTS_BLOCKED = "Source routines changed. Edit this routine to confirm its report inputs again.";

type Routines = Readonly<Record<string, Routine>>;
export function validReportInputs(routines: Routines, reportTo: Routine["reportTo"], inputs: RoutineReportInputs, ownId?: string): boolean {
	return !!reportTo && inputs.sources.length >= 1 && inputs.sources.length <= 6 &&
		Number.isInteger(inputs.windowHours) && inputs.windowHours >= 1 && inputs.windowHours <= 72 &&
		Number.isInteger(inputs.waitMinutes) && inputs.waitMinutes >= 0 && inputs.waitMinutes <= 60 &&
		new Set(inputs.sources.map((s) => s.routineId)).size === inputs.sources.length &&
		inputs.sources.every((ref) => {
			const source = routines[ref.routineId];
			return !!source && source.routineId !== ownId && (source.executionRevision ?? source.revision) === ref.revision && source.enabled &&
				!source.deleted && !source.destinationBlocked && !source.inputsBlocked && !source.reportInputs &&
				source.reportTo?.groupId === reportTo.groupId && source.reportTo.groupRevision === reportTo.groupRevision;
		});
}
export function assertReportInputs(routines: Routines, reportTo: Routine["reportTo"], inputs: RoutineReportInputs, ownId?: string): void {
	if (!validReportInputs(routines, reportTo, inputs, ownId)) throw new ProtocolError("invalid_request", ROUTINE_INPUTS_BLOCKED);
}
function bounded(text: string): { text: string; truncated: boolean } {
	const bytes = Buffer.from(text);
	let end = Math.min(bytes.length, 8192);
	while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
	return { text: bytes.subarray(0, end).toString("utf8"), truncated: bytes.length > end };
}
/** Select by original scheduled time; publication time never makes an old report fresh. */
export function captureReportInputs(
	routines: Routines,
	occurrences: Readonly<Record<string, RoutineOccurrence>>,
	posts: readonly GroupPost[],
	o: RoutineOccurrence,
	now: number,
): RoutineInputSnapshot | undefined {
	const inputs = o.reportInputs!;
	const windowStart = o.scheduledAt - inputs.windowHours * 3600000;
	const eligible = (r: { scheduledAt: number; test: boolean }) =>
		r.scheduledAt > windowStart && r.scheduledAt <= o.scheduledAt && (o.test || !r.test);
	const entries: RoutineInputSnapshot["entries"][number][] = inputs.sources.map((ref) => {
		const source = routines[ref.routineId]!;
		const candidates = new Map<string, { occurrenceId: string; scheduledAt: number; test: boolean; state: RoutineOccurrence["state"]; at: number; post?: GroupPost }>();
		for (const record of Object.values(occurrences)) {
			if (record.routineId === ref.routineId && record.revision === ref.revision && eligible(record)) candidates.set(record.occurrenceId, {
				occurrenceId: record.occurrenceId, scheduledAt: record.scheduledAt, test: record.test, state: record.state, at: record.createdAt,
			});
		}
		for (const post of posts) {
			const report = post.routine;
			if (report?.routineId === ref.routineId && post.senderId === source.botId && (report.revision ?? occurrences[report.occurrenceId]?.revision) === ref.revision && eligible(report)) candidates.set(report.occurrenceId, {
				...report, at: post.at, post,
			});
		}
		const latest = [...candidates.values()].sort((a, b) => b.scheduledAt - a.scheduledAt || b.at - a.at || b.occurrenceId.localeCompare(a.occurrenceId))[0];
		const base = { routineId: ref.routineId, botId: source.botId, name: source.name };
		if (!latest) return { ...base, status: "missing" };
		const status = latest.state === "completed" ? latest.post ? "ready" : "pending" : latest.state === "running" ? "pending" : latest.state;
		return { ...base, status, occurrenceId: latest.occurrenceId, scheduledAt: latest.scheduledAt, test: latest.test,
			...(latest.post ? { postId: latest.post.postId, ...bounded(latest.post.text) } : {}),
		};
	});
	const deadline = Math.max(o.scheduledAt, o.createdAt) + inputs.waitMinutes * 60000;
	if (now < deadline && entries.some((e) => e.status === "missing" || e.status === "pending")) return;
	return { capturedAt: now, windowStart, windowEnd: o.scheduledAt, entries };
}
