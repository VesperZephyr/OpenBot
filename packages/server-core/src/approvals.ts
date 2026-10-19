import { matchesAsk } from "./ask-first.ts";
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

type Waiter = (decision?: ApprovalDecision, error?: Error) => void;
type Entry = { record: ApprovalRecord; readonly waiters: Set<Waiter>; withdrawing?: boolean; timer?: ReturnType<typeof setTimeout> };

export class ApprovalBook {
	readonly #changed: (botId: BotId) => void;
	readonly #now: () => number;
	readonly #entries = new Map<string, Entry>();
	#store: ApprovalStore | undefined;
	#closed = false;
	#line: Promise<unknown> = Promise.resolve();
	constructor(changed: (botId: BotId) => void, now: () => number = Date.now) {
		this.#changed = changed;
		this.#now = now;
	}
	#serial<T>(fn: () => Promise<T>): Promise<T> {
		const result = this.#line.catch(() => {}).then(fn);
		this.#line = result;
		return result;
	}
	async start(store: ApprovalStore): Promise<void> {
		this.#store = store;
		await store.prune(this.#now() - RETENTION_MS);
		for (const record of await store.pending()) {
			const entry: Entry = { record, waiters: new Set() };
			this.#entries.set(record.approvalId, entry);
			if (record.deadline !== undefined && record.deadline <= this.#now()) await this.#expire(entry);
			else {
				this.#arm(entry);
				this.#changed(record.botId);
			}
		}
	}
	close(): void {
		this.#closed = true;
		for (const entry of this.#entries.values()) if (entry.timer) clearTimeout(entry.timer);
	}
	async request(approval: PendingApproval, signal: AbortSignal): Promise<ApprovalDecision> {
		signal.throwIfAborted();
		const entry = await this.#serial(async () => {
			signal.throwIfAborted();
			let found = this.#entries.get(approval.approvalId);
			const stored = found?.record ?? (await this.#requireStore().get(approval.approvalId));
			if (stored) {
				if (!sameIdentity(stored, approval)) throw new ProtocolError("request_conflict", "Approval identity changed");
				if (["withdrawn", "revoked", "expired"].includes(stored.state)) throw approvalError(stored.state);
				// A deny remains terminal. Allows must still match current authority at dispatch.
				if (stored.decision !== "deny" && stored.binding && approval.binding && stored.binding.revision !== approval.binding.revision)
					throw approvalError("revoked");
			}
			if (!found) {
				const deadline =
					stored?.deadline ??
					(approval.binding?.origin === "unattended"
						? Math.min(approval.deadline ?? Infinity, approval.createdAt + 600000)
						: approval.deadline);
				const record: ApprovalRecord = stored ?? { ...approval, ...(deadline === undefined ? {} : { deadline }), state: "pending" };
				if (!stored) await this.#requireStore().put(record);
				found = { record, waiters: new Set() };
				this.#entries.set(approval.approvalId, found);
				this.#changed(approval.botId);
				this.#arm(found);
			}
			if (
				found.record.state !== "consumed" &&
				found.record.decision !== "deny" &&
				found.record.deadline !== undefined &&
				found.record.deadline <= this.#now()
			)
				await this.#expire(found);
			if (found.record.state === "expired") throw approvalError("expired");
			return found;
		});
		if (entry.record.decision !== undefined) return entry.record.decision;
		signal.throwIfAborted();
		return new Promise<ApprovalDecision>((resolve, reject) => {
			const waiter: Waiter = (decision, error) => {
				signal.removeEventListener("abort", abort);
				if (error) reject(error);
				else resolve(decision!);
			};
			const abort = () => {
				entry.waiters.delete(waiter);
				if (!this.#closed && !entry.waiters.size) entry.withdrawing = true;
				reject(signal.reason);
				void this.#serial(async () => {
					if (this.#closed || entry.waiters.size || entry.record.state !== "pending") return;
					await this.#terminal(entry, "withdrawn");
				}).catch(() => {});
			};
			entry.waiters.add(waiter);
			signal.addEventListener("abort", abort, { once: true });
			if (signal.aborted) abort();
			// A decision may have committed between admission and joining.
			else if (entry.record.decision !== undefined) {
				entry.waiters.delete(waiter);
				waiter(entry.record.decision);
			} else if (entry.record.state !== "pending") {
				entry.waiters.delete(waiter);
				waiter(undefined, approvalError(entry.record.state));
			}
		});
	}
	decide(id: string, decision: ApprovalDecision): Promise<boolean> {
		return this.#serial(() => this.#decide(id, decision));
	}
	async #decide(id: string, decision: ApprovalDecision): Promise<boolean> {
		const entry = this.#entries.get(id);
		if (!entry || entry.withdrawing || entry.record.state !== "pending" || this.#closed) return false;
		if (entry.record.deadline !== undefined && entry.record.deadline <= this.#now()) {
			await this.#expire(entry);
			return false;
		}
		const saved =
			typeof decision === "string"
				? undefined
				: { scope: offeredScope(entry.record, decision.scope), id: randomUUID(), createdAt: this.#now() };
		const record: ApprovalRecord = { ...entry.record, state: decision === "deny" ? "denied" : "allowed", decision, decidedAt: this.#now() };
		await this.#requireStore().put(record, saved);
		entry.record = (await this.#requireStore().get(id)) ?? record;
		if (entry.timer) clearTimeout(entry.timer);
		this.#changed(record.botId);
		for (const waiter of entry.waiters) waiter(decision);
		entry.waiters.clear();
		return true;
	}
	reevaluate(evaluate: (approval: PendingApproval) => Decision, revision?: number): Promise<void> {
		return this.#serial(async () => {
			for (const entry of this.#entries.values()) {
				if (entry.record.state !== "pending" || this.#closed) continue;
				if (entry.record.deadline !== undefined && entry.record.deadline <= this.#now()) {
					await this.#expire(entry);
					continue;
				}
				const verdict = evaluate(entry.record);
				const { alwaysAllowOptions: _old, ...rest } = entry.record;
				const record: ApprovalRecord = {
					...rest,
					...(rest.binding && revision !== undefined ? { binding: { ...rest.binding, revision } } : {}),
					...(verdict.kind === "ask"
						? { reason: verdict.reason, ...(verdict.alwaysAllowOptions ? { alwaysAllowOptions: verdict.alwaysAllowOptions } : {}) }
						: {}),
				};
				await this.#requireStore().put(record);
				entry.record = record;
				if (verdict.kind === "allow") await this.#decide(record.approvalId, "allow_once");
				else if (verdict.kind === "deny") await this.#decide(record.approvalId, "deny");
				else this.#changed(record.botId);
			}
		});
	}

	async rejection(id: string): Promise<string | undefined> {
		const record = await this.#requireStore().get(id);
		if (!record) return undefined;
		if (record.decision === "deny") return "The user denied this action. Do not retry it unchanged.";
		if (["expired", "withdrawn", "revoked"].includes(record.state))
			return record.state === "expired" ? "approval_expired" : "permission_revoked";
		if (record.deadline !== undefined && record.deadline <= this.#now() && record.state !== "consumed") {
			await this.#serial(async () => {
				const entry = this.#entries.get(id);
				if (entry) await this.#expire(entry);
				else await this.#requireStore().put({ ...record, state: "expired", decidedAt: this.#now() });
			});
			return "approval_expired";
		}
		return undefined;
	}
	/** Exact current decision, checked after asynchronous grants preparation. */
	async authorized(approval: PendingApproval): Promise<boolean> {
		const record = await this.#requireStore().get(approval.approvalId);
		return (
			!!record &&
			sameIdentity(record, approval) &&
			["allowed", "consumed"].includes(record.state) &&
			record.decision !== "deny" &&
			record.decision !== undefined &&
			record.binding?.revision === approval.binding?.revision &&
			(record.deadline === undefined || record.deadline > this.#now())
		);
	}
	settled(botId: BotId, callId: string, conversationId?: string): Promise<void> {
		return this.#serial(async () => {
			for (const [id, entry] of this.#entries) {
				const r = entry.record;
				if (
					r.botId !== botId ||
					r.callId !== callId ||
					(conversationId !== undefined && (r.conversationId ?? r.approvalId.split(":")[1]) !== conversationId) ||
					r.decision === undefined
				)
					continue;
				if (!this.#closed) await this.#requireStore().put({ ...r, state: "consumed" });
				if (entry.timer) clearTimeout(entry.timer);
				this.#entries.delete(id);
				return;
			}
		});
	}
	forBot(botId: BotId, conversationId?: string): PendingApproval[] {
		return [...this.#entries.values()]
			.filter(
				({ record: r, withdrawing }) =>
					!withdrawing &&
					r.state === "pending" &&
					r.botId === botId &&
					(conversationId === undefined || (r.conversationId ?? r.approvalId.split(":")[1]) === conversationId),
			)
			.map(({ record: { state: _s, decision: _d, decidedAt: _at, ...r } }) => r)
			.sort((a, b) => a.createdAt - b.createdAt);
	}
	#arm(entry: Entry): void {
		if (entry.record.state !== "pending" || entry.record.deadline === undefined) return;
		entry.timer = setTimeout(
			() => {
				void this.#serial(() => this.#expire(entry)).catch(() => {});
			},
			Math.max(0, entry.record.deadline - this.#now()),
		);
		entry.timer.unref?.();
	}
	async #expire(entry: Entry): Promise<void> {
		if (entry.record.state === "consumed" || entry.record.decision === "deny" || this.#closed) return;
		if (entry.record.deadline !== undefined && entry.record.deadline > this.#now()) {
			this.#arm(entry);
			return;
		}
		await this.#terminal(entry, "expired");
	}
	async #terminal(entry: Entry, state: "withdrawn" | "expired" | "revoked"): Promise<void> {
		const record: ApprovalRecord = { ...entry.record, state, decidedAt: this.#now() };
		await this.#requireStore().put(record);
		entry.record = record;
		if (entry.timer) clearTimeout(entry.timer);
		this.#changed(record.botId);
		for (const waiter of entry.waiters) waiter(undefined, approvalError(state));
		entry.waiters.clear();
	}
	#requireStore(): ApprovalStore {
		if (!this.#store) throw new Error("The approval book is not started");
		return this.#store;
	}
}
function approvalError(state: string): Error {
	return new ProtocolError(
		state === "expired" ? "approval_expired" : "permission_revoked",
		state === "expired" ? "approval_expired" : state === "revoked" ? "permission_revoked" : "Approval was withdrawn; start a new request",
	);
}
function sameIdentity(a: PendingApproval, b: PendingApproval): boolean {
	return (
		a.approvalId === b.approvalId &&
		a.callId === b.callId &&
		a.botId === b.botId &&
		a.conversationId === b.conversationId &&
		a.tool === b.tool &&
		a.target.kind === b.target.kind &&
		a.target.targetId === b.target.targetId &&
		canonical(a.args) === canonical(b.args) &&
		a.binding?.runId === b.binding?.runId &&
		a.binding?.origin === b.binding?.origin &&
		a.binding?.argsDigest === b.binding?.argsDigest
	);
}
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object")
		return `{${Object.entries(value)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
			.join(",")}}`;
	return JSON.stringify(value);
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

export type PolicyCall = { readonly botId?: string; readonly tool: string; readonly args: Readonly<Record<string, unknown>> };
export type Decision =
	| { readonly kind: "allow" }
	| { readonly kind: "ask"; readonly reason: string; readonly alwaysAllowOptions?: readonly AlwaysAllowOption[] }
	| { readonly kind: "deny"; readonly reason: string };

/** Everything `decide` reads, captured once per call: the user's command policy and the folder grants. */
export type PolicySnapshot = FolderAccess & {
	readonly revision?: number;
	readonly askFirst?: readonly import("@openbot/protocol").AskFirstRule[];
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
			if (policy.askFirst?.some((rule) => matchesAsk(rule, call, policy.workspace)))
				return { kind: "ask", reason: "An Ask first rule requires confirmation" };
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
			if (policy.isGranted(canonical, access))
				return policy.askFirst?.some((rule) => matchesAsk(rule, call, policy.workspace))
					? { kind: "ask", reason: "An Ask first rule requires confirmation" }
					: { kind: "allow" };
			const verb = access === "read" ? "Reads" : "Changes";
			return {
				kind: "ask",
				reason: `${verb} a file outside the folders Bots may use`,
				alwaysAllowOptions: folderOptions(canonical, call.tool === "local_list", access),
			};
		}
		case "skills": return {kind:"deny",reason:"Skills require Host authorization"};
		case "app.orchestrate":
		case "app.read":
			return { kind: "deny", reason: "Application access requires Core authorization" };
		case "collaboration":
			return { kind: "deny", reason: "Collaboration requires assigned task authority" };
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
