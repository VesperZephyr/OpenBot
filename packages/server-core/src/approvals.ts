/**
 * Pending approvals and the first-release policy. Both implement Tool Router ports, which `apps/local-server` wires.
 *
 * Demo scope: approvals live in memory, so a Host restart while one is pending loses it and Pi reruns the call, which
 * asks again. Persisting them (Section 5.3) is backlog work in docs/technical-plan.md.
 */
import type { ApprovalDecision, BotId, PendingApproval, ToolDefinition } from "@openbot/protocol";

type Waiter = { readonly approval: PendingApproval; readonly resolve: (decision: ApprovalDecision) => void };

export class ApprovalBook {
	readonly #pending = new Map<string, Waiter>();
	readonly #changed: (botId: BotId) => void;

	/** `changed` runs whenever a Bot's pending approvals change, so its conversation can be republished. */
	constructor(changed: (botId: BotId) => void) {
		this.#changed = changed;
	}

	/** Record an approval and wait for the user. Asking again for the same ID joins the existing request. */
	request(approval: PendingApproval, signal: AbortSignal): Promise<ApprovalDecision> {
		signal.throwIfAborted();
		const existing = this.#pending.get(approval.approvalId);
		const { promise, resolve, reject } = Promise.withResolvers<ApprovalDecision>();
		const previous = existing?.resolve;
		this.#pending.set(approval.approvalId, {
			approval: existing?.approval ?? approval,
			resolve: (decision) => {
				previous?.(decision);
				resolve(decision);
			},
		});
		// Cancelling the Run withdraws the request: nothing is left for the user to answer.
		signal.addEventListener(
			"abort",
			() => {
				if (this.#pending.delete(approval.approvalId)) this.#changed(approval.botId);
				reject(signal.reason);
			},
			{ once: true },
		);
		if (existing === undefined) this.#changed(approval.botId);
		return promise;
	}

	/** Settle a pending approval. Returns false when it no longer exists (already decided, or its Run ended). */
	decide(approvalId: string, decision: ApprovalDecision): boolean {
		const waiter = this.#pending.get(approvalId);
		if (waiter === undefined) return false;
		this.#pending.delete(approvalId);
		waiter.resolve(decision);
		this.#changed(waiter.approval.botId);
		return true;
	}

	forBot(botId: BotId): PendingApproval[] {
		return [...this.#pending.values()]
			.map((waiter) => waiter.approval)
			.filter((approval) => approval.botId === botId)
			.sort((a, b) => a.createdAt - b.createdAt);
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
 * always ask. Fetching public pages is allowed; the handler refuses private addresses itself.
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
			return { kind: "allow" };
	}
}
