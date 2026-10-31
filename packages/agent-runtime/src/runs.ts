import { BackgroundDoc, backgroundTerminal } from "./background.ts";
import { recordOutcomes } from "./message-records.ts";
/**
 * Durable Run records (Section 7.2), stored as a session document next to Pi's own state so a Run and the Pi
 * submissions it maps to survive a restart together. Scheduling lives in `server-core`; this module only stores.
 */
import { captureUsage, pruneUsage, type UsageCapture } from "./usage.ts";
import type { Context } from "@earendil-works/chord/context";
import { defineDoc, type Harness } from "@earendil-works/pi-durable";
import type { BotId, RunRecord } from "@openbot/protocol";

/** Direct-chat terminal Runs kept per Bot. Group Runs retain identities for durable delivery replay. */
export const KEPT_TERMINAL_RUNS = 50;

/** One message of a Run as the user sent it; the text is kept to detect a reused request ID with other content. */
export type RunMessage = {
	/** Original explicit input for replay; resolved skills may also contain role defaults. */
	readonly requestedSkills?: readonly import("@openbot/protocol").SkillRef[];
	readonly roleSkills?: readonly import("@openbot/protocol").SkillRef[];
	readonly requestId: string;
	readonly text: string;
	readonly attachments?: readonly import("@openbot/protocol").ArtifactRef[];
 readonly skills?:readonly import("@openbot/protocol").SkillAttachment[];
};

/**
 * One Pi input of a running Run: the first starts the Run, later ones steer it. `requestId` is also the Pi request ID,
 * so resubmitting an input after a crash returns the submission Pi already admitted. `submissionId` is recorded after
 * Pi admitted the input; `outcome` once Pi settled it.
 */
export type RunInput = {
	readonly requestId: string;
	readonly text: string;
	readonly attachments?: readonly import("@openbot/protocol").ArtifactRef[];
 readonly skills?:readonly import("@openbot/protocol").SkillAttachment[];
	readonly submissionId?: string;
	readonly outcome?: { readonly status: "done" | "unanswered"; readonly reason?: string };
};

export type StoredRun = RunRecord & {
	readonly messageMode?: "messages-v1";
	readonly origin?: "user" | "peer" | "background" | "routine";
	readonly messages: readonly RunMessage[];
	readonly inputs: readonly RunInput[];
};

/** The stored form: Pi documents take mutable JSON, so read-only arrays become plain ones. */
type Stored<T> = T extends readonly (infer U)[] ? Stored<U>[] : T extends object ? { -readonly [K in keyof T]: Stored<T[K]> } : T;

export const RunsDoc = defineDoc<{ runs: Record<string, Stored<StoredRun>> }>({
	kind: "openbot.runs",
	version: 1,
	scope: "session",
	initial: () => ({ runs: {} }),
});

export interface RunStore {
	get(runId: string): Promise<StoredRun | undefined>;
	/** Write one Run in one Pi commit; a terminal Run prunes its Bot's oldest terminal Runs beyond the kept count. */
	put(run: StoredRun): Promise<void>;
	/** Every stored Run, oldest first. */
	list(): Promise<StoredRun[]>;
}

const TERMINAL: Record<RunRecord["state"], boolean> = {
	needs_attention:true,
 queued: false,
	running: false,
	completed: true,
	failed: true,
	cancelled: true,
};

/** Completed, failed, and cancelled Runs never change again. */
export const isTerminal = (state: RunRecord["state"]): boolean => TERMINAL[state];

export function runStore(harness: Harness, context: Context, capture?: (run: StoredRun) => Promise<UsageCapture | undefined>): RunStore {
	return {
		async get(runId) {
			return (await harness.snapshot(RunsDoc, context))?.runs[runId];
		},
		async put(run) {
			// Drafts accept only strict JSON: drop undefined optional fields.
			const value = JSON.parse(JSON.stringify(run)) as Stored<StoredRun>;
			const usage = await capture?.(run);
			await harness.commit(async (tx) => {
				const doc = await tx.doc(RunsDoc);
				const previous = doc.runs[run.runId];
				if (previous?.messageMode || ((!previous && run.state === "queued" || previous?.state === "queued" && run.state === "running") && run.origin !== "routine")) value.messageMode = "messages-v1";
				await captureUsage(tx, run, doc.runs[run.runId], usage);
				await recordOutcomes(tx, value, previous);
				doc.runs[run.runId] = value;
				if (isTerminal(run.state)) {
					const pending = Object.values((await tx.doc(BackgroundDoc)).records).filter(record => !backgroundTerminal(record));
					prune(doc.runs, run.botId, new Set(pending.flatMap(record => [record.sourceRunId,...(record.continuationRunId ? [record.continuationRunId] : [])])));
					await pruneUsage(tx, new Set(Object.keys(doc.runs)));
				}
			}, context);
		},
		async list() {
			const runs = Object.values((await harness.snapshot(RunsDoc, context))?.runs ?? {});
			return runs.toSorted((a, b) => a.createdAt - b.createdAt);
		},
	};
}

function prune(runs: Record<string, Stored<StoredRun>>, botId: BotId, pinned: ReadonlySet<string>): void {
	const ended = Object.values(runs)
		.filter((run) => run.botId === botId && !run.channelId && isTerminal(run.state) && (run.state !== "needs_attention" || run.interruption?.settledAt !== undefined))
		.sort((a, b) => b.createdAt - a.createdAt);
	for (const run of ended.slice(KEPT_TERMINAL_RUNS)) if (!pinned.has(run.runId)) delete runs[run.runId];
}
