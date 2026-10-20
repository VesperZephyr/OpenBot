/** Group lifecycle and durable delivery reconciliation; model replies never choose a destination. */
import { createHash } from "node:crypto";
import { isTerminal, type BotRuntime, type StoredRun } from "@openbot/agent-runtime";
import {
	legacyManagementName,
	type GroupDelivery,
	type GroupChange,
	type GroupFields,
	type GroupSnapshot,
	ProtocolError,
} from "@openbot/protocol";
import type { ApprovalBook, Decision } from "./approvals.ts";
import { BotManagement, type ManagementCall } from "./bot-management.ts";
import type { RunScheduler } from "./runs.ts";

function fail(message: string): never {
	throw new ProtocolError("invalid_request", message);
}
const canonical = (value: unknown): string => {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object")
		return `{${Object.entries(value)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
			.join(",")}}`;
	return JSON.stringify(value);
};
export class Groups {
	readonly runtime: BotRuntime;
	readonly authority: BotManagement;
	readonly #runs: RunScheduler;
 readonly #canRun:()=>boolean;
	readonly #approvals: ApprovalBook;
	readonly #changed: () => void;
	readonly #settled: (botId: string, callId: string, conversationId?: string) => void;
	readonly #stopping: (botId: string, channelId: string, runId?: string) => void;
	readonly #stoppedTrees = new Set<string>();
	readonly #observers = new Map<string, () => void>();
	#timer?: ReturnType<typeof setInterval>;
	#line: Promise<unknown> = Promise.resolve();
	#stopped = false;
	constructor(options: {
		runtime: BotRuntime;
  canRun?:()=>boolean;
		authority: BotManagement;
		runs: RunScheduler;
		approvals: ApprovalBook;
		changed: () => void;
		settled: (botId: string, callId: string, conversationId?: string) => void;
		stopping: (botId: string, channelId: string, runId?: string) => void;
	}) {
		this.runtime = options.runtime;
 this.#canRun=options.canRun??(()=>true);
		this.authority = options.authority;
		this.#runs = options.runs;
		this.#approvals = options.approvals;
		this.#changed = options.changed;
		this.#settled = options.settled;
		this.#stopping = options.stopping;
	}
	async admissible(run: StoredRun): Promise<boolean> {
		if (!run.channelId || run.channelId === "direct" || run.origin === "routine") return true;
		const group = await this.runtime.groups().get(run.channelId);
		const d = (await this.runtime.groups().deliveries()).find(
			(d) => d.groupId === run.channelId && d.botId === run.botId && run.requestIds.includes(`delivery:${d.deliveryId}`),
		);
		const root = d?.rootId ? (await this.runtime.groups().roots(run.channelId)).find((r) => r.rootId === d.rootId) : undefined;
		return (
			!!group &&
			group.status === "active" &&
			(group.memberIds.includes(run.botId) || root?.coreBotId === run.botId) &&
			d?.state === "pending" &&
			(!root || root.state === "running")
		);
	}
	async interruptActive(): Promise<void> {
		const runs = await this.runtime.runsStore().list();
		const deliveries = await this.runtime.groups().deliveries();
		const interrupted = new Set(runs.filter((run) => !!run.interruption).map((run) => run.runId));
		for (const root of await this.runtime.groups().roots()) {
			if (root.state === "running" && deliveries.some((d) => d.rootId === root.rootId && d.runId && interrupted.has(d.runId))) {
				await this.runtime.groups().stop(root.rootId, "Work interrupted by application lifecycle");
			}
		}
		this.#changed();
	}

	async start(): Promise<void> {
		await this.runtime.groups().backfillIndex();
		for (const channel of await this.runtime.channels()) {
   if (channel.channelId.startsWith("routine_")) continue;
			await this.#observe(channel.botId, channel.channelId);
			const group = await this.runtime.groups().get(channel.channelId);
			if (
				group &&
				(group.status === "dissolved" ||
					(!group.memberIds.includes(channel.botId) && (await this.runtime.getBot(channel.botId))?.kind !== "core"))
			)
				this.#stopping(channel.botId, channel.channelId);
		}
		await this.sweep();
		this.#timer = setInterval(() => {
			void this.sweep().catch(() => {});
		}, 500);
		this.#timer.unref();
	}
	async stop(): Promise<void> {
		this.#stopped = true;
		clearInterval(this.#timer);
		await this.#line;
		for (const stop of this.#observers.values()) stop();
	}
	async #observe(botId: string, groupId: string): Promise<void> {
		const key = JSON.stringify([botId, groupId]);
		if (this.#observers.has(key)) return;
		const settled = new Set<string>();
		const stop = await this.runtime.observe(
			botId,
			(snapshot) => {
				this.#changed();
				for (const item of snapshot.items)
					if (item.kind === "tool" && !["pending", "running"].includes(item.status) && !settled.has(item.id)) {
						settled.add(item.id);
						this.#settled(botId, item.id, snapshot.conversationId);
					}
			},
			groupId,
		);
		this.#observers.set(key, stop);
	}
	async change(change: GroupChange, intentId?: string) {
		const result = await this.runtime.groups().change(change, Date.now(), intentId);
		const affected = new Set((await this.runtime.channels()).filter((c) => c.channelId === result.groupId).map((c) => c.botId));
		for (const id of affected)
			if (result.status === "dissolved" || (!result.memberIds.includes(id) && (await this.runtime.getBot(id))?.kind !== "core"))
				this.#stopping(id, result.groupId);
		this.#changed();
		await this.sweep();
		return result;
	}
	async send(groupId: string, requestId: string, text: string, recipientIds?: readonly string[]) {
		const core = (await this.runtime.listBots()).find((b) => b.kind === "core");
		for (const id of recipientIds ?? (core ? [core.botId] : [])) {
			const bot = await this.runtime.getBot(id);
			if (bot && !bot.model && !(await this.runtime.defaultModel())) fail("Choose a model in Settings before messaging a Bot");
		}
		const post = await this.runtime.groups().post(groupId, requestId, text, recipientIds, Date.now());
		this.#changed();
		await this.sweep();
		return post;
	}
	sweep(): Promise<void> {
		const work = this.#line.then(async () => {
			if (this.#stopped||!this.#canRun()) return;
			const store = this.runtime.groups();
			await store.reconcile(Date.now());
			const deliveries = await store.deliveries();
			for (const root of await store.roots())
				if (["paused", "cancelled"].includes(root.state) && !this.#stoppedTrees.has(root.rootId)) {
					for (const d of deliveries) if (d.rootId === root.rootId && d.runId) this.#stopping(d.botId, d.groupId, d.runId);
					this.#stoppedTrees.add(root.rootId);
				}
			const cancelled = new Set(deliveries.filter((d) => d.state === "cancelled").map((d) => `delivery:${d.deliveryId}`));
			await this.#runs.cancelMatching((run) => run.requestIds.some((id) => cancelled.has(id)));
			for (const d of deliveries) {
    if(!this.#canRun())return;
				if (d.state !== "pending" || (d.origin==="background" && !d.backgroundReady)) continue;
				if(d.backgroundSourceId && deliveries.find(source=>source.deliveryId===d.backgroundSourceId)?.state!=="completed")continue;
				if (d.parentId && deliveries.find((p) => p.deliveryId === d.parentId)?.state !== "completed") continue;
				await this.runtime.ensureChannel(d.botId, d.groupId);
				await this.#observe(d.botId, d.groupId);
				let runId = d.runId;
				if (!runId) {
					// The stable request ID reconciles a crash after submit but before admitted.
					const admitted = await this.#runs.submit(d.botId, `delivery:${d.deliveryId}`, d.input, {
						channelId: d.groupId,
						separate: true,
						origin: d.origin === "background" ? "background" : d.origin === "peer" || d.origin === "result" ? "peer" : "user",
					});
					runId = admitted.runId;
					await store.admitted(d.deliveryId, runId);
					this.#changed();
				}
				const run = await this.runtime.runsStore().get(runId);
				if (!run || !isTerminal(run.state)) continue;
				const submissionId = run.inputs[0]?.submissionId;
				const text = run.state === "completed" && submissionId ? await this.runtime.submissionAnswer(d.botId, submissionId, d.groupId) : "";
				const artifacts =
					run.state === "completed" && submissionId ? await this.runtime.submissionArtifacts(d.botId, submissionId, d.groupId) : [];
				await store.finish(d.deliveryId, run.state === "needs_attention" ? "failed" : run.state as "completed" | "failed" | "cancelled", text, Date.now(), artifacts);
				this.#changed();
			}
		});
		this.#line = work.catch(() => {});
		return work;
	}
	async snapshot(groupId: string): Promise<GroupSnapshot> {
		const group = await this.runtime.groups().get(groupId);
		if (!group) return fail("This group is dissolved or unavailable");
		const all = (await this.runtime.groups().deliveries()).filter((d) => d.groupId === groupId);
		const selected = all.filter((d) => d.state === "pending").concat(all.filter((d) => d.state !== "pending").slice(-20));
		const tasks = await Promise.all(
			selected.map(async (d) => {
				if (d.state !== "pending" || !d.runId) return d;
				const run = await this.runtime.runsStore().get(d.runId);
				if (!run || isTerminal(run.state)) return d;
				const { messages: _messages, inputs: _inputs, ...record } = run;
				const { live, ...snapshot } = await this.runtime.snapshot(d.botId, groupId);
				// Only the running delivery owns this channel's current approval/live state.
				return {
					...d,
					conversation: {
						...snapshot,
						items: [],
						pending: [],
						run: record,
						...(run.state === "queued"
							? { approvals: [] }
							: { ...(live ? { live } : {}), approvals: this.#approvals.forBot(d.botId, snapshot.conversationId) }),
					},
				};
			}),
		);
		return { group, roots: await this.runtime.groups().roots(groupId), ...(await this.runtime.groups().history(groupId)), tasks };
	}
	async stopTree(rootId: string): Promise<null> {
		await this.runtime.groups().stop(rootId);
		this.#changed();
		await this.sweep();
		return null;
	}
	async #collaborationParent(call: ManagementCall): Promise<GroupDelivery> {
		call.signal.throwIfAborted();
		if (!call.collaboration) fail("Collaboration requires an assigned group task");
		const run = await this.runtime.runsStore().get(call.collaboration!.runId);
		if (
			!run ||
			run.botId !== call.botId ||
			run.state !== "running" ||
			run.origin === "background" ||
			!run.channelId ||
			run.channelId === "direct" ||
			(await this.runtime.conversationKey(call.botId, run.channelId)) !== call.conversationId
		)
			fail("Collaboration requires an active assigned group task");
		const d = (await this.runtime.groups().deliveries()).find(
			(d) => d.groupId === run!.channelId && d.botId === call.botId && run!.requestIds.includes(`delivery:${d.deliveryId}`),
		);
		if (!d?.rootId) fail("This task does not support collaboration");
		return d!;
	}
	#dispatchFingerprint(call: ManagementCall): string {
		return createHash("sha256")
			.update(
				canonical({
					botId: call.botId,
					conversationId: call.conversationId,
					runId: call.collaboration?.runId,
					tool: call.tool,
					args: call.args,
				}),
			)
			.digest("hex");
	}
	async executionGate(call: ManagementCall): Promise<Decision | undefined> {
		const channel = (await this.runtime.channels()).find((c) => String(c.conversationId) === call.conversationId && c.botId === call.botId);
		if (!channel) return;
		const runs = await this.runtime.runsStore().list();
		const run = runs.find((r) => r.botId === call.botId && r.channelId === channel.channelId && r.state === "running");
		const d = run && (await this.runtime.groups().deliveries()).find((d) => run.requestIds.includes(`delivery:${d.deliveryId}`));
		if (!d?.rootId) return;
		const root = (await this.runtime.groups().roots(d.groupId)).find((r) => r.rootId === d.rootId);
		if (!root || root.state !== "running" || d.state !== "pending" || d.transferId) {
			// A successful immutable receipt may replay after ownership moved, but no new side effect may run.
			if (["bot_delegate", "bot_handoff"].includes(call.tool) && (await this.runtime.groups().dispatchReceipt(this.authority.key(call))))
				return;
			return { kind: "deny", reason: "This task no longer owns execution authority" };
		}
		return;
	}
	async prepareCollaboration(call: ManagementCall): Promise<Decision> {
		try {
			if (
				!["bot_delegate", "bot_handoff"].includes(call.tool) ||
				Object.keys(call.args).some((k) => !["botId", "task", "expectedResult"].includes(k)) ||
				typeof call.args.botId !== "string" ||
				typeof call.args.task !== "string" ||
				typeof call.args.expectedResult !== "string"
			)
				fail("Invalid collaboration task");
			const prior = await this.runtime.groups().dispatchReceipt(this.authority.key(call));
			if (prior) {
				if (prior.fingerprint !== this.#dispatchFingerprint(call)) fail("Collaboration invocation arguments changed");
				return { kind: "allow" };
			}
			await this.#collaborationParent(call);
			return { kind: "allow" };
		} catch (error) {
			if (call.signal.aborted) throw error;
			return { kind: "deny", reason: error instanceof ProtocolError ? error.message : "Collaboration is unavailable" };
		}
	}
	async collaborate(call: ManagementCall): Promise<{ status: "succeeded" | "failed"; output: string }> {
		try {
			const decision = await this.prepareCollaboration(call);
			if (decision.kind === "deny") fail(decision.reason);
			const key = this.authority.key(call);
			const prior = await this.runtime.groups().dispatchReceipt(key);
			const result =
				prior ??
				(await this.runtime
					.groups()
					.dispatch(
						key,
						this.#dispatchFingerprint(call),
						(await this.#collaborationParent(call)).deliveryId,
						call.args.botId as string,
						call.args.task as string,
						call.args.expectedResult as string,
						call.tool === "bot_handoff",
						Date.now(),
					));
			this.#changed();
			return {
				status: result.error ? "failed" : "succeeded",
				output: JSON.stringify({
					...result,
					fingerprint: undefined,
					note: result.error
						? "Task paused. Wait for new user instructions."
						: "Assignment recorded. Finish this turn; do not poll or acknowledge. Work starts after your turn ends.",
				}),
			};
		} catch (error) {
			if (call.signal.aborted) throw error;
			return { status: "failed", output: error instanceof ProtocolError ? error.message : "Collaboration is unavailable" };
		}
	}
	async settled(botId: string, callId: string, status: string): Promise<void> {
		const id = `${await this.runtime.conversationKey(botId)}:${callId}`;
		const intent = await this.runtime.groups().intent(id);
		if (!intent || intent.result || intent.outcome) return;
		const approval = await this.runtime.approvals().get(intent.approvalId);
		await this.runtime
			.groups()
			.settleIntent(id, approval?.decision === "deny" ? "denied" : status === "cancelled" ? "cancelled" : "failed");
	}
	async prepare(call: ManagementCall): Promise<Decision> {
		try {
			const saved = await this.runtime.groups().intent(this.authority.key(call));
			await this.authority.authorize(call, !saved?.result);
			if (legacyManagementName(call.tool) === "group_inspect") {
				if (Object.keys(call.args).some((k) => k !== "groupId") || (call.args.groupId != null && typeof call.args.groupId !== "string"))
					fail("Invalid group change");
				return { kind: "allow" };
			}
			const action =
				legacyManagementName(call.tool) === "group_create"
					? "create"
					: legacyManagementName(call.tool) === "group_update"
						? "update"
						: legacyManagementName(call.tool) === "group_dissolve"
							? "dissolve"
							: undefined;
			if (!action) return fail("Invalid group change");
			if (saved) {
				if (saved.fingerprint !== this.authority.fingerprint(call)) fail("Management invocation arguments changed");
				if (saved.outcome) return { kind: "deny", reason: "This management request already ended" };
				return saved.result ? { kind: "allow" } : { kind: "ask", reason: "Review this group change" };
			}
			const allowed =
				action === "create"
					? ["name", "objective", "memberIds", "leadBotId"]
					: action === "update"
						? ["groupId", "expectedRevision", "name", "objective", "memberIds", "leadBotId"]
						: ["groupId", "expectedRevision"];
			if (Object.keys(call.args).some((k) => !allowed.includes(k))) fail("Invalid group change");
			const { groupId, expectedRevision, ...fields } = call.args;
			if (action !== "create" && (typeof groupId !== "string" || !Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 1))
				fail("Inspect the group and supply its current revision");
			if (
				action !== "dissolve" &&
				(typeof fields.name !== "string" ||
					typeof fields.objective !== "string" ||
					typeof fields.leadBotId !== "string" ||
					!Array.isArray(fields.memberIds) ||
					fields.memberIds.some((id) => typeof id !== "string"))
			)
				fail("Invalid group change");
			const id = this.authority.key(call);
			const change: GroupChange = {
				requestId: `core:${id}`,
				action,
				groupId: action === "create" ? `group_${createHash("sha256").update(id).digest("hex")}` : (groupId as string),
				expectedRevision: action === "create" ? 0 : (expectedRevision as number),
				...(action === "dissolve" ? {} : { fields: fields as GroupFields }),
			};
			await this.runtime.groups().propose(id, {
				...(await this.authority.binding(call)),
				fingerprint: this.authority.fingerprint(call),
				change,
				approvalId: `approval:${id}`,
			});
			return { kind: "ask", reason: "Review this group change" };
		} catch (error) {
			if (call.signal.aborted) throw error;
			return { kind: "deny", reason: error instanceof ProtocolError ? error.message : "Group management is unavailable" };
		}
	}
	async manage(call: ManagementCall): Promise<{ status: "succeeded" | "failed"; output: string }> {
		try {
			if (legacyManagementName(call.tool) === "group_inspect") {
				const decision = await this.prepare(call);
				if (decision.kind === "deny") fail(decision.reason);
				return {
					status: "succeeded",
					output: JSON.stringify(
						(await this.runtime.groups().list()).filter((g) => call.args.groupId == null || g.groupId === call.args.groupId),
					),
				};
			}
			const id = this.authority.key(call);
			const intent = await this.runtime.groups().intent(id);
			await this.authority.authorize(call, !intent?.result);
			if (!intent || intent.fingerprint !== this.authority.fingerprint(call)) return fail("Management proposal mismatch");
			if (intent.result) {
				await this.sweep();
				return { status: "succeeded", output: JSON.stringify(intent.result) };
			}
			const approval = await this.runtime.approvals().get(intent.approvalId);
			if (
				approval?.decision !== "allow_once" ||
				approval.botId !== call.botId ||
				approval.tool !== call.tool ||
				approval.target.kind !== "local" ||
				approval.target.targetId !== this.authority.targetId ||
				canonical(approval.args) !== canonical(call.args)
			)
				fail("This exact group change needs user approval");
			call.signal.throwIfAborted();
			return { status: "succeeded", output: JSON.stringify(await this.change(intent.change, id)) };
		} catch (error) {
			if (call.signal.aborted) throw error;
			return { status: "failed", output: error instanceof ProtocolError ? error.message : "Group management is unavailable" };
		}
	}
}
