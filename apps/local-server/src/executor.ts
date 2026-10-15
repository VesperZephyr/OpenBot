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
	readonly #pending = new Map<string, Pending>();
	readonly #statusWaiters = new Map<string, ((reply: StatusReply) => void)[]>();
	#child: ChildProcess | undefined;
	#ready: Promise<void> | undefined;

	constructor(options: { entry: string; targetId: string; workspace: string; dataDirectory: string; env: NodeJS.ProcessEnv }) {
		this.#entry = options.entry;
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
		// The Run may have been stopped while the router or the start awaited: nothing was sent, so nothing runs.
		signal.throwIfAborted();
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

	/** The Host committed the invocation's outcome; the executor may prune its receipt later. */
	ack(invocationId: string): void {
		this.#send({ kind: "result.ack", invocationId });
	}

	/** The conversation's work was stopped: the executor stops the background commands it started. */
	stopTasks(conversationId: string): void {
		this.#send({ kind: "tasks.stop", conversationId });
	}

	/** Read-only receipt lookup, for diagnostics. */
	async status(invocationId: string): Promise<StatusReply> {
		await this.#start();
		const { promise, resolve } = Promise.withResolvers<StatusReply>();
		this.#statusWaiters.set(invocationId, [...(this.#statusWaiters.get(invocationId) ?? []), resolve]);
		this.#send({ kind: "tool.status", invocationId });
		return promise;
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
			switch (message.kind) {
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
			reject(new Error(`The local executor exited (${signal ?? code})`));
			// An invocation the executor accepted but did not answer may have had an effect.
			for (const [invocationId, pending] of this.#pending) {
				this.#pending.delete(invocationId);
				pending.resolve({ status: "unknown", output: "The local executor stopped before reporting a result; the action may have partly run" });
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
