/**
 * The local executor: performs authorized tool invocations on the bound local target. It checks the target and the
 * granted folders again, independently of the Host, and records every invocation in the receipt ledger before its
 * side effect, so a repeated invocation returns the recorded outcome instead of running twice, also across restarts.
 */
import { assertLocalTarget, type ExecutorToolName, type ToolInvocation, type ToolOutcome } from "@openbot/protocol";
import { runCommand } from "./command.ts";
import { editText, type FileContext, listDirectory, readText, writeText } from "./files.ts";
import type { ReceiptLedger } from "./ledger.ts";
import { AccessDenied, absolutePath, grantedPath } from "./paths.ts";

export { commandEnvironment } from "./command.ts";
export { INTERRUPTED_OUTCOME, type Receipt, ReceiptLedger, type ReceiptStatus } from "./ledger.ts";
export { canonicalPath } from "./paths.ts";

export const EXECUTOR_TOOLS: readonly ExecutorToolName[] = ["local_read", "local_list", "local_write", "local_edit", "local_exec"];

/** The ledger operations the executor needs; tests wrap a real ledger to simulate a crash between steps. */
export type ExecutorLedger = Pick<ReceiptLedger, "get" | "accept" | "recordGroup" | "finish" | "ack">;

export type ExecutorOptions = {
	readonly targetId: string;
	/** Default directory for relative paths and commands. */
	readonly workspace: string;
	readonly ledger: ExecutorLedger;
};

type Running = { readonly argsDigest: string; outcome: Promise<ToolOutcome>; cancel?: () => void };

const DIGEST_MISMATCH: ToolOutcome = { status: "failed", output: "Refused: this invocation ID was used with other arguments" };

export class LocalExecutor {
	readonly #options: ExecutorOptions;
	/** Invocations this process is running, so a repeat joins the run and `cancel` reaches it. */
	readonly #running = new Map<string, Running>();

	constructor(options: ExecutorOptions) {
		this.#options = options;
	}

	/**
	 * Run an invocation at most once. Repeating its ID returns the recorded outcome, or `unknown` when an earlier
	 * executor accepted it and died before recording one; a different digest is refused.
	 */
	invoke(invocation: ToolInvocation, onProgress: (output: string) => void): Promise<ToolOutcome> {
		const running = this.#running.get(invocation.invocationId);
		if (running !== undefined) return running.argsDigest === invocation.argsDigest ? running.outcome : Promise.resolve(DIGEST_MISMATCH);
		const { ledger } = this.#options;
		let receipt;
		try {
			receipt = ledger.get(invocation.invocationId);
			if (receipt === undefined) ledger.accept(invocation);
		} catch (error) {
			// Nothing ran: the side effect starts only after `accepted` is committed.
			return Promise.resolve({ status: "failed", output: `The executor could not record the invocation: ${errorText(error)}` });
		}
		if (receipt !== undefined) {
			if (receipt.argsDigest !== invocation.argsDigest) return Promise.resolve(DIGEST_MISMATCH);
			// `accepted` without a run in this process cannot happen after open, which turns such rows `unknown`.
			return Promise.resolve(receipt.outcome ?? { status: "unknown", output: "This action's outcome was not recorded" });
		}

		// Set right below, once the promise exists; `#run` only reads `cancel`.
		const entry: Running = { argsDigest: invocation.argsDigest, outcome: Promise.resolve(DIGEST_MISMATCH) };
		this.#running.set(invocation.invocationId, entry);
		const outcome = this.#run(invocation, entry, onProgress)
			.catch((error: unknown): ToolOutcome => ({
				status: "failed",
				output: error instanceof AccessDenied ? `Access denied: ${errorText(error)}` : errorText(error),
			}))
			.then((result) => {
				this.#running.delete(invocation.invocationId);
				ledger.finish(invocation.invocationId, result);
				// A newer ledger may have marked the row `unknown` meanwhile; the ledger's outcome is the final one.
				return ledger.get(invocation.invocationId)?.outcome ?? result;
			});
		entry.outcome = outcome;
		return outcome;
	}

	cancel(invocationId: string): void {
		this.#running.get(invocationId)?.cancel?.();
	}

	/** Cancel everything this process runs, for shutdown: no command outlives the executor that started it. */
	cancelAll(): Promise<unknown> {
		const outcomes = [...this.#running.values()].map((entry) => {
			entry.cancel?.();
			return entry.outcome;
		});
		return Promise.all(outcomes);
	}

	/** The Host committed the outcome; the receipt may be pruned after the retention period. */
	ack(invocationId: string): void {
		this.#options.ledger.ack(invocationId);
	}

	async #run(invocation: ToolInvocation, entry: Running, onProgress: (output: string) => void): Promise<ToolOutcome> {
		assertLocalTarget(invocation.target, this.#options.targetId);
		if (Date.now() > invocation.deadline) return { status: "failed", output: "Refused: the invocation's deadline passed" };
		const context: FileContext = { workspace: this.#options.workspace, grants: invocation.grants };
		// Pi validated the arguments against the catalog schema before the call reached the router.
		const args = invocation.args as never;
		switch (invocation.tool) {
			case "local_read": {
				const { output, truncated } = await readText(args, context);
				return { status: "succeeded", output, truncated };
			}
			case "local_list":
				return { status: "succeeded", output: await listDirectory(args, context) };
			case "local_write":
				return { status: "succeeded", output: await writeText(args, context) };
			case "local_edit":
				return { status: "succeeded", output: await editText(args, context) };
			case "local_exec": {
				const { command, cwd, timeout_seconds } = invocation.args as { command: string; cwd?: string; timeout_seconds?: number };
				// Commands are authorized per call by the user; the working directory is checked like a path so the
				// approval card shows where it runs, but a command can reach anything the user can.
				const directory = cwd === undefined ? this.#options.workspace : absolutePath(cwd, this.#options.workspace);
				const running = runCommand(
					{ command, cwd: directory, ...(timeout_seconds === undefined ? {} : { timeout_seconds }) },
					onProgress,
				);
				entry.cancel = running.cancel;
				// The group is recorded so a later executor can kill it if this one dies first.
				if (running.pid !== undefined) this.#options.ledger.recordGroup(invocation.invocationId, running.pid);
				return running.outcome;
			}
		}
	}
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export { grantedPath };
