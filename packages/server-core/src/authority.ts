/** Serializes short authority changes with dispatch admission; never holds the line while a command runs. */
import { join } from "node:path";
import type { AuthoritySnapshot, BotRuntime } from "@openbot/agent-runtime";
import { type ApprovalBinding, type PendingApproval, type ToolOutcome, ProtocolError, toolDefinition } from "@openbot/protocol";
import type { ApprovalBook } from "./approvals.ts";
import { decide } from "./approvals.ts";
import { matchesAsk } from "./ask-first.ts";
import { canonicalPath, grantLists, isWithin, loadPolicy } from "./policy.ts";

type Call = {
	botId: string;
	conversationId: string;
	callId: string;
	runId?: string;
	tool: string;
	args: Readonly<Record<string, unknown>>;
	signal: AbortSignal;
};
export type AuthorityExecutor = { synchronize: (revision: number) => Promise<void>; revoke: (ids: readonly string[]) => Promise<void> };
export class AuthorityCoordinator {
	#line: Promise<unknown> = Promise.resolve();
	#reconciling: Promise<void> | undefined;
	readonly #artifacts: string;
	readonly #runtime: BotRuntime;
	readonly #workspace: string;
	readonly #targetId: string;
	readonly #approvals: ApprovalBook;
	readonly #executor: AuthorityExecutor;
	readonly #interrupt: (ids: readonly string[], stop: () => Promise<void>) => Promise<void>;
	constructor(options: {
		dataDirectory: string;
		runtime: BotRuntime;
		workspace: string;
		targetId: string;
		approvals: ApprovalBook;
		executor: AuthorityExecutor;
		interrupt: (ids: readonly string[], stop: () => Promise<void>) => Promise<void>;
	}) {
		this.#artifacts = canonicalPath(join(options.dataDirectory, "artifacts"), options.workspace);
		this.#runtime = options.runtime;
		this.#workspace = options.workspace;
		this.#targetId = options.targetId;
		this.#approvals = options.approvals;
		this.#executor = options.executor;
		this.#interrupt = options.interrupt;
	}
	#serial<T>(fn: () => Promise<T>): Promise<T> {
		const result = this.#line.catch(() => {}).then(fn);
		this.#line = result;
		return result;
	}
	change<T>(fn: () => Promise<T>): Promise<T> {
		return this.#serial(fn);
	}
	async binding(call: Call, argsDigest: string): Promise<ApprovalBinding> {
		const run = call.runId ? await this.#runtime.runsStore().get(call.runId) : undefined;
		const trusted =
			run && run.botId === call.botId && (await this.#runtime.conversationKey(run.botId, run.channelId)) === call.conversationId;
		return {
			...(trusted ? { runId: run.runId } : {}),
			origin: trusted && run.origin === "user" ? "attended" : "unattended",
			argsDigest,
			revision: (await this.#runtime.policy().settings()).revision,
		};
	}
	async dispatch(
		call: Call,
		approved: boolean,
		binding: ApprovalBinding,
		invoke: (revision: number) => Promise<ToolOutcome>,
	): Promise<ToolOutcome> {
		const id = `${call.conversationId}:${call.callId}`;
		const admitted = await this.#serial(async () => {
			call.signal.throwIfAborted();
			const rejection = await this.#approvals.rejection(`approval:${id}`);
			if (rejection)
				throw new ProtocolError(
					rejection === "approval_expired"
						? "approval_expired"
						: rejection === "permission_revoked"
							? "permission_revoked"
							: "approval_denied",
					rejection,
				);
			const store = this.#runtime.policy(),
				policy = await loadPolicy(store, this.#workspace),
				definition = toolDefinition(call.tool);
			const pending = await store.pendingChange();
			if (pending && affected(pending.before, await store.snapshot(), call, this.#workspace))
				throw new ProtocolError("permission_revoked", "permission_revoked: reconciliation is pending");
			if (call.runId) {
				const run = await this.#runtime.runsStore().get(call.runId);
				if (!run || run.botId !== call.botId || run.interruption)
					throw new ProtocolError("permission_revoked", "permission_revoked: the Run was interrupted");
			}
			if (definition?.destination === "executor") {
				const verdict = decide(
					call,
					definition,
					call.tool === "local_read"
						? {
								...policy,
								isGranted: (path, access) => policy.isGranted(path, access) || (access === "read" && isWithin(path, this.#artifacts)),
							}
						: policy,
				);
				const approval: PendingApproval = {
					approvalId: `approval:${id}`,
					conversationId: call.conversationId,
					botId: call.botId,
					callId: call.callId,
					tool: call.tool,
					args: call.args,
					target: { kind: "local", targetId: this.#targetId },
					createdAt: 0,
					reason: "",
					binding: { ...binding, revision: policy.revision ?? 0 },
				};
				if (verdict.kind === "deny" || (verdict.kind === "ask" && (!approved || !(await this.#approvals.authorized(approval)))))
					throw new ProtocolError("permission_revoked", "permission_revoked: approval authority changed");
			}
			// A second transaction checks the revision after asynchronous approval reads.
			await store.remember({
				id,
				botId: call.botId,
				conversationId: call.conversationId,
				...(call.runId ? { runId: call.runId } : {}),
				tool: call.tool,
				argsJson: JSON.stringify(call.args),
				revision: policy.revision ?? 0,
			});
			call.signal.throwIfAborted();
			// Invoking starts before the serial line is released, while its result remains outside the lock.
			return { outcome: invoke(policy.revision ?? 0) };
		});
		const outcome = await admitted.outcome;
		if (outcome.status !== "unknown") await this.#runtime.policy().forget(id, call.tool === "local_exec" ? outcome.taskId : undefined);
		if ((call.tool === "task_output" || call.tool === "task_stop") && outcome.exit) {
			for (const operation of await this.#runtime.policy().operations())
				if (operation.conversationId === call.conversationId && operation.taskId === call.args.taskId)
					await this.#runtime.policy().forget(operation.id);
		}
		return outcome;
	}
	reconcile(): Promise<void> {
		if (this.#reconciling) return this.#reconciling;
		const work = this.#reconcile()
			.catch(async (error) => {
				const pending = await this.#runtime.policy().pendingChange();
				if (pending) await this.#runtime.policy().settleChange(pending.reconciliation.id, false);
				throw error;
			})
			.finally(() => {
				this.#reconciling = undefined;
			});
		this.#reconciling = work;
		return work;
	}
	async #reconcile(): Promise<void> {
		const selected = await this.#serial(async () => {
			const store = this.#runtime.policy(),
				change = await store.pendingChange(),
				current = await store.snapshot();
			await this.#executor.synchronize(current.settings.revision);
			if (!change) return undefined;
			const operations = (await store.operations()).filter((operation) =>
				affected(change.before, current, { ...operation, args: JSON.parse(operation.argsJson) }, this.#workspace),
			);
			return { change, operations };
		});
		if (!selected) return;
		const { change, operations } = selected,
			ids = operations.map((o) => o.id),
			runs = [...new Set(operations.flatMap((o) => (o.runId ? [o.runId] : [])))];
		try {
			await this.#interrupt(runs, () => this.#executor.revoke(ids));
			for (const id of ids) await this.#runtime.policy().forget(id);
			await this.#runtime.policy().settleChange(change.reconciliation.id, true);
		} catch (error) {
			await this.#runtime.policy().settleChange(change.reconciliation.id, false);
			throw error;
		}
	}
}
/** Conservative shell dependencies: removing any folder authority can affect any shell descendant. */
export function affected(
	before: AuthoritySnapshot,
	after: AuthoritySnapshot,
	call: { tool: string; botId?: string; args: Readonly<Record<string, unknown>> },
	workspace: string,
): boolean {
	if (
		after.settings.askFirst.some((rule) => !before.settings.askFirst.some((old) => old.id === rule.id) && matchesAsk(rule, call, workspace))
	)
		return true;
	const folders = grantLists(after.grants, workspace);
	const current = {
		...after.settings,
		workspace,
		resolve: canonicalPath,
		isGranted: (path: string, access: "read" | "readwrite") =>
			folders.readwrite.some((root) => isWithin(path, root)) || (access === "read" && folders.read.some((root) => isWithin(path, root))),
	};
	if (call.tool === "local_exec") {
		if (before.grants.some((grant) => !after.grants.some((next) => next.id === grant.id && next.access === grant.access))) return true;
		if (after.settings.commandSetting === "never") return true;
		const removedAllow =
			before.settings.rules.some((rule) => !after.settings.rules.some((next) => next.id === rule.id)) ||
			(before.settings.commandSetting === "allow" && after.settings.commandSetting !== "allow") ||
			(before.settings.readOnlyDefault && !after.settings.readOnlyDefault);
		return removedAllow && decide(call, toolDefinition(call.tool)!, current).kind !== "allow";
	}
	if (["artifact_publish", "local_read", "local_list", "local_write", "local_edit"].includes(call.tool) && typeof call.args.path === "string") {
		const path = canonicalPath(call.args.path, workspace),
			write = call.tool === "local_write" || call.tool === "local_edit";
		return (
			before.grants.some((grant) => isWithin(path, grant.path) && (!write || grant.access === "readwrite")) &&
			!current.isGranted(path, write ? "readwrite" : "read")
		);
	}
	return false;
}
