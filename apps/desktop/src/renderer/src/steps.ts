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

export function transcriptRows(items: readonly TranscriptItem[], awaitingApproval: ReadonlySet<string>): TranscriptRow[] {
	const rows: TranscriptRow[] = [];
	let run: ToolItem[] = [];
	const flush = (): void => {
		if (run.length >= 2) rows.push({ kind: "steps", id: run[0]!.id, items: run });
		else for (const item of run) rows.push({ kind: "item", item });
		run = [];
	};
	for (const item of items) {
		if (item.kind === "tool" && item.status === "succeeded" && !awaitingApproval.has(item.id)) {
			run.push(item);
			continue;
		}
		flush();
		rows.push({ kind: "item", item });
	}
	flush();
	return rows;
}
