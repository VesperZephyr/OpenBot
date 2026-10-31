import { composeRoleSkills } from "./role-skills.ts";
import type { ArtifactRef, ArtifactContent } from "@openbot/protocol";
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
 readonly resolveSkills?:(refs:readonly import("@openbot/protocol").SkillRef[])=>Promise<readonly import("@openbot/protocol").SkillAttachment[]>;
	readonly resolveAttachments?: (botId: string, ids: readonly string[]) => Promise<readonly ArtifactRef[]>;
	readonly hydrateAttachments?: (botId: string, refs: readonly ArtifactRef[]) => Promise<readonly ArtifactContent[]>;
	readonly canAdmit?: () => boolean;
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
	readonly #resolveAttachments: NonNullable<RunSchedulerOptions["resolveAttachments"]>;
	readonly #hydrateAttachments: NonNullable<RunSchedulerOptions["hydrateAttachments"]>;
	readonly #runtime: BotRuntime;
 readonly #resolveSkills:NonNullable<RunSchedulerOptions["resolveSkills"]>;
	readonly #canAdmit: () => boolean;
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
	readonly #latestDirect = new Map<BotId, StoredRun>();
	readonly #latestChannel = new Map<string, StoredRun>();
	#line: Promise<unknown> = Promise.resolve();
	#stopped = false;

	constructor(options: RunSchedulerOptions) {
		this.#runtime = options.runtime;
 this.#resolveSkills=options.resolveSkills??(async refs=>{if(refs.length)throw new Error("Skill library unavailable");return [];});
		this.#resolveAttachments = options.resolveAttachments ?? (async () => []);
		this.#hydrateAttachments = options.hydrateAttachments ?? (async () => []);
		this.#canAdmit = options.canAdmit ?? (() => true);
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
				if (!isTerminal(run.state) || (run.state === "needs_attention" && !run.interruption?.settledAt)) this.#runs.set(run.runId, run);
				this.#rememberChannel(run);
				if ((run.channelId ?? "direct") === "direct" && (this.#latestDirect.get(run.botId)?.createdAt ?? -Infinity) <= run.createdAt)
					this.#latestDirect.set(run.botId, run);
				const latest = this.#latest.get(run.botId);
				if (!latest || latest.createdAt <= run.createdAt) this.#latest.set(run.botId, run);
				if (isTerminal(run.state)) continue;

				if (this.#canAdmit()) await this.#recover(run);
			}
			await this.#admit();
		});
	}

	async #recover(run: StoredRun): Promise<void> {
		if (!this.#canAdmit()) return;
		const admissible = await this.#admissible(run);
		if (!this.#canAdmit()) return;
		if (!admissible) {
			if (run.state === "running") {
				this.#stopping(run.botId, run.channelId, run.runId);
				await this.#runtime.cancel(run.botId, run.channelId, true);
			}
			await this.#put({ ...run, state: "cancelled", endedAt: this.#now() });
		} else if (run.state === "running") await this.#submitInputs(run);
	}

	hasWork(): boolean {
		return [...this.#runs.values()].some((run) => !isTerminal(run.state));
	}
	resume(): Promise<void> {
		return this.#serial(async () => {
			if (!this.#canAdmit()) return;
			for (const run of this.#runs.values()) if (!isTerminal(run.state)) await this.#recover(run);
			await this.#admit();
		});
	}
	async interruptAll(reason: import("@openbot/protocol").LifecycleReason, quiesce: () => Promise<void> = async () => {}): Promise<void> {
		try {
			await this.#serial(async () => {
				for (const run of this.#runs.values()) {
					if (run.state !== "running" || run.interruption) continue;
					// Read committed submission status without a wait that could restart Pi scheduling.
					const answered =
						run.inputs.length > 0 &&
						(
							await Promise.all(
								run.inputs.map((input) =>
									input.submissionId ? this.#runtime.submissionState(run.botId, input.submissionId, run.channelId) : "absent",
								),
							)
						).every((state) => state === "done");
					if (answered) {
						await this.#put({
							...run,
							state: "completed",
							endedAt: this.#now(),
							inputs: run.inputs.map((input) => ({ ...input, outcome: { status: "done" as const } })),
						});
						this.#ended.get(run.runId)?.resolve("completed");
						this.#ended.delete(run.runId);
					} else await this.#put({ ...run, interruption: { reason, requestedAt: this.#now() } });
				}
			});
			await this.#runtime.interruptAll();
		} catch (error) {
			await quiesce().catch(() => {});
			throw error;
		}
		await quiesce();
		await this.#serial(async () => {
			for (const run of this.#runs.values())
				if ((run.state === "running" || run.state === "needs_attention") && run.interruption) {
					const ended: StoredRun = {
						...run,
						state: "needs_attention",

						endedAt: this.#now(),
						interruption: { ...run.interruption, settledAt: this.#now() },
						error: "Work was interrupted. Review completed actions before continuing.",
					};
					await this.#put(ended);
					this.#ended.get(run.runId)?.resolve(ended.state);
					this.#ended.delete(run.runId);
				}
		});
	}
 async interruptSelected(ids:readonly string[],quiesce:()=>Promise<void>):Promise<void>{
  const selected=await this.#serial(async()=>{
   const selected:StoredRun[]=[];
   for(const id of ids){const run=this.#runs.get(id)??await this.#store.get(id);if(!run||!(["running","needs_attention"].includes(run.state)))continue;
    const changed={...run,interruption:{reason:"permission_revoked" as const,requestedAt:run.interruption?.requestedAt??this.#now()}};await this.#put(changed);selected.push(changed);
   }return selected;
  });
  try{await this.#runtime.interruptChannels(selected.map(run=>({botId:run.botId,...(run.channelId?{channelId:run.channelId}:{})})));}catch(error){await quiesce().catch(()=>{});throw error;}
  await quiesce();
  await this.#serial(async()=>{
   for(const run of selected){const current=this.#runs.get(run.runId)??run;if(current.state==="completed")continue;
    const ended:StoredRun={...current,state:"needs_attention",endedAt:this.#now(),interruption:{reason:"permission_revoked",requestedAt:run.interruption!.requestedAt,settledAt:this.#now()},error:"Permission was revoked. Review completed actions before continuing."};
    await this.#put(ended);this.#ended.get(run.runId)?.resolve(ended.state);this.#ended.delete(run.runId);
   }
  });
 }

	#rememberChannel(run: StoredRun): void {
  if(run.origin==="routine")return;
		const key = JSON.stringify([run.botId, run.channelId ?? "direct"]),
			previous = this.#latestChannel.get(key);
		if (!previous || previous.runId === run.runId || previous.createdAt <= run.createdAt) this.#latestChannel.set(key, run);
	}
	attention(botId: string, channelId = "direct"): StoredRun | undefined {
		const latest = this.#latestChannel.get(JSON.stringify([botId, channelId]));
		return latest?.state === "needs_attention" ? latest : undefined;
	}

	async continue(runId: string, requestId: string): Promise<SubmitOutcome> {
		if (!this.#canAdmit()) throw new ProtocolError("invalid_request", "Work is paused. Resume work before continuing.");
		const run = await this.#store.get(runId);
		if (!run || run.state !== "needs_attention" || !run.interruption?.settledAt || run.channelId)
			throw new ProtocolError("invalid_request", "Only an interrupted private task can be continued.");
		const bot = await this.#runtime.getBot(run.botId);
		if (!bot || bot.status === "deleted") throw new ProtocolError("invalid_request", "This Bot no longer exists");
		const text =
			`Continue the interrupted task using the saved conversation history. Inspect completed actions and reconcile uncertain effects before repeating any operation; ask the user if an effect cannot be verified. Original request excerpt (consult the conversation for the full request):\n` +
			run.messages
				.map((message) => message.text)
				.join("\n\n")
				.slice(0, 24000);
		return this.#serial(async () => {
			if (!this.#canAdmit()) throw new ProtocolError("invalid_request", "Work is paused. Resume work before continuing.");
			const key = `continuation:${run.runId}:${requestId}`;
			const existing = await this.#byRequest(run.botId, key);
			if (existing) return { runId: existing.runId, state: existing.state, steered: false };
			// Carry immutable per-message references, including inputs interrupted before Pi admission.
			// A separate Run preserves usage boundaries and never steers unrelated active work.
			const messages = run.messages.some(message => message.attachments?.length || message.skills?.length)
				? run.messages.map((message, index) => ({
					...message, requestId: index === 0 ? key : `${key}:input:${index}`,
					text: index === 0 ? `${text}\n\n${message.text}` : message.text,
				}))
				: [{ requestId: key, text }];
			const next: StoredRun = {
				runId: `run_${randomUUID()}`, botId: run.botId, origin: "user", state: "queued",
				requestIds: messages.map(message => message.requestId), createdAt: this.#now(), messages, inputs: [],
			};
			await this.#put(next);
			await this.#admit();
			return { runId: next.runId, state: this.#runs.get(next.runId)?.state ?? next.state, steered: false };
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

	isRunning(runId: string): boolean { return this.#runs.get(runId)?.state === "running"; }

	/** The Bot's newest Run since start, including one that already ended. */
	latest(botId: BotId): RunRecord | undefined {
		const run = this.#latest.get(botId);
		if (run === undefined) return undefined;
		const { messages: _messages, inputs: _inputs, ...record } = run;
		return record;
	}

	retry(botId: BotId): import("@openbot/protocol").ConversationSnapshot["retry"] {
		const run = this.#latestDirect.get(botId),
			input = run?.inputs.findLast(input => input.outcome?.status === "unanswered" && input.outcome.reason !== WITHDRAWN && input.outcome.reason !== "aborted");
		if (run?.state !== "failed" || (run.origin && run.origin !== "user") || !input) return undefined;
		return {
			...(run.messageMode && input.submissionId ? { outcomeId: `outcome:${input.submissionId}` } : {}),
			text: input.text,
			...(input.attachments?.length ? { artifactIds: input.attachments.map((a) => a.artifactId) } : {}),
			...(input.skills?.length ? { skills: input.skills.map(({ name, revision, sha256 }) => ({ name, revision, sha256 })) } : {}),
		};
	}
	submit(
		botId: BotId,
		requestId: string,
		text: string,
		options: { channelId?: string; origin?: "user" | "peer" | "background" | "routine"; separate?: boolean; artifactIds?: readonly string[];skills?:readonly import("@openbot/protocol").SkillRef[] } = {},
	): Promise<SubmitOutcome> {
		const channelId = options.channelId ?? "direct";
		return this.#serial(async () => {
			const existing = await this.#byRequest(botId, requestId);
			if (existing !== undefined) {
				const message = existing.messages.find((candidate) => candidate.requestId === requestId);
				if (
					message?.text !== text ||
					JSON.stringify(skillReferences(message?.requestedSkills ?? message?.skills ?? [])) !== JSON.stringify(skillReferences(options.skills ?? [])) ||
					JSON.stringify(message?.attachments?.map((a) => a.artifactId) ?? []) !== JSON.stringify(options.artifactIds ?? []) ||
					(existing.channelId ?? "direct") !== channelId ||
					(existing.origin ?? "user") !== (options.origin ?? "user")
				) {
					throw new ProtocolError("request_conflict", "This request ID was already used for another message");
				}
				return { runId: existing.runId, state: existing.state, steered: existing.messages[0]?.requestId !== requestId };
			}
			const attachments = options.artifactIds?.length ? await this.#resolveAttachments(botId, options.artifactIds) : [];
			const roleSkills = channelId === "direct" && (options.origin ?? "user") === "user"
				? (await this.#runtime.getBot(botId))?.defaultSkills ?? [] : [];
			const requestedSkills = skillReferences(options.skills ?? []);
			const skills = await this.#resolveSkills(composeRoleSkills(roleSkills, requestedSkills));
			const message = { requestId, text, requestedSkills, roleSkills, ...(skills.length ? { skills } : {}), ...(attachments.length ? { attachments } : {}) };
			const candidate = options.separate ? undefined : this.active(botId, channelId);
			const current = (candidate?.origin ?? "user") === (options.origin ?? "user") ? candidate : undefined;
			if (current?.state === "queued") {
				const joined = { ...current, requestIds: [...current.requestIds, requestId], messages: [...current.messages, message] };
				await this.#put(joined);
				return { runId: joined.runId, state: joined.state, steered: true };
			}
			if (current?.state === "running" && this.#canAdmit() && !current.interruption && !this.#cancelling.has(current.runId)) {
				// Recorded before Pi admits it, so a crash in between resubmits it on start.
				const steered = {
					...current,
					requestIds: [...current.requestIds, requestId],
					messages: [...current.messages, message],
					inputs: [...current.inputs, message],
				};
				await this.#put(steered);
				await this.#submitInputs(steered);
				return { runId: steered.runId, state: "running", steered: true };
			}
			const run: StoredRun = {
				origin: options.origin ?? "user",
                ...(options.origin === "routine" ? {} : { messageMode: "messages-v1" as const }),
				...(channelId === "direct" ? {} : { channelId }),
				runId: `run_${randomUUID()}`,
				botId,
				state: "queued",
				requestIds: [requestId],
				createdAt: this.#now(),
				messages: [message],
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
			if (!this.#canAdmit()) throw new ProtocolError("invalid_request", "Work is paused. Wait for interruption to settle.");
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
		if (stored !== undefined && !isTerminal(stored.state)) this.#runs.set(stored.runId, stored);
		return stored;
	}

	/**
	 * Start queued Runs, oldest first across Bots, while slots are free. A Bot whose previous Run is still running (being
	 * stopped) keeps its queued Run waiting: Pi would withdraw a message submitted while the abort is in progress.
	 */
	async #admit(): Promise<void> {
		for (;;) {
			if (!this.#canAdmit()) return;
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
			if (!this.#canAdmit()) return;
			const started: StoredRun = {
				...next,
				state: "running",
                ...(next.origin === "routine" ? {} : { messageMode: "messages-v1" as const }),
				startedAt: this.#now(),
				inputs: next.messages.some((message) => message.attachments?.length || message.skills?.length)
					? next.messages.map((message) => ({ ...message }))
					: [{ requestId: next.requestIds[0]!, text: next.messages.map((message) => message.text).join("\n\n") }],
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
			if (!this.#canAdmit()) return;
			if (input.submissionId !== undefined || input.outcome !== undefined) continue;
			const mode: Mode = index === 0 ? "start" : "steer";
			let submissionId = input.attachments?.length || input.skills?.length
				? await this.#runtime.findSubmission(run.botId, input.requestId, run.channelId)
				: undefined;
			if (!submissionId) {
				let attachments: readonly ArtifactContent[] = [];
				try {
					if (input.attachments?.length) attachments = await this.#hydrateAttachments(run.botId, input.attachments);
				} catch (error) {
					const reason = error instanceof Error ? error.message : "Attachment content is unavailable";
					for (const candidate of current.inputs)
						if (candidate.submissionId === undefined)
							await this.#runtime.recordInputFailure(
								run.botId,
								candidate.requestId,
								candidate.text,
								candidate.attachments ?? [],
								reason,
								run.channelId,
 candidate.skills,
							);
					current = {
						...current,
						inputs: current.inputs.map((candidate) =>
							candidate.submissionId === undefined ? { ...candidate, outcome: { status: "unanswered" as const, reason } } : candidate,
						),
					};
					await this.#put(current);
					break;
				}
				try {
					submissionId = (await this.#runtime.submit(run.botId, input.requestId, input.text, mode, run.channelId, attachments, () => {
						if (!this.#canAdmit()) throw new ProtocolError("invalid_request", "Work is paused. Resume work before continuing.");
					}, input.skills, run.origin==="routine"?"routine":run.origin==="background")).submissionId;
				} catch (error) {
					if (!this.#canAdmit()) return;
					throw error;
				}
			}
			current = withInput(current, input.requestId, { submissionId });
			await this.#put(current);
		}
		if (!this.#canAdmit()) return;
		for (const input of current.inputs) {
			if (input.outcome !== undefined || input.submissionId === undefined) continue;
			this.#observe(current.runId, input.requestId, input.submissionId, current.botId, current.channelId);
		}
		await this.#finishIfSettled(current.runId);
	}

	#observe(runId: RunId, requestId: string, submissionId: string, botId: BotId, channelId?: string): void {
		if (this.#observed.has(submissionId)) return;
		this.#observed.add(submissionId);
		this.#runtime
			.waitSubmission(botId, submissionId, channelId, () => {
				if (!this.#canAdmit()) throw new ProtocolError("invalid_request", "Work is paused. Resume work before continuing.");
			})
			.then(
				(outcome) => void this.#serial(() => this.#settled(runId, requestId, outcome)).catch(() => {}),
				// A lifecycle gate or closed Host leaves the durable submission available for observation after Resume.
				() => {
					this.#observed.delete(submissionId);
				},
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
		const interrupted =
			run.interruption ??
			(!this.#canAdmit() && failure !== undefined ? { reason: "recovery" as const, requestedAt: this.#now() } : undefined);
		const ended: StoredRun =
			interrupted && failure !== undefined
				? {
						...run,
						state: "needs_attention",
						interruption: interrupted,
						endedAt: this.#now(),
						error: "Work was interrupted. Review completed actions before continuing.",
					}
				: cancelled
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
		if (isTerminal(run.state) && !(run.state === "needs_attention" && !run.interruption?.settledAt)) this.#runs.delete(run.runId);
		else this.#runs.set(run.runId, run);
		this.#rememberChannel(run);
		if ((run.channelId ?? "direct") === "direct" && (this.#latestDirect.get(run.botId)?.createdAt ?? -Infinity) <= run.createdAt)
			this.#latestDirect.set(run.botId, run);
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

function skillReferences(refs: readonly import("@openbot/protocol").SkillRef[]): import("@openbot/protocol").SkillRef[] {
	return refs.map(({ name, revision, sha256 }) => ({ name, revision, sha256 }));
}
