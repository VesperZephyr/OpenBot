import { validAppInput } from "@openbot/protocol/app-validation";
/**
 * Every model-selected tool call enters here. The router binds the call to the local target, asks the policy port for a
 * decision, waits for the user when policy asks, and dispatches to the executor or a host handler. It depends only on
 * `@openbot/protocol`; application state is reached through the ports below.
 */
import { createHash } from "node:crypto";
import {
	APP_CODE_LIMITS, CODEMODE_DEFINITION, appToolCapability,
	type ApprovalDecision,
	type ExecutionTarget,
	type ExecutorToolName,
	type PendingApproval,
	type ToolDefinition,
	type ToolInvocation,
	type ToolOutcome,
	toolDefinition,
} from "@openbot/protocol";

export type ToolCall = {
	readonly runId?: string;
	readonly collaboration?: { readonly runId: string };
	readonly authority?: import("@openbot/protocol").ManagementAuthority;
	readonly appExecutionId?: string;
	readonly appAuthority?: import("@openbot/protocol").AppReadAuthority;
	readonly target?: ExecutionTarget;
	readonly botId: string;
	readonly conversationId: string;
	/** Stable across reruns of the same Pi tool task, so a rerun never becomes a second invocation. */
	readonly callId: string;
	readonly tool: string;
	readonly args: Readonly<Record<string, unknown>>;
	readonly signal: AbortSignal;
	readonly onProgress: (output: string) => void;
};

export type PolicyDecision =
	| { readonly kind: "allow" }
	| { readonly kind: "ask"; readonly reason: string; readonly alwaysAllowOptions?: PendingApproval["alwaysAllowOptions"] }
	| { readonly kind: "deny"; readonly reason: string };

export interface PolicyPort {
	decide(call: ToolCall, definition: ToolDefinition): Promise<PolicyDecision>;
	/**
	 * Folders file tools may touch for this call once it is allowed, read from the current grants: `readwrite` folders
	 * (the workspace included) and `read`-only ones, plus the path of an approved one-off call.
	 */
	grants(call: ToolCall, approvedOnce: boolean): Promise<{ readonly readwrite: readonly string[]; readonly read: readonly string[] }>;
}

/** Pending approvals: recorded before the call waits, settled by the user, observed by the UI. */
export interface ApprovalPort {
	request(approval: PendingApproval, signal: AbortSignal): Promise<ApprovalDecision>;
}

export interface ExecutorTransport {
	invoke(invocation: ToolInvocation, onProgress: (output: string) => void, signal: AbortSignal): Promise<ToolOutcome>;
}

/** `call` identifies the Bot and conversation, for handlers whose state is per Bot, such as memory. */
export type HostToolHandler = (args: Readonly<Record<string, unknown>>, signal: AbortSignal, call: ToolCall) => Promise<ToolOutcome>;

export type ToolRouterOptions = {
	readonly target: ExecutionTarget;
	readonly policy: PolicyPort;
	readonly approvals: ApprovalPort;
	readonly executor: ExecutorTransport;
	readonly hostTools: Readonly<Record<string, HostToolHandler>>;
	readonly now?: () => number;
	/** How long an executor invocation may take before the executor refuses to start it. */
	readonly deadlineMs?: number;
};

export class ToolRouter {
	readonly #options: ToolRouterOptions;
	/** One active call per Run: Pi already runs tools sequentially; this is the second gate. */
	readonly #active = new Map<string, Promise<unknown>>();

	constructor(options: ToolRouterOptions) {
		this.#options = options;
	}

	/** Parent admission deliberately does not take the leaf mutex. */
	async admitOrchestration(call: ToolCall): Promise<ExecutionTarget> {
		call.signal.throwIfAborted();
		if (call.tool !== "codemode" || Object.keys(call.args).join() !== "code" || typeof call.args.code !== "string" || !call.args.code.trim() || Buffer.byteLength(call.args.code) > APP_CODE_LIMITS.sourceBytes || this.#options.target.kind !== "local" || (call.target && (call.target.kind !== "local" || call.target.targetId !== this.#options.target.targetId))) throw new Error("Code Mode is not authorized");
		const decision = await this.#options.policy.decide({...call,target:this.#options.target}, CODEMODE_DEFINITION);
		call.signal.throwIfAborted();
		if (decision.kind !== "allow") throw new Error("Code Mode is not authorized");
		return this.#options.target;
	}

	async invoke(call: ToolCall): Promise<ToolOutcome> {
		const previous = this.#active.get(call.conversationId) ?? Promise.resolve();
		const current = previous.catch(() => {}).then(() => this.#route(call));
		this.#active.set(call.conversationId, current);
		try {
			return await current;
		} finally {
			if (this.#active.get(call.conversationId) === current) this.#active.delete(call.conversationId);
		}
	}

	async #route(call: ToolCall): Promise<ToolOutcome> {
		const app = appToolCapability(call.tool);
		if (app && call.signal.aborted) return appFailure("cancelled", "Application read was cancelled");
		call.signal.throwIfAborted();
		if (this.#options.target.kind !== "local" || (call.target && (call.target.kind !== "local" || call.target.targetId !== this.#options.target.targetId))) return app ? appFailure("permission_denied", "Application access is not authorized") : {status:"failed",output:"Application target is not authorized"};
		call = {...call, target:this.#options.target};
		if (app && !validAppInput(app.id,call.args)) return appFailure("invalid_request", "Invalid application arguments");
		const definition = toolDefinition(call.tool);
		if (definition === undefined) return { status: "failed", output: `Unknown tool: ${call.tool}` };
		const decision = await this.#options.policy.decide(call, definition);
		if (decision.kind === "deny") return app ? appFailure("permission_denied", "Application access is not authorized") : { status: "failed", output: `Not allowed: ${decision.reason}` };

		let approvedOnce = false;
		if (decision.kind === "ask") {
			const now = this.#options.now ?? Date.now;
			const verdict = await this.#options.approvals.request(
				{
					// The call ID makes the approval stable across reruns: a rerun waits on the same approval.
					approvalId: `approval:${call.conversationId}:${call.callId}`,
					conversationId: call.conversationId,
					botId: call.botId,
					callId: call.callId,
					tool: call.tool,
					args: call.args,
					target: this.#options.target,
					reason: decision.reason,
					createdAt: now(),
					...(decision.alwaysAllowOptions === undefined ? {} : { alwaysAllowOptions: decision.alwaysAllowOptions }),
				},
				call.signal,
			);
			if (verdict === "deny") {
				return { status: "failed", output: "The user denied this action. Do not retry it unchanged; ask or try another way." };
			}
			approvedOnce = true;
		}
		if (app && call.signal.aborted) return appFailure("cancelled", "Application read was cancelled");
		call.signal.throwIfAborted();

		if (definition.destination === "host") {
			const handler = this.#options.hostTools[definition.name];
			if (handler === undefined) return { status: "failed", output: `No handler for ${definition.name}` };
			return handler(call.args, call.signal, call);
		}
		const grants = await this.#options.policy.grants(call, approvedOnce);
		const invocation: ToolInvocation = {
			...(call.runId ? { runId: call.runId } : {}),
			invocationId: `${call.conversationId}:${call.callId}`,
			botId: call.botId,
			conversationId: call.conversationId,
			tool: definition.name as ExecutorToolName,
			args: call.args,
			argsDigest: digest(call.args),
			target: this.#options.target,
			grants: grants.readwrite,
			readGrants: grants.read,
			deadline: (this.#options.now ?? Date.now)() + (this.#options.deadlineMs ?? 60_000),
		};
		return this.#options.executor.invoke(invocation, call.onProgress, call.signal);
	}
}

function appFailure(code: import("@openbot/protocol").AppErrorCode, message: string): ToolOutcome {
	const value = {ok: false as const, error: {code, message}};
	return {status: code === "cancelled" ? "cancelled" : "failed", output: JSON.stringify(value), value};
}

/** SHA-256 of canonical JSON (sorted keys), shared by router and executor to detect a reused ID with other arguments. */
export function digest(value: unknown): string {
	return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value !== null && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, entry]) => entry !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
	}
	return JSON.stringify(value);
}
