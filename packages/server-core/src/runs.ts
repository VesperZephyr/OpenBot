/**
 * Runs and admission (Section 7.2). Pi runs every conversation with input at once; OpenBot caps how many Bots work at
 * the same time. A message becomes a Run: it starts at once while a slot is free, else it waits in OpenBot's queue and
 * starts, oldest first across Bots, when a Run ends. A message to a Bot whose Run is running steers that Run (Pi
 * `whenBusy: "steer"`); one to a Bot whose Run is queued joins it and is submitted when it starts.
 *
 * Every state change runs on one serial line, so admission never sees a half-applied step and active Runs never
 * exceed the cap.
 */
import { randomUUID } from "node:crypto";
import { type BotRuntime, isTerminal, type RunInput, type RunStore, type StoredRun } from "@openbot/agent-runtime";
import { type BotId, ProtocolError, type RunId, type RunRecord } from "@openbot/protocol";

/** Outcome reason the scheduler records for a queued steer it withdrew because its Run failed. */
const WITHDRAWN = "withdrawn";

export const DEFAULT_MAX_ACTIVE_RUNS = 3;

export type RunSchedulerOptions = {
	readonly runtime: BotRuntime;
	/** Most Runs that may be running at once, across all Bots. */
	readonly maxActiveRuns: number;
	/** Runs whenever a Bot's Runs changed, so its conversation can be republished. */
	readonly changed: (botId: BotId) => void;
	readonly now: () => number;
	/** Runs right before a running Run's conversation is aborted, so work it left in the background stops too. */
	readonly stopping?: (botId: BotId, channelId?: string, runId?: string) => void;
	readonly admissible?: (run: StoredRun) => Promise<boolean>;
};

export type SubmitOutcome = { readonly runId: RunId; readonly state: RunRecord["state"]; readonly steered: boolean };

type Mode = "start" | "steer";

export class RunScheduler {
	readonly #runtime: BotRuntime;
	readonly #store: RunStore;
	readonly #cap: number;
	readonly #changed: (botId: BotId) => void;
	readonly #now: () => number;
	readonly #stopping: (botId: BotId, channelId?: string, runId?: string) => void;
	readonly #admissible: (run: StoredRun) => Promise<boolean>;
	/** Current Runs by ID: every non-terminal Run, and terminal ones looked up since start. */
	readonly #runs = new Map<RunId, StoredRun>();
	/** Running Runs the user asked to stop; new messages to their Bot start a new Run instead of steering. */
	readonly #cancelling = new Set<RunId>();
	readonly #ended = new Map<RunId, PromiseWithResolvers<RunRecord["state"]>>();
	/** Pi submissions with an attached observer, so a resubmission or a second sweep never observes one twice. */
	readonly #observed = new Set<string>();
	/** Each Bot's newest Run written since start, terminal ones included. */
	readonly #latest = new Map<BotId, StoredRun>();
	#line: Promise<unknown> = Promise.resolve();
	#stopped = false;

	constructor(options: RunSchedulerOptions) {
		this.#runtime = options.runtime;
		this.#store = options.runtime.runsStore();
		if (!Number.isInteger(options.maxActiveRuns) || options.maxActiveRuns < 1) {
			throw new Error(`The active-Run cap must be a positive integer, got ${options.maxActiveRuns}`);
		}
		this.#cap = options.maxActiveRuns;
		this.#changed = options.changed;
		this.#now = options.now;
		this.#stopping = options.stopping ?? (() => {});
		this.#admissible = options.admissible ?? (async () => true);
	}

	/**
	 * Startup sweep: resubmit inputs a crash left without a Pi submission (Pi deduplicates by request ID), observe every
	 * running Run's submissions again (settled ones finalize at once), then fill free slots from the queue.
	 */
	start(): Promise<void> {
		return this.#serial(async () => {
			for (const run of await this.#store.list()) {
				if (isTerminal(run.state)) continue;
				this.#runs.set(run.runId, run);
				const latest = this.#latest.get(run.botId);
				if (latest === undefined || latest.createdAt <= run.createdAt) this.#latest.set(run.botId, run);
				if (!(await this.#admissible(run))) {
					if (run.state === "running") {
						this.#stopping(run.botId, run.channelId, run.runId);
						await this.#runtime.cancel(run.botId, run.channelId, true);
					}
					await this.#put({ ...run, state: "cancelled", endedAt: this.#now() });
				} else if (run.state === "running") await this.#submitInputs(run);
			}
			await this.#admit();
		});
	}

	/** Stop observing; Pi keeps the work, and the next start picks it up. */
	stop(): void {
		this.#stopped = true;
	}

	/** The Bot's latest non-terminal Run. */
	active(botId: BotId, channelId = "direct"): StoredRun | undefined {
		return [...this.#runs.values()].findLast(
			(run) => run.botId === botId && (run.channelId ?? "direct") === channelId && !isTerminal(run.state),
		);
	}

	/** The Bot's newest Run since start, including one that already ended. */
	latest(botId: BotId): RunRecord | undefined {
		const run = this.#latest.get(botId);
		if (run === undefined) return undefined;
		const { messages: _messages, inputs: _inputs, ...record } = run;
		return record;
	}

	submit(
		botId: BotId,
		requestId: string,
		text: string,
		options: { channelId?: string; origin?: "user" | "peer"; separate?: boolean } = {},
	): Promise<SubmitOutcome> {
		const channelId = options.channelId ?? "direct";
		return this.#serial(async () => {
			const existing = await this.#byRequest(botId, requestId);
			if (existing !== undefined) {
				const message = existing.messages.find((candidate) => candidate.requestId === requestId);
				if (
					message?.text !== text ||
					(existing.channelId ?? "direct") !== channelId ||
					(existing.origin ?? "user") !== (options.origin ?? "user")
				) {
					throw new ProtocolError("request_conflict", "This request ID was already used for another message");
				}
				return { runId: existing.runId, state: existing.state, steered: existing.messages[0]?.requestId !== requestId };
			}
			const current = options.separate ? undefined : this.active(botId, channelId);
			if (current?.state === "queued") {
				const joined = { ...current, requestIds: [...current.requestIds, requestId], messages: [...current.messages, { requestId, text }] };
				await this.#put(joined);
				return { runId: joined.runId, state: joined.state, steered: true };
			}
			if (current?.state === "running" && !this.#cancelling.has(current.runId)) {
				// Recorded before Pi admits it, so a crash in between resubmits it on start.
				const steered = {
					...current,
					requestIds: [...current.requestIds, requestId],
					messages: [...current.messages, { requestId, text }],
					inputs: [...current.inputs, { requestId, text }],
				};
				await this.#put(steered);
				await this.#submitInputs(steered);
				return { runId: steered.runId, state: "running", steered: true };
			}
			const run: StoredRun = {
				origin: options.origin ?? "user",
				...(channelId === "direct" ? {} : { channelId }),
				runId: `run_${randomUUID()}`,
				botId,
				state: "queued",
				requestIds: [requestId],
				createdAt: this.#now(),
				messages: [{ requestId, text }],
				inputs: [],
			};
			await this.#put(run);
			await this.#admit();
			return { runId: run.runId, state: this.#runs.get(run.runId)?.state ?? run.state, steered: false };
		});
	}

	/**
	 * Cancel a queued or running Run and resolve with its final state. A running Run is cancelled by aborting its Bot's
	 * conversation; it ends once Pi settled its inputs. A terminal Run is returned unchanged.
	 */
	async cancel(runId: RunId): Promise<RunRecord["state"]> {
		const target = await this.#serial(async () => {
			const run = this.#runs.get(runId) ?? (await this.#store.get(runId));
			if (run === undefined) throw new ProtocolError("not_found", `Unknown Run: ${runId}`);
			if (run.state === "queued") {
				await this.#put({ ...run, state: "cancelled", endedAt: this.#now() });
				return { state: "cancelled" as const };
			}
			if (run.state !== "running") return { state: run.state };
			this.#cancelling.add(runId);
			return { abort: run.botId, channelId: run.channelId, ended: this.#endedOf(runId).promise };
		});
		if ("state" in target) return target.state;
		// Outside the line: the abort waits for Pi to settle the inputs, whose handling needs the line.
		this.#stopping(target.abort, target.channelId, runId);
		await this.#runtime.cancel(target.abort, target.channelId);
		return target.ended;
	}

	async cancelMatching(matches: (run: StoredRun) => boolean): Promise<void> {
		const running = await this.#serial(async () => {
			const runs = [...this.#runs.values()].filter(matches);
			for (const run of runs) if (run.state === "queued") await this.#put({ ...run, state: "cancelled", endedAt: this.#now() });
			return runs.filter((run) => run.state === "running").map((run) => run.runId);
		});
		await Promise.all(running.map((id) => this.cancel(id)));
	}

	/** Find a Run of this Bot that already holds the request. */
	async #byRequest(botId: BotId, requestId: string): Promise<StoredRun | undefined> {
		const holds = (run: StoredRun): boolean => run.botId === botId && run.requestIds.includes(requestId);
		const current = [...this.#runs.values()].find(holds);
		if (current !== undefined) return current;
		const stored = (await this.#store.list()).find(holds);
		if (stored !== undefined) this.#runs.set(stored.runId, stored);
		return stored;
	}

	/**
	 * Start queued Runs, oldest first across Bots, while slots are free. A Bot whose previous Run is still running (being
	 * stopped) keeps its queued Run waiting: Pi would withdraw a message submitted while the abort is in progress.
	 */
	async #admit(): Promise<void> {
		for (;;) {
			const runs = [...this.#runs.values()];
			const running = runs.filter((run) => run.state === "running");
			if (running.length >= this.#cap) return;
			const busy = new Set(running.map((run) => run.botId));
			const next = runs
				.filter((run) => run.state === "queued" && !busy.has(run.botId))
				.sort((a, b) => {
					const tier = (r: StoredRun) => (!r.channelId || r.channelId === "direct" || this.#now() - r.createdAt >= 30_000 ? 0 : 1);
					return tier(a) - tier(b) || a.createdAt - b.createdAt;
				})[0];
			if (next === undefined) return;
			if (!(await this.#admissible(next))) {
				await this.#put({ ...next, state: "cancelled", endedAt: this.#now() });
				continue;
			}
			// Messages that joined while queued start the Pi run together, so the model reads them in one turn. The first
			// request ID is the Pi request ID.
			const started: StoredRun = {
				...next,
				state: "running",
				startedAt: this.#now(),
				inputs: [{ requestId: next.requestIds[0]!, text: next.messages.map((message) => message.text).join("\n\n") }],
			};
			// Written before Pi admits the first input, so a crash in between resubmits it on start.
			await this.#put(started);
			await this.#submitInputs(started);
		}
	}

	/**
	 * Admit every input of a running Run that has no Pi submission yet, record its submission ID, and observe every
	 * unsettled one. The first input starts the Pi run, later ones steer it.
	 */
	async #submitInputs(run: StoredRun): Promise<void> {
		let current = run;
		for (const [index, input] of run.inputs.entries()) {
			if (input.submissionId !== undefined) continue;
			const mode: Mode = index === 0 ? "start" : "steer";
			const { submissionId } = await this.#runtime.submit(run.botId, input.requestId, input.text, mode, run.channelId);
			current = withInput(current, input.requestId, { submissionId });
			await this.#put(current);
		}
		for (const input of current.inputs) {
			if (input.outcome !== undefined || input.submissionId === undefined) continue;
			this.#observe(current.runId, input.requestId, input.submissionId, current.botId, current.channelId);
		}
		await this.#finishIfSettled(current.runId);
	}

	#observe(runId: RunId, requestId: string, submissionId: string, botId: BotId, channelId?: string): void {
		if (this.#observed.has(submissionId)) return;
		this.#observed.add(submissionId);
		this.#runtime.waitSubmission(botId, submissionId, channelId).then(
			(outcome) => void this.#serial(() => this.#settled(runId, requestId, outcome)).catch(() => {}),
			// The runtime closed with the Host; the next start observes the submission again.
			() => {},
		);
	}

	async #settled(runId: RunId, requestId: string, outcome: NonNullable<RunInput["outcome"]>): Promise<void> {
		if (this.#stopped) return;
		const run = this.#runs.get(runId);
		if (run === undefined || run.state !== "running") return;
		// An input this scheduler withdrew already carries its outcome; Pi's `aborted` settlement for it changes nothing.
		if (run.inputs.find((input) => input.requestId === requestId)?.outcome !== undefined) return;
		let updated = withInput(run, requestId, { outcome });
		// Pi keeps a failed run's queued steers until the next input; this Run is over, so withdraw them. Each is
		// recorded as withdrawn first, so the failure stays the Run's outcome instead of reading as a user stop.
		if (outcome.status === "unanswered" && outcome.reason !== "aborted") {
			const pending = updated.inputs.filter((input) => input.outcome === undefined && input.submissionId !== undefined);
			for (const input of pending) {
				updated = withInput(updated, input.requestId, { outcome: { status: "unanswered", reason: WITHDRAWN } });
			}
			await this.#put(updated);
			for (const input of pending) await this.#runtime.withdraw(updated.botId, input.submissionId!, updated.channelId);
		} else {
			await this.#put(updated);
		}
		await this.#finishIfSettled(runId);
	}

	/** End a running Run once Pi settled all its inputs, then admit the next queued Run. */
	async #finishIfSettled(runId: RunId): Promise<void> {
		const run = this.#runs.get(runId);
		if (run === undefined || run.state !== "running") return;
		const outcomes = run.inputs.map((input) => input.outcome);
		if (outcomes.some((outcome) => outcome === undefined)) return;
		// A stop wins over the error the abort surfaced; a Run whose answer landed before the stop stays completed.
		const failure = outcomes.find((outcome) => outcome?.status === "unanswered");
		const cancelled = outcomes.some((outcome) => outcome?.reason === "aborted") || (this.#cancelling.has(runId) && failure !== undefined);
		const ended: StoredRun = cancelled
			? { ...run, state: "cancelled", endedAt: this.#now() }
			: failure !== undefined
				? { ...run, state: "failed", endedAt: this.#now(), error: failure.reason ?? "unanswered" }
				: { ...run, state: "completed", endedAt: this.#now() };
		await this.#put(ended);
		if (ended.state === "cancelled") await this.#runtime.markStopped(run.botId, run.channelId);
		this.#cancelling.delete(runId);
		this.#endedOf(runId).resolve(ended.state);
		this.#ended.delete(runId);
		await this.#admit();
	}

	#endedOf(runId: RunId): PromiseWithResolvers<RunRecord["state"]> {
		let ended = this.#ended.get(runId);
		if (ended === undefined) {
			ended = Promise.withResolvers<RunRecord["state"]>();
			this.#ended.set(runId, ended);
		}
		return ended;
	}

	async #put(run: StoredRun): Promise<void> {
		await this.#store.put(run);
		if (isTerminal(run.state)) this.#runs.delete(run.runId);
		else this.#runs.set(run.runId, run);
		const latest = this.#latest.get(run.botId);
		if (latest === undefined || latest.runId === run.runId || latest.createdAt <= run.createdAt) this.#latest.set(run.botId, run);
		this.#changed(run.botId);
	}

	#serial<T>(step: () => Promise<T>): Promise<T> {
		const result = this.#line.then(step);
		this.#line = result.catch(() => {});
		return result;
	}
}

function withInput(run: StoredRun, requestId: string, change: Partial<RunInput>): StoredRun {
	return { ...run, inputs: run.inputs.map((input) => (input.requestId === requestId ? { ...input, ...change } : input)) };
}
