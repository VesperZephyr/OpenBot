import { randomUUID } from "node:crypto";
/**
 * The Host's connection to the local executor process: starts it, checks its handshake against the bound target, and
 * correlates invocations with results. Implements Tool Router's `ExecutorTransport`.
 */
import { type ChildProcess, spawn } from "node:child_process";
import type { ExecutorMessage, ExecutorRequest, ToolInvocation, ToolOutcome } from "@openbot/protocol";
import type { ExecutorTransport } from "@openbot/tool-router";

type Pending = { readonly resolve: (outcome: ToolOutcome) => void; readonly onProgress: (output: string) => void };
type StatusReply = Extract<ExecutorMessage, { kind: "tool.status" }>;

export class ExecutorProcess implements ExecutorTransport {
	readonly #entry: string;
	readonly #env: NodeJS.ProcessEnv;
	readonly #targetId: string;
	readonly #assertAllowed: () => void;
	readonly #pending = new Map<string, Pending>();
	readonly #statusWaiters = new Map<string, ((reply: StatusReply) => void)[]>();
	readonly #controls=new Map<string,{resolve:()=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 #child: ChildProcess | undefined;
	#ready: Promise<void> | undefined;
	#quiescence:
		| { id: string; promise: Promise<void>; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
		| undefined;

	constructor(options: {
		entry: string;
		targetId: string;
		workspace: string;
		dataDirectory: string;
		env: NodeJS.ProcessEnv;
		assertAllowed?: () => void;
	}) {
		this.#entry = options.entry;
		this.#assertAllowed = options.assertAllowed ?? (() => {});
		this.#targetId = options.targetId;
		// The data directory is passed explicitly: the Host may have resolved a default its own environment lacks.
		this.#env = {
			...options.env,
			OPENBOT_TARGET_ID: options.targetId,
			OPENBOT_WORKSPACE: options.workspace,
			OPENBOT_DATA_DIR: options.dataDirectory,
		};
	}

	/**
	 * Start the executor and wait for its handshake. Part of the recovery gate: opening its ledger turns invocations a
	 * previous executor left unfinished into `unknown` before Pi reruns their calls.
	 */
	start(): Promise<void> {
		return this.#start();
	}

	async invoke(invocation: ToolInvocation, onProgress: (output: string) => void, signal: AbortSignal): Promise<ToolOutcome> {
		await this.#start();
  if(invocation.authorityRevision!==undefined)await this.synchronize(invocation.authorityRevision);
		// The Run may have been stopped while the router or the start awaited: nothing was sent, so nothing runs.
		signal.throwIfAborted();
		this.#assertAllowed();
		const child = this.#child;
		if (child === undefined || !child.connected) return { status: "failed", output: "The local executor is not running" };
		const { promise, resolve } = Promise.withResolvers<ToolOutcome>();
		this.#pending.set(invocation.invocationId, { resolve, onProgress });
		const cancel = (): void => this.#send({ kind: "tool.cancel", invocationId: invocation.invocationId });
		signal.addEventListener("abort", cancel, { once: true });
		this.#send({ kind: "tool.invoke", invocation });
		try {
			return await promise;
		} finally {
			signal.removeEventListener("abort", cancel);
		}
	}

 async #control(message:Extract<ExecutorRequest,{kind:"policy.sync"|"execution.revoke"}>):Promise<void>{
  await this.#start();const waiting=Promise.withResolvers<void>();
  const timer=setTimeout(()=>{this.#controls.delete(message.messageId);waiting.reject(new Error("Permission reconciliation needs attention"));},10000);
  this.#controls.set(message.messageId,{resolve:waiting.resolve,reject:waiting.reject,timer});this.#send(message);return waiting.promise;
 }
 synchronize(revision:number):Promise<void>{return this.#control({kind:"policy.sync",messageId:randomUUID(),targetId:this.#targetId,revision});}
 revoke(invocationIds:readonly string[]):Promise<void>{return this.#control({kind:"execution.revoke",messageId:randomUUID(),targetId:this.#targetId,invocationIds});}

	async quiesce(): Promise<void> {
		await this.#start();
		if (this.#quiescence) return this.#quiescence.promise;
		const waiting = Promise.withResolvers<void>(),
			id = randomUUID();
		const timer = setTimeout(() => {
			this.#quiescence = undefined;
			waiting.reject(new Error("Executor stop could not be confirmed"));
		}, 10000);
		this.#quiescence = { id, ...waiting, timer };
		this.#send({ kind: "execution.quiesce", messageId: id, targetId: this.#targetId });
		return waiting.promise;
	}

	/** The Host committed the invocation's outcome; the executor may prune its receipt later. */
	ack(invocationId: string): void {
		this.#send({ kind: "result.ack", invocationId });
	}

	/** Stop background commands for one Run, or the whole conversation when no Run is specified. */
	stopTasks(conversationId: string, runId?: string): void {
		this.#send({ kind: "tasks.stop", conversationId, ...(runId ? { runId } : {}) });
	}

	/** Read-only receipt lookup, for diagnostics. */
	async status(invocationId: string): Promise<StatusReply> {
		await this.#start();
		const { promise, resolve } = Promise.withResolvers<StatusReply>();
  const settle=(reply:StatusReply)=>{clearTimeout(timer);resolve(reply);};
  const timer=setTimeout(()=>{this.#statusWaiters.set(invocationId,(this.#statusWaiters.get(invocationId)??[]).filter(waiter=>waiter!==settle));resolve({kind:"tool.status",invocationId,status:"unknown",outcome:{status:"unknown",output:"The executor did not confirm this invocation's receipt"}});},10000);
		this.#statusWaiters.set(invocationId, [...(this.#statusWaiters.get(invocationId) ?? []), settle]);
		this.#send({ kind: "tool.status", invocationId });
		return promise;
	}

 async receipt(id:string,argsDigest:string,tool:string):Promise<ToolOutcome|undefined>{
  const result=await this.status(id);
  if(result.status==="absent"||result.status==="accepted"||!result.outcome)return undefined;
  if(result.status==="unknown"&&result.argsDigest===undefined)return result.outcome;
  if(result.argsDigest!==argsDigest||result.tool!==tool)return {status:"failed",output:"Refused: invocation identity changed"};
  return result.outcome;
 }

	async stop(): Promise<void> {
		const child = this.#child;
		if (child === undefined || child.exitCode !== null) return;
		const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
		if (child.connected) child.disconnect();
		const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
		await exited;
		clearTimeout(timer);
	}

	#start(): Promise<void> {
		if (this.#ready !== undefined && this.#child?.connected === true) return this.#ready;
		const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", this.#entry], {
			stdio: ["ignore", "inherit", "inherit", "ipc"],
			env: this.#env,
		});
		this.#child = child;
		const { promise, resolve, reject } = Promise.withResolvers<void>();
		child.on("message", (message: ExecutorMessage) => {
			if (this.#child !== child) return;
			if(message.kind==="policy.synced"||message.kind==="execution.quiesced"){
    const control=this.#controls.get(message.messageId);if(control){clearTimeout(control.timer);this.#controls.delete(message.messageId);if(message.confirmed)control.resolve();else control.reject(new Error("Permission reconciliation needs attention"));return;}
   }
   switch (message.kind) {
				case "execution.quiesced": {
					const pending = this.#quiescence;
					if (pending?.id !== message.messageId) return;
					this.#quiescence = undefined;
					clearTimeout(pending.timer);
					if (message.confirmed) pending.resolve();
					else pending.reject(new Error("Executor stop could not be confirmed"));
					return;
				}
				case "executor.hello":
					if (message.targetId !== this.#targetId) reject(new Error(`Executor bound to ${message.targetId}, expected ${this.#targetId}`));
					else resolve();
					return;
				case "tool.progress":
					this.#pending.get(message.invocationId)?.onProgress(message.output);
					return;
				case "tool.result": {
					const pending = this.#pending.get(message.invocationId);
					this.#pending.delete(message.invocationId);
					pending?.resolve(message.outcome);
					return;
				}
				case "tool.status": {
					const waiters = this.#statusWaiters.get(message.invocationId) ?? [];
					this.#statusWaiters.delete(message.invocationId);
					for (const waiter of waiters) waiter(message);
				}
			}
		});
		child.on("exit", (code, signal) => {
			if (this.#child !== child) return;
			for(const [id,control]of this.#controls){clearTimeout(control.timer);control.reject(new Error("Executor stopped before permission reconciliation"));this.#controls.delete(id);}
   const waiting = this.#quiescence;
			this.#quiescence = undefined;
			if (waiting) {
				clearTimeout(waiting.timer);
				waiting.reject(new Error("Executor stopped before quiescence was confirmed"));
			}
			reject(new Error(`The local executor exited (${signal ?? code})`));
			// An invocation the executor accepted but did not answer may have had an effect.
			for (const [invocationId, pending] of this.#pending) {
				this.#pending.delete(invocationId);
				pending.resolve({
					status: "unknown",
					output: "The local executor stopped before reporting a result; the action may have partly run",
				});
			}
			for (const [invocationId, waiters] of this.#statusWaiters) {
				this.#statusWaiters.delete(invocationId);
				for (const waiter of waiters) waiter({ kind: "tool.status", invocationId, status: "unknown" });
			}
		});
		this.#ready = promise;
		return promise;
	}

	#send(message: ExecutorRequest): void {
		if (this.#child?.connected === true) this.#child.send(message);
	}
}
