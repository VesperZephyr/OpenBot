import { normalizeAsk } from "./ask-first.ts";
/**
 * Host methods for command policy and folder grants. Every change re-checks pending approvals against the new policy
 * (Section 5.3): revoking a grant or deleting a rule can never leave a card whose **Always allow** options came from
 * the old policy, and a change that now allows or forbids a waiting call settles it.
 */
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { BotRuntime } from "@openbot/agent-runtime";
import { type FolderGrant, type GrantAccess, type HostParams, type PolicySettings, ProtocolError, toolDefinition } from "@openbot/protocol";
import { type ApprovalBook, decide } from "./approvals.ts";
import { canonicalPath, loadPolicy } from "./policy.ts";

export class PolicyService {
	readonly #runtime: BotRuntime;
	readonly #approvals: ApprovalBook;
	readonly #workspace: string;
	readonly #now: () => number;
	readonly #reconcile: () => Promise<void>;
	readonly #change: <T>(fn: () => Promise<T>) => Promise<T>;

	constructor(options: {
		runtime: BotRuntime;
		approvals: ApprovalBook;
		workspace: string;
		now: () => number;
		reconcile?: () => Promise<void>;
		change?: <T>(fn: () => Promise<T>) => Promise<T>;
	}) {
		this.#runtime = options.runtime;
		this.#approvals = options.approvals;
		this.#workspace = options.workspace;
		this.#now = options.now;
		this.#change = options.change ?? ((fn) => fn());
		this.#reconcile =
			options.reconcile ??
			(async () => {
				const change = await this.#runtime.policy().pendingChange();
				if (change) await this.#runtime.policy().settleChange(change.reconciliation.id, true);
			});
	}

	get(): Promise<PolicySettings> {
		return this.#runtime.policy().settings();
	}

	async update(change: HostParams<"policy.update">): Promise<PolicySettings> {
		await this.#change(() => this.#runtime.policy().update(change));
		return this.reconcile();
	}

	async deleteRule(id: string): Promise<PolicySettings> {
		if (!(await this.#change(() => this.#runtime.policy().deleteRule(id))))
			throw new ProtocolError("not_found", "This rule no longer exists");
		await this.reconcile();
		return this.get();
	}

	grants(): Promise<readonly FolderGrant[]> {
		return this.#runtime.policy().grants();
	}

	async revoke(id: string): Promise<readonly FolderGrant[]> {
		if (!(await this.#change(() => this.#runtime.policy().revokeGrant(id))))
			throw new ProtocolError("not_found", "This folder is no longer granted");
		await this.reconcile();
		return this.grants();
	}

	/** `path` comes from Desktop main's native folder picker, never from the renderer; it must be an existing folder. */
	async add(path: string, access: GrantAccess): Promise<readonly FolderGrant[]> {
		if (!isAbsolute(path)) throw new ProtocolError("invalid_request", "A granted folder needs an absolute path");
		const canonical = canonicalPath(path, this.#workspace);
		const info = await stat(canonical).catch(() => undefined);
		if (info?.isDirectory() !== true) throw new ProtocolError("invalid_request", `${canonical} is not a folder`);
		await this.#change(() => this.#runtime.policy().addGrant({ id: randomUUID(), path: canonical, access, createdAt: this.#now() }));
		await this.reconcile();
		return this.grants();
	}

	async createAsk(input: HostParams<"policy.ask.create">): Promise<PolicySettings> {
		const { requestId, expectedRevision, ...scope } = input;
		if (scope.botId) {
			const bot = await this.#runtime.getBot(scope.botId);
			if (!bot || bot.status === "deleted") throw new ProtocolError("not_found", "This Bot no longer exists");
		}
		const settings = await this.get();
		if (!settings.targetId) throw new ProtocolError("invalid_request", "Policy has no local target");
		await this.#change(() =>
			this.#runtime
				.policy()
				.createAsk(
					{
						...normalizeAsk(scope, this.#workspace),
						id: randomUUID(),
						targetId: settings.targetId!,
						revision: expectedRevision + 1,
						createdAt: this.#now(),
					},
					requestId,
					expectedRevision,
				),
		);
		await this.reconcile();
		return this.get();
	}
	async deleteAsk(input: HostParams<"policy.ask.delete">): Promise<PolicySettings> {
		await this.#change(() => this.#runtime.policy().deleteAsk(input.id, input.requestId, input.expectedRevision));
		await this.reconcile();
		return this.get();
	}
	async reconcile(): Promise<PolicySettings> {
		await this.#reconcile();
		await this.reevaluate();
		return this.get();
	}

	/** Decide every pending approval again under the current policy. */
	async reevaluate(): Promise<void> {
		const policy = await loadPolicy(this.#runtime.policy(), this.#workspace);
		await this.#approvals.reevaluate((approval) => {
			const definition = toolDefinition(approval.tool);
			if (definition === undefined) return { kind: "deny", reason: `Unknown tool: ${approval.tool}` };
			if (definition.destination !== "executor")
				return {
					kind: "ask",
					reason: approval.reason,
					...(approval.alwaysAllowOptions ? { alwaysAllowOptions: approval.alwaysAllowOptions } : {}),
				};
			const args = typeof approval.args === "object" && approval.args !== null ? (approval.args as Record<string, unknown>) : {};
			return decide({ tool: approval.tool, args, botId: approval.botId }, definition, policy);
		}, policy.revision);
	}
}
