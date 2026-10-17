/** Group lifecycle and durable delivery reconciliation; model replies never choose a destination. */
import { createHash } from "node:crypto";
import { isTerminal, type BotRuntime, type StoredRun } from "@openbot/agent-runtime";
import { type GroupChange, type GroupFields, type GroupSnapshot, ProtocolError } from "@openbot/protocol";
import type { ApprovalBook, Decision } from "./approvals.ts";
import { BotManagement, type ManagementCall } from "./bot-management.ts";
import type { RunScheduler } from "./runs.ts";

const fail = (message: string): never => {
	throw new ProtocolError("invalid_request", message);
};
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
	readonly #approvals: ApprovalBook;
	readonly #changed: () => void;
	readonly #settled: (botId: string, callId: string, conversationId?: string) => void;
	readonly #stopping: (botId: string, channelId: string) => void;
	readonly #observers = new Map<string, () => void>();
	#timer?: ReturnType<typeof setInterval>;
	#line: Promise<unknown> = Promise.resolve();
	#stopped = false;
	constructor(options: {
		runtime: BotRuntime;
		authority: BotManagement;
		runs: RunScheduler;
		approvals: ApprovalBook;
		changed: () => void;
		settled: (botId: string, callId: string, conversationId?: string) => void;
		stopping: (botId: string, channelId: string) => void;
	}) {
		this.runtime = options.runtime;
		this.authority = options.authority;
		this.#runs = options.runs;
		this.#approvals = options.approvals;
		this.#changed = options.changed;
		this.#settled = options.settled;
		this.#stopping = options.stopping;
	}
	async admissible(run: StoredRun): Promise<boolean> {
		if (!run.channelId || run.channelId === "direct") return true;
		const group = await this.runtime.groups().get(run.channelId);
		const d = (await this.runtime.groups().deliveries()).find(
			(d) => d.groupId === run.channelId && d.botId === run.botId && run.requestIds.includes(`delivery:${d.deliveryId}`),
		);
		return !!group && group.status === "active" && group.memberIds.includes(run.botId) && d?.state === "pending";
	}
	async start(): Promise<void> {
		for (const channel of await this.runtime.channels()) {
			await this.#observe(channel.botId, channel.channelId);
			const group = await this.runtime.groups().get(channel.channelId);
			if (group && (group.status === "dissolved" || !group.memberIds.includes(channel.botId)))
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
		const before = await this.runtime.groups().get(change.groupId);
		const result = await this.runtime.groups().change(change, Date.now(), intentId);
		for (const id of before?.memberIds ?? [])
			if (result.status === "dissolved" || !result.memberIds.includes(id)) this.#stopping(id, result.groupId);
		this.#changed();
		await this.sweep();
		return result;
	}
	async send(groupId: string, requestId: string, text: string, recipientIds?: readonly string[]) {
		const group = await this.runtime.groups().get(groupId);
		for (const id of recipientIds ?? (group?.leadBotId ? [group.leadBotId] : [])) {
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
			if (this.#stopped) return;
			const store = this.runtime.groups();
			const deliveries = await store.deliveries();
			const cancelled = new Set(deliveries.filter((d) => d.state === "cancelled").map((d) => `delivery:${d.deliveryId}`));
			await this.#runs.cancelMatching((run) => run.requestIds.some((id) => cancelled.has(id)));
			for (const d of deliveries) {
				if (d.state !== "pending") continue;
				await this.runtime.ensureChannel(d.botId, d.groupId);
				await this.#observe(d.botId, d.groupId);
				let runId = d.runId;
				if (!runId) {
					// The stable request ID reconciles a crash after submit but before admitted.
					const admitted = await this.#runs.submit(d.botId, `delivery:${d.deliveryId}`, d.input, { channelId: d.groupId, separate: true });
					runId = admitted.runId;
					await store.admitted(d.deliveryId, runId);
				}
				const run = await this.runtime.runsStore().get(runId);
				if (!run || !isTerminal(run.state)) continue;
				const submissionId = run.inputs[0]?.submissionId;
				const text = run.state === "completed" && submissionId ? await this.runtime.submissionAnswer(d.botId, submissionId, d.groupId) : "";
				await store.finish(d.deliveryId, run.state as "completed" | "failed" | "cancelled", text, Date.now());
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
		return { group, posts: await this.runtime.groups().posts(groupId), tasks };
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
			if (call.tool === "group_inspect") {
				if (Object.keys(call.args).some((k) => k !== "groupId") || (call.args.groupId != null && typeof call.args.groupId !== "string"))
					fail("Invalid group change");
				return { kind: "allow" };
			}
			const action =
				call.tool === "group_create"
					? "create"
					: call.tool === "group_update"
						? "update"
						: call.tool === "group_dissolve"
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
			await this.runtime.groups().propose(id, { fingerprint: this.authority.fingerprint(call), change, approvalId: `approval:${id}` });
			return { kind: "ask", reason: "Review this group change" };
		} catch (error) {
			if (call.signal.aborted) throw error;
			return { kind: "deny", reason: error instanceof ProtocolError ? error.message : "Group management is unavailable" };
		}
	}
	async manage(call: ManagementCall): Promise<{ status: "succeeded" | "failed"; output: string }> {
		try {
			if (call.tool === "group_inspect") {
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
