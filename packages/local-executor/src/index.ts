/**
 * The local executor: performs authorized tool invocations on the bound local target. It checks the target and the
 * granted folders again, independently of the Host, and keeps each invocation's outcome until the Host has it, so a
 * repeated invocation returns the recorded outcome instead of running twice.
 *
 * Receipts live in memory for the demo; the persistent receipt ledger is backlog work (docs/technical-plan.md).
 */
import { assertLocalTarget, type ExecutorToolName, type ToolInvocation, type ToolOutcome } from "@openbot/protocol";
import { runCommand } from "./command.ts";
import { editText, type FileContext, listDirectory, readText, writeText } from "./files.ts";
import { AccessDenied, absolutePath, grantedPath } from "./paths.ts";

export { commandEnvironment } from "./command.ts";
export { canonicalPath } from "./paths.ts";

export const EXECUTOR_TOOLS: readonly ExecutorToolName[] = ["local_read", "local_list", "local_write", "local_edit", "local_exec"];

export type ExecutorOptions = {
	readonly targetId: string;
	/** Default directory for relative paths and commands. */
	readonly workspace: string;
};

type Receipt = { readonly argsDigest: string; readonly outcome: Promise<ToolOutcome>; cancel?: () => void };

export class LocalExecutor {
	readonly #options: ExecutorOptions;
	readonly #receipts = new Map<string, Receipt>();

	constructor(options: ExecutorOptions) {
		this.#options = options;
	}

	/** Run an invocation once. Repeating its ID returns the same outcome; a different digest is refused. */
	invoke(invocation: ToolInvocation, onProgress: (output: string) => void): Promise<ToolOutcome> {
		const existing = this.#receipts.get(invocation.invocationId);
		if (existing !== undefined) {
			if (existing.argsDigest !== invocation.argsDigest) {
				return Promise.resolve({ status: "failed", output: "Refused: this invocation ID was used with other arguments" });
			}
			return existing.outcome;
		}
		const receipt: Receipt = { argsDigest: invocation.argsDigest, outcome: Promise.resolve({ status: "failed", output: "" }) };
		this.#receipts.set(invocation.invocationId, receipt);
		const outcome = this.#run(invocation, receipt, onProgress).catch((error: unknown): ToolOutcome => {
			const message = error instanceof Error ? error.message : String(error);
			return { status: "failed", output: error instanceof AccessDenied ? `Access denied: ${message}` : message };
		});
		(receipt as { outcome: Promise<ToolOutcome> }).outcome = outcome;
		return outcome;
	}

	cancel(invocationId: string): void {
		this.#receipts.get(invocationId)?.cancel?.();
	}

	/** The Host has persisted the outcome; the receipt is no longer needed. */
	forget(invocationId: string): void {
		this.#receipts.delete(invocationId);
	}

	async #run(invocation: ToolInvocation, receipt: Receipt, onProgress: (output: string) => void): Promise<ToolOutcome> {
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
				receipt.cancel = running.cancel;
				return running.outcome;
			}
		}
	}
}

export { grantedPath };
