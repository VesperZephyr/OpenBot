import { validAppInput, validManagementInput, validManagementOutput } from "@openbot/protocol/app-validation";
/**
 * Every model-selected tool call enters here. The router binds the call to the local target, asks the policy port for a
 * decision, waits for the user when policy asks, and dispatches to the executor or a host handler. It depends only on
 * `@openbot/protocol`; application state is reached through the ports below.
 */
import { createHash } from "node:crypto";
import {
	appManagementCapability,
	APP_CODE_LIMITS,
	CODEMODE_DEFINITION,
	appToolCapability,
	type ApprovalDecision,
 ProtocolError,
	type ExecutionTarget,
	type ExecutorToolName,
	type PendingApproval,
	type ToolDefinition,
	type ToolInvocation,
	type ToolOutcome,
	toolDefinition,
} from "@openbot/protocol";

export type ToolCall = {
 readonly connector?:import("@openbot/protocol").ConnectorBinding;
 readonly dispatchRevision?:number;
	readonly runId?: string;
	readonly collaboration?: { readonly runId: string };
	readonly authority?: import("@openbot/protocol").ManagementAuthority;
	readonly appExecutionId?: string;
	readonly executionDeadline?: number;
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
 binding?(call:ToolCall,argsDigest:string):Promise<import("@openbot/protocol").ApprovalBinding>;
 dispatch?(call:ToolCall,approved:boolean,binding:import("@openbot/protocol").ApprovalBinding,invoke:(revision:number)=>Promise<ToolOutcome>):Promise<ToolOutcome>;
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
 receipt?(invocationId:string,argsDigest:string,tool:string):Promise<ToolOutcome|undefined>;
	invoke(invocation: ToolInvocation, onProgress: (output: string) => void, signal: AbortSignal): Promise<ToolOutcome>;
}

/** `call` identifies the Bot and conversation, for handlers whose state is per Bot, such as memory. */
export type HostToolHandler = (args: Readonly<Record<string, unknown>>, signal: AbortSignal, call: ToolCall) => Promise<ToolOutcome>;

export type ToolRouterOptions = {
 readonly resolveTool?:(name:string)=>ToolDefinition|undefined;
	readonly assertCallAllowed?:(call:ToolCall)=>Promise<void>;
	readonly trackCommand?: {
		prepare:(call:ToolCall,argsDigest:string)=>Promise<boolean>;
		settle:(call:ToolCall,outcome:ToolOutcome)=>Promise<ToolOutcome>;
	};
	readonly assertExecutionAllowed?: () => void;
	readonly target: ExecutionTarget;
	readonly policy: PolicyPort;
	readonly approvals: ApprovalPort;
	readonly executor: ExecutorTransport;
	readonly hostTools: Readonly<Record<string, HostToolHandler>>;
	readonly now?: () => number;
	/** Persist the terminal management latch before releasing the conversation leaf queue. */
	readonly closeAppManagement?: (call: ToolCall) => Promise<void>;
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
		this.#options.assertExecutionAllowed?.();
		call.signal.throwIfAborted();
		if (
			call.tool !== "codemode" ||
			Object.keys(call.args).join() !== "code" ||
			typeof call.args.code !== "string" ||
			!call.args.code.trim() ||
			Buffer.byteLength(call.args.code) > APP_CODE_LIMITS.sourceBytes ||
			this.#options.target.kind !== "local" ||
			(call.target && (call.target.kind !== "local" || call.target.targetId !== this.#options.target.targetId))
		)
			throw new Error("Code Mode is not authorized");
		const decision = await this.#options.policy.decide({ ...call, target: this.#options.target }, CODEMODE_DEFINITION);
		call.signal.throwIfAborted();
		this.#options.assertExecutionAllowed?.();
		if (decision.kind !== "allow") throw new Error("Code Mode is not authorized");
		return this.#options.target;
	}

	async invoke(call: ToolCall): Promise<ToolOutcome> {
		const previous = this.#active.get(call.conversationId) ?? Promise.resolve();
		const current = previous
			.catch(() => {})
			.then(async () => {
				const management = !!appManagementCapability(call.tool);
				if (management && !this.#options.closeAppManagement)
					return appFailure("permission_denied", "Application management is not authorized");
				try {
					const outcome = await this.#route(call);
					if (management && outcome.status !== "succeeded" && !call.signal.aborted) await this.#options.closeAppManagement!(call);
					return outcome;
				} catch (error) {
					if (management && !call.signal.aborted) await this.#options.closeAppManagement!(call);
					if(error instanceof ProtocolError&&["approval_expired","permission_revoked","approval_denied"].includes(error.code))return {status:"failed" as const,output:error.message,failureReason:error.code as import("@openbot/protocol").ToolFailureReason};
     throw error;
				}
			});
		this.#active.set(call.conversationId, current);
		try {
			return await current;
		} finally {
			if (this.#active.get(call.conversationId) === current) this.#active.delete(call.conversationId);
		}
	}

	async #route(call: ToolCall): Promise<ToolOutcome> {
		this.#options.assertExecutionAllowed?.();
		const management = appManagementCapability(call.tool);
		const app = appToolCapability(call.tool);
		if (app && call.signal.aborted) return appFailure("cancelled", "Application read was cancelled");
		call.signal.throwIfAborted();
		if (
			this.#options.target.kind !== "local" ||
			(call.target && (call.target.kind !== "local" || call.target.targetId !== this.#options.target.targetId))
		)
			return app || management
				? appFailure("permission_denied", "Application access is not authorized")
				: { status: "failed", output: "Application target is not authorized" };
		call = { ...call, target: this.#options.target };
		if (app && !validAppInput(app.id, call.args)) return appFailure("invalid_request", "Invalid application arguments");
		if (management && !validManagementInput(management.id, call.args))
			return appFailure("invalid_request", "Invalid application arguments");
		const definition = toolDefinition(call.tool) ?? this.#options.resolveTool?.(call.tool);
		if (definition === undefined) return { status: "failed", output: `Unknown tool: ${call.tool}` };
		if(definition.destination==="executor"&&this.#options.executor.receipt){const receipt=await this.#options.executor.receipt(`${call.conversationId}:${call.callId}`,digest(call.connector?{args:call.args,connector:call.connector}:call.args),call.tool);if(receipt)return this.#options.trackCommand?.settle(call,receipt)??receipt;}
  const binding=await this.#options.policy.binding?.(call,digest(call.connector?{args:call.args,connector:call.connector}:call.args));
  const decision = await this.#options.policy.decide(call, definition);
		this.#options.assertExecutionAllowed?.();
		if (decision.kind === "deny")
			return app || management
				? appFailure("permission_denied", "Application access is not authorized")
				: { status: "failed", output: `Not allowed: ${decision.reason}` };

		let approvedOnce = false;
		if (decision.kind === "ask") {
			const now = this.#options.now ?? Date.now;
			const verdict = await this.#options.approvals.request(
				{
					// The call ID makes the approval stable across reruns: a rerun waits on the same approval.
					approvalId: `approval:${call.conversationId}:${call.callId}`,
     ...(binding?{binding}:{}),
					conversationId: call.conversationId,
					botId: call.botId,
					callId: call.callId,
					tool: call.tool,
					args: call.args,
					target: this.#options.target,
					reason: decision.reason,
					createdAt: now(),
					...(call.executionDeadline === undefined ? {} : { deadline: call.executionDeadline }),
					...(decision.alwaysAllowOptions === undefined ? {} : { alwaysAllowOptions: decision.alwaysAllowOptions }),
				},
				call.signal,
			);
			if (verdict === "deny") {
				return management
					? appFailure("permission_denied", "The user denied this management action. Do not retry it.")
					: { status: "failed", failureReason:"approval_denied", output: "The user denied this action. Do not retry it unchanged; ask or try another way." };
			}
			approvedOnce = true;
		}
		if (app && call.signal.aborted) return appFailure("cancelled", "Application read was cancelled");
		call.signal.throwIfAborted();

		this.#options.assertExecutionAllowed?.();
  const dispatch=(invoke:(revision?:number)=>Promise<ToolOutcome>)=>{
			const guarded=async(revision?:number)=>{await this.#options.assertCallAllowed?.(call);call.signal.throwIfAborted();return invoke(revision);};
			return binding&&this.#options.policy.dispatch?this.#options.policy.dispatch(call,approvedOnce,binding,guarded):guarded();
		};
		if (definition.destination === "host") {
			const handler = this.#options.hostTools[definition.name];
			if (handler === undefined) return { status: "failed", output: `No handler for ${definition.name}` };
			if (management) {
				const current = await this.#options.policy.decide(call, definition);
				if (current.kind === "deny") return appFailure("permission_denied", "Application management is not authorized");
				this.#options.assertExecutionAllowed?.();
				const outcome = await dispatch(revision=>handler(call.args, call.signal, {...call,...(revision===undefined?{}:{dispatchRevision:revision})}));
				if (outcome.status !== "succeeded")
					return appFailure(
						outcome.status === "unknown" ? "outcome_unknown" : "conflict",
						"Management operation failed. Inspect current state before a new proposal.",
					);
				let value;
				try {
					value = { ok: true as const, value: JSON.parse(outcome.output) };
				} catch {
					return appFailure("outcome_unknown", "Management outcome needs attention");
				}
				if (Buffer.byteLength(JSON.stringify(value)) > management.maxResultBytes)
					return appFailure("resource_limit", "Management result exceeds the size limit. The committed change is retained.");
				if (!validManagementOutput(management.id, value)) return appFailure("outcome_unknown", "Management outcome needs attention");
				return { ...outcome, output: JSON.stringify(value), value };
			}
			return dispatch(revision=>handler(call.args, call.signal, {...call,...(revision===undefined?{}:{dispatchRevision:revision})}));
		}
		const grants = await this.#options.policy.grants(call, approvedOnce);
		this.#options.assertExecutionAllowed?.();
		call.signal.throwIfAborted();
		const invocation: ToolInvocation = {
            ...(call.connector?{connector:call.connector}:{}),
			...(call.runId ? { runId: call.runId } : {}),
			invocationId: `${call.conversationId}:${call.callId}`,
			botId: call.botId,
			conversationId: call.conversationId,
			tool: definition.name as ExecutorToolName,
			args: call.args,
			argsDigest: digest(call.connector?{args:call.args,connector:call.connector}:call.args),
			target: this.#options.target,
			grants: grants.readwrite,
			readGrants: grants.read,
			deadline: (this.#options.now ?? Date.now)() + (this.#options.deadlineMs ?? 60_000),
		};
		const outcome=await dispatch(async revision=>{
			const completionTracking=call.tool==="local_exec" ? await this.#options.trackCommand?.prepare(call,invocation.argsDigest) : false;
			call.signal.throwIfAborted();this.#options.assertExecutionAllowed?.();
			return this.#options.executor.invoke({...invocation,...(completionTracking?{completionTracking:true}:{}),...(revision===undefined?{}:{authorityRevision:revision})},call.onProgress,call.signal);
		});
		return this.#options.trackCommand?.settle(call,outcome)??outcome;
	}
}

function appFailure(code: import("@openbot/protocol").AppErrorCode, message: string): ToolOutcome {
	const value = { ok: false as const, error: { code, message } };
	return { status: code === "cancelled" ? "cancelled" : "failed", output: JSON.stringify(value), value };
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
