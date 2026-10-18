/**
 * Pending approvals and the first-release policy. Both implement Tool Router ports, which `apps/local-server` wires.
 *
 * Approvals are durable (Section 5.3): every record lives in the Host's `ApprovalStore`, keyed by an ID derived from
 * Pi's stable call ID, so the rerun of an interrupted call after a restart finds the same record. A record is written
 * before the router waits on it and a decision before the waiter wakes; in-memory waiters only say whom to wake.
 */
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type { ApprovalStore } from "@openbot/agent-runtime";
import {
	type AlwaysAllowOption,
	type AlwaysAllowScope,
	type ApprovalDecision,
	type ApprovalRecord,
	type BotId,
	type CommandRule,
	type CommandSetting,
	type GrantAccess,
	type PendingApproval,
	ProtocolError,
	type ToolDefinition,
} from "@openbot/protocol";
import { evaluateCommand, type FolderAccess } from "./command-policy.ts";

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
	 * Settle a pending approval: the decision, and for `always_allow` the rule or grant it saves, are committed in one
	 * step before the call wakes. Returns false when it is not pending (already decided, or its Run ended). An
	 * `always_allow` scope must be one of the options the Host offered on this approval.
	 */
	async decide(approvalId: string, decision: ApprovalDecision): Promise<boolean> {
		const entry = this.#entries.get(approvalId);
		if (entry === undefined || entry.record.state !== "pending" || this.#closed) return false;
		const saved =
			typeof decision === "string"
				? undefined
				: { scope: offeredScope(entry.record, decision.scope), id: randomUUID(), createdAt: this.#now() };
		const record: ApprovalRecord = {
			...entry.record,
			state: decision === "deny" ? "denied" : "allowed",
			decision,
			decidedAt: this.#now(),
		};
		// Claimed before the commit, so a second click cannot decide twice.
		entry.record = record;
		await this.#requireStore().put(record, saved);
		this.#changed(record.botId);
		for (const waiter of entry.waiters) waiter(decision);
		entry.waiters.clear();
		return true;
	}

	/**
	 * Check every pending approval again after rules or grants changed (Section 5.3): one policy now allows runs as if
	 * allowed once, one it now refuses is denied, and the rest keep waiting with **Always allow** options recomputed
	 * from the current policy, so a card never offers a choice computed from rules or grants that no longer exist.
	 */
	async reevaluate(evaluate: (approval: PendingApproval) => Decision): Promise<void> {
		for (const entry of [...this.#entries.values()]) {
			if (entry.record.state !== "pending" || this.#closed) continue;
			const { state: _state, decision: _decision, decidedAt: _decidedAt, ...approval } = entry.record;
			const verdict = evaluate(approval);
			if (verdict.kind === "allow") {
				await this.decide(approval.approvalId, "allow_once");
			} else if (verdict.kind === "deny") {
				await this.decide(approval.approvalId, "deny");
			} else {
				const { alwaysAllowOptions: _options, ...rest } = entry.record;
				const record: ApprovalRecord = {
					...rest,
					reason: verdict.reason,
					...(verdict.alwaysAllowOptions === undefined ? {} : { alwaysAllowOptions: verdict.alwaysAllowOptions }),
				};
				if (JSON.stringify(record) === JSON.stringify(entry.record)) continue;
				entry.record = record;
				await this.#requireStore().put(record);
				this.#changed(record.botId);
			}
		}
	}

	/**
	 * The call's result is committed: its decided approval is used up. Calls without a decided approval are ignored,
	 * so the Host may report every settled call.
	 */
	async settled(botId: BotId, callId: string, conversationId?: string): Promise<void> {
		for (const [approvalId, { record }] of this.#entries) {
			if (
				record.botId !== botId ||
				record.callId !== callId ||
				(conversationId !== undefined && (record.conversationId ?? record.approvalId.split(":")[1]) !== conversationId) ||
				record.decision === undefined
			)
				continue;
			this.#entries.delete(approvalId);
			if (!this.#closed) await this.#requireStore().put({ ...record, state: "consumed" });
			return;
		}
	}

	forBot(botId: BotId, conversationId?: string): PendingApproval[] {
		return [...this.#entries.values()]
			.filter(
				(entry) =>
					entry.record.state === "pending" &&
					entry.record.botId === botId &&
					(conversationId === undefined || (entry.record.conversationId ?? entry.record.approvalId.split(":")[1]) === conversationId),
			)
			.map(({ record: { state: _state, decision: _decision, decidedAt: _decidedAt, ...approval } }) => approval)
			.sort((a, b) => a.createdAt - b.createdAt);
	}

	#requireStore(): ApprovalStore {
		if (this.#store === undefined) throw new Error("The approval book is not started");
		return this.#store;
	}
}

/** The offered option equal to `scope`; anything else is refused, so the renderer cannot widen what is saved. */
function offeredScope(approval: PendingApproval, scope: AlwaysAllowScope): AlwaysAllowScope {
	const key = (candidate: AlwaysAllowScope): string =>
		JSON.stringify(
			candidate.kind === "command"
				? [candidate.kind, candidate.rule.program, candidate.rule.subcommand ?? null, candidate.rule.exact ?? null]
				: [candidate.kind, candidate.path, candidate.access],
		);
	const offered = approval.alwaysAllowOptions?.find((option) => key(option.scope) === key(scope));
	if (offered === undefined) throw new ProtocolError("invalid_request", "This request does not offer that Always allow choice");
	return offered.scope;
}

export type PolicyCall = { readonly tool: string; readonly args: Readonly<Record<string, unknown>> };
export type Decision =
	| { readonly kind: "allow" }
	| { readonly kind: "ask"; readonly reason: string; readonly alwaysAllowOptions?: readonly AlwaysAllowOption[] }
	| { readonly kind: "deny"; readonly reason: string };

/** Everything `decide` reads, captured once per call: the user's command policy and the folder grants. */
export type PolicySnapshot = FolderAccess & {
	readonly commandSetting: CommandSetting;
	readonly readOnlyDefault: boolean;
	readonly rules: readonly CommandRule[];
	/** The default working directory of commands and base of relative paths. */
	readonly workspace: string;
};

/**
 * First-release policy (Section 5.3), in order: hard rules (a file tool needs a path), the command setting Never, an
 * allow rule, a grant, or the read-only default, then the capability default, which asks. File tools inside a grant
 * that allows their access run without asking; outside they ask, and the card offers to grant the containing folder or
 * one of its parents. Fetching public pages is allowed; the handler refuses private addresses itself. A Bot's own
 * memory is Host state the user can see and edit, so updating it is allowed.
 */
export function decide(call: PolicyCall, definition: ToolDefinition, policy: PolicySnapshot): Decision {
	switch (definition.capability) {
		case "commands": {
			if (policy.commandSetting === "never") return { kind: "deny", reason: "Commands are turned off in Settings" };
			if (policy.commandSetting === "allow") return { kind: "allow" };
			const command = typeof call.args.command === "string" ? call.args.command : "";
			const cwd = policy.resolve(typeof call.args.cwd === "string" ? call.args.cwd : ".", policy.workspace);
			const verdict = evaluateCommand(command, cwd, policy, policy);
			if (verdict.allowed) return { kind: "allow" };
			const reason = "Runs a command on this Mac";
			return verdict.options === undefined ? { kind: "ask", reason } : { kind: "ask", reason, alwaysAllowOptions: verdict.options };
		}
		case "files.read":
		case "files.write": {
			const path = typeof call.args.path === "string" ? call.args.path : undefined;
			if (path === undefined) return { kind: "deny", reason: "No path given" };
			const access: GrantAccess = definition.capability === "files.read" ? "read" : "readwrite";
			const canonical = policy.resolve(path, policy.workspace);
			if (policy.isGranted(canonical, access)) return { kind: "allow" };
			const verb = access === "read" ? "Reads" : "Changes";
			return {
				kind: "ask",
				reason: `${verb} a file outside the folders Bots may use`,
				alwaysAllowOptions: folderOptions(canonical, call.tool === "local_list", access),
			};
		}
		case "app.orchestrate":
		case "app.read":
			return { kind: "deny", reason: "Application access requires Core authorization" };
		case "collaboration":
   return {kind:"deny",reason:"Collaboration requires assigned task authority"};
		case "group.management":
			return { kind: "deny", reason: "Group management requires Core authorization" };
		case "bot.management":
			return { kind: "ask", reason: "Review this Bot change" };
		case "web":
		case "memory":
		// Reading or stopping a background command the user already approved.
		case "tasks":
			return { kind: "allow" };
	}
}

/**
 * Grant choices for a path, narrowest first: the containing folder (the path itself for `local_list`), then each
 * ancestor up to, not including, the filesystem root. The user picks one; there is no free text.
 */
function folderOptions(path: string, isFolder: boolean, access: GrantAccess): AlwaysAllowOption[] {
	const options: AlwaysAllowOption[] = [];
	for (let folder = isFolder ? path : dirname(path); dirname(folder) !== folder; folder = dirname(folder)) {
		options.push({ label: `${access === "read" ? "Read" : "Read and write"} ${folder}`, scope: { kind: "folder", path: folder, access } });
	}
	return options;
}
