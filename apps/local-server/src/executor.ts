/**
 * The Host's connection to the local executor process: starts it, checks its handshake against the bound target, and
 * correlates invocations with results. Implements Tool Router's `ExecutorTransport`.
 */
import { type ChildProcess, spawn } from "node:child_process";
import type { ExecutorMessage, ExecutorRequest, ToolInvocation, ToolOutcome } from "@openbot/protocol";
import type { ExecutorTransport } from "@openbot/tool-router";

type Pending = { readonly resolve: (outcome: ToolOutcome) => void; readonly onProgress: (output: string) => void };

export class ExecutorProcess implements ExecutorTransport {
	readonly #entry: string;
	readonly #env: NodeJS.ProcessEnv;
	readonly #targetId: string;
	readonly #pending = new Map<string, Pending>();
	#child: ChildProcess | undefined;
	#ready: Promise<void> | undefined;

	constructor(options: { entry: string; targetId: string; workspace: string; env: NodeJS.ProcessEnv }) {
		this.#entry = options.entry;
		this.#targetId = options.targetId;
		this.#env = { ...options.env, OPENBOT_TARGET_ID: options.targetId, OPENBOT_WORKSPACE: options.workspace };
	}

	async invoke(invocation: ToolInvocation, onProgress: (output: string) => void, signal: AbortSignal): Promise<ToolOutcome> {
		await this.#start();
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
		});
		this.#ready = promise;
		return promise;
	}

	#send(message: ExecutorRequest): void {
		if (this.#child?.connected === true) this.#child.send(message);
	}
}
