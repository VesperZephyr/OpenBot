/**
 * Pending approvals and the first-release policy. Both implement Tool Router ports, which `apps/local-server` wires.
 *
 * Approvals are durable (Section 5.3): every record lives in the Host's `ApprovalStore`, keyed by an ID derived from
 * Pi's stable call ID, so the rerun of an interrupted call after a restart finds the same record. A record is written
 * before the router waits on it and a decision before the waiter wakes; in-memory waiters only say whom to wake.
 */
import type { ApprovalStore } from "@openbot/agent-runtime";
import type { ApprovalDecision, ApprovalRecord, BotId, PendingApproval, ToolDefinition } from "@openbot/protocol";

/** Consumed and withdrawn records are deleted at start once they are this old. */
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type Entry = { record: ApprovalRecord; readonly waiters: Set<(decision: ApprovalDecision) => void> };

export class ApprovalBook {
	readonly #changed: (botId: BotId) => void;
	readonly #now: () => number;
	/** Records not yet consumed that this process has seen: pending ones for the UI, decided ones to consume. */
	readonly #entries = new Map<string, Entry>();
	#store: ApprovalStore | undefined;
	#closed = false;

	/** `changed` runs whenever a Bot's pending approvals change, so its conversation can be republished. */
	constructor(changed: (botId: BotId) => void, now: () => number = Date.now) {
		this.#changed = changed;
		this.#now = now;
	}

	/**
	 * Attach the store, prune old records, and load pending ones so the UI shows them before Pi reruns their calls.
	 * Call once, before the runtime resumes.
	 */
	async start(store: ApprovalStore): Promise<void> {
		this.#store = store;
		await store.prune(this.#now() - RETENTION_MS);
		for (const record of await store.pending()) {
			this.#entries.set(record.approvalId, { record, waiters: new Set() });
			this.#changed(record.botId);
		}
	}

	/**
	 * Stop writing: the Host is shutting down, which aborts every wait, and the records must stay `pending` so the
	 * relaunched Host asks again. Call before the runtime closes.
	 */
	close(): void {
		this.#closed = true;
	}

	/**
	 * Record an approval and wait for the user. Asking again for the same ID (the same call, rerun) joins the pending
	 * request, or returns the decision already made without waiting.
	 */
	async request(approval: PendingApproval, signal: AbortSignal): Promise<ApprovalDecision> {
		signal.throwIfAborted();
		const store = this.#requireStore();
		let entry = this.#entries.get(approval.approvalId);
		if (entry === undefined) {
			const stored = await store.get(approval.approvalId);
			// Decided before (this call was rerun): the same answer, without asking. Consumed records answer the same way.
			if (stored?.decision !== undefined) {
				if (stored.state !== "consumed") this.#entries.set(stored.approvalId, { record: stored, waiters: new Set() });
				return stored.decision;
			}
			// A withdrawn record belonged to a cancelled Run, so a new request asks afresh.
			const record: ApprovalRecord = stored?.state === "pending" ? stored : { ...approval, state: "pending" };
			if (stored?.state !== "pending") await store.put(record);
			// Another request for the same ID may have registered while this one awaited the store.
			entry = this.#entries.get(approval.approvalId);
			if (entry === undefined) {
				entry = { record, waiters: new Set() };
				this.#entries.set(approval.approvalId, entry);
				this.#changed(approval.botId);
			}
		}
		if (entry.record.decision !== undefined) return entry.record.decision;
		signal.throwIfAborted();
		const joined = entry;

		const { promise, resolve, reject } = Promise.withResolvers<ApprovalDecision>();
		const waiter = (decision: ApprovalDecision): void => {
			signal.removeEventListener("abort", abort);
			resolve(decision);
		};
		const abort = (): void => {
			joined.waiters.delete(waiter);
			reject(signal.reason);
			// A shutdown aborts too; only a cancelled Run withdraws the request (nothing is left to answer).
			if (this.#closed || joined.waiters.size > 0 || joined.record.state !== "pending") return;
			const withdrawn: ApprovalRecord = { ...joined.record, state: "withdrawn", decidedAt: this.#now() };
			joined.record = withdrawn;
			this.#entries.delete(withdrawn.approvalId);
			this.#changed(withdrawn.botId);
			void store.put(withdrawn).catch((error: unknown) => console.error("Could not withdraw an approval", error));
		};
		joined.waiters.add(waiter);
		signal.addEventListener("abort", abort, { once: true });
		return promise;
	}

	/**
	 * Settle a pending approval: the decision is committed before the call wakes. Returns false when it is not pending
	 * (already decided, or its Run ended).
	 */
	async decide(approvalId: string, decision: ApprovalDecision): Promise<boolean> {
		const entry = this.#entries.get(approvalId);
		if (entry === undefined || entry.record.state !== "pending" || this.#closed) return false;
		const record: ApprovalRecord = {
			...entry.record,
			state: decision === "deny" ? "denied" : "allowed",
			decision,
			decidedAt: this.#now(),
		};
		// Claimed before the commit, so a second click cannot decide twice.
		entry.record = record;
		await this.#requireStore().put(record);
		this.#changed(record.botId);
		for (const waiter of entry.waiters) waiter(decision);
		entry.waiters.clear();
		return true;
	}

	/**
	 * The call's result is committed: its decided approval is used up. Calls without a decided approval are ignored,
	 * so the Host may report every settled call.
	 */
	async settled(botId: BotId, callId: string): Promise<void> {
		for (const [approvalId, { record }] of this.#entries) {
			if (record.botId !== botId || record.callId !== callId || record.decision === undefined) continue;
			this.#entries.delete(approvalId);
			if (!this.#closed) await this.#requireStore().put({ ...record, state: "consumed" });
			return;
		}
	}

	forBot(botId: BotId): PendingApproval[] {
		return [...this.#entries.values()]
			.filter((entry) => entry.record.state === "pending" && entry.record.botId === botId)
			.map(({ record: { state: _state, decision: _decision, decidedAt: _decidedAt, ...approval } }) => approval)
			.sort((a, b) => a.createdAt - b.createdAt);
	}

	#requireStore(): ApprovalStore {
		if (this.#store === undefined) throw new Error("The approval book is not started");
		return this.#store;
	}
}

export type PolicyCall = { readonly tool: string; readonly args: Readonly<Record<string, unknown>> };
export type Decision =
	| { readonly kind: "allow" }
	| { readonly kind: "ask"; readonly reason: string }
	| { readonly kind: "deny"; readonly reason: string };

/**
 * First-release policy: hard rules, then capability defaults (Section 5.3). File tools inside a granted folder run
 * without asking; outside every grant they ask, and an approval grants that one path for that one call. Commands
 * always ask. Fetching public pages is allowed; the handler refuses private addresses itself. A Bot's own memory is
 * Host state the user can see and edit, so updating it is allowed.
 */
export function decide(
	call: PolicyCall,
	definition: ToolDefinition,
	isGranted: (path: string) => boolean,
): Decision {
	switch (definition.capability) {
		case "commands":
			return { kind: "ask", reason: "Runs a command on this Mac" };
		case "files.read":
		case "files.write": {
			const path = typeof call.args.path === "string" ? call.args.path : undefined;
			if (path === undefined) return { kind: "deny", reason: "No path given" };
			if (isGranted(path)) return { kind: "allow" };
			const verb = definition.capability === "files.read" ? "Reads" : "Changes";
			return { kind: "ask", reason: `${verb} a file outside the workspace` };
		}
		case "web":
		case "memory":
		// Reading or stopping a background command the user already approved.
		case "tasks":
			return { kind: "allow" };
	}
}
