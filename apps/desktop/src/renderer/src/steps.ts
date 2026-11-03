/**
 * Transcript rows as shown: runs of two or more consecutive successful tool calls fold into one "Ran N steps" row.
 * Anything the user may need to act on or check (a failed, interrupted, cancelled, running call, or one waiting for
 * approval) always stays its own row and ends the run.
 */
import type { TranscriptItem } from "@openbot/protocol";

type ToolItem = Extract<TranscriptItem, { kind: "tool" }>;

export type TranscriptRow =
	| { readonly kind: "item"; readonly item: TranscriptItem }
	/** `id` is the first call's ID, so the row keeps its identity (and its open state) while the run grows. */
	| { readonly kind: "steps"; readonly id: string; readonly items: readonly ToolItem[] };

export type StepSummary = {
	readonly pages: number;
	readonly files: number;
	readonly commands: number;
	readonly searches: number;
	readonly other: number;
	readonly failed: number;
};

/** Counts for the collapsed execution line. Failed calls are counted separately so the line can name them. */
export function summarizeSteps(items: readonly ToolItem[]): StepSummary {
	const summary = { pages: 0, files: 0, commands: 0, searches: 0, other: 0, failed: 0 };
	for (const item of items) {
		if (item.status === "failed" || item.status === "interrupted" || item.status === "cancelled") {
			summary.failed++;
			continue;
		}
		if (item.status !== "succeeded") continue;
		if (item.tool === "local_read" || item.tool === "web_fetch") summary.pages++;
		else if (item.tool === "local_write" || item.tool === "local_edit") summary.files++;
		else if (item.tool === "local_exec") summary.commands++;
		else if (item.tool === "web_search") summary.searches++;
		else summary.other++;
	}
	return summary;
}

/** Seconds between two transcript timestamps already on surrounding messages. Absent when either side has none. */
export function elapsedSeconds(start: number | undefined, end: number | undefined): number | undefined {
	if (start === undefined || end === undefined || end < start) return undefined;
	return Math.round((end - start) / 1000);
}

export function formatStepSummary(
	summary: StepSummary,
	seconds: number | undefined,
	translate: (message: string, values?: Readonly<Record<string, string | number>>) => string,
): string {
	const count = (amount: number, one: string, many: string) => translate(amount === 1 ? one : many, { count: amount });
	const parts: string[] = [];
	if (summary.pages) parts.push(count(summary.pages, "read {count} page", "read {count} pages"));
	if (summary.files) parts.push(count(summary.files, "wrote {count} file", "wrote {count} files"));
	if (summary.commands) parts.push(count(summary.commands, "ran {count} command", "ran {count} commands"));
	if (summary.searches) parts.push(translate("searched {count}", { count: summary.searches }));
	if (summary.other) parts.push(translate("ran {count} steps", { count: summary.other }));
	if (summary.failed) parts.push(translate("{count} failed", { count: summary.failed }));
	if (seconds !== undefined) parts.push(translate("{count} s", { count: seconds }));
	const total = summary.pages + summary.files + summary.commands + summary.searches + summary.other;
	return parts.join(" · ") || translate("ran {count} steps", { count: total });
}

export function transcriptRows(items: readonly TranscriptItem[], awaitingApproval: ReadonlySet<string>): TranscriptRow[] {
	const rows: TranscriptRow[] = [];
	let run: ToolItem[] = [];
	const flush = (): void => {
		if (run.length >= 2) rows.push({ kind: "steps", id: run[0]!.id, items: run });
		else for (const item of run) rows.push({ kind: "item", item });
		run = [];
	};
	for (const item of items) {
		if (item.kind === "tool" && item.status === "succeeded" && !item.artifact && !item.routineProposal && !item.taskId && !awaitingApproval.has(item.id)) {
			run.push(item);
			continue;
		}
		flush();
		rows.push({ kind: "item", item });
	}
	flush();
	return rows;
}
