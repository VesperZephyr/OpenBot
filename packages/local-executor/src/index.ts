export { avatarSource, validateAvatar } from "./avatars.ts";
/**
 * The local executor: performs authorized tool invocations on the bound local target. It checks the target and the
 * granted folders again, independently of the Host, and records every invocation in the receipt ledger before its
 * side effect, so a repeated invocation returns the recorded outcome instead of running twice, also across restarts.
 *
 * Every result passes the one output limiter (`output.ts`): what does not fit is saved under the artifacts directory,
 * which `local_read` may read as an implicit grant. Commands that run long move to the background (`tasks.ts`).
 */
import { assertLocalTarget, type ExecutorToolName, type ToolInvocation, type ToolOutcome } from "@openbot/protocol";
import type { ConnectorSupervisor } from "./connectors.ts";
import { ArtifactStore, selectedPath } from "./artifacts.ts";
import { editText, type FileContext, listDirectory, readText, writeText } from "./files.ts";
import type { Receipt, ReceiptLedger } from "./ledger.ts";
import { artifactPath, limitText } from "./output.ts";
import { AccessDenied, absolutePath, grantedPath } from "./paths.ts";
import { CommandTasks, DEFAULT_YIELD_MS } from "./tasks.ts";

export { ArtifactStore } from "./artifacts.ts";
export { commandEnvironment } from "./command.ts";
export { INTERRUPTED_OUTCOME, type Receipt, ReceiptLedger, type ReceiptStatus, type TaskRecord, type TaskStatus } from "./ledger.ts";
export { OUTPUT_LIMITS, pruneArtifacts } from "./output.ts";
export { canonicalPath } from "./paths.ts";
export { DEFAULT_YIELD_MS } from "./tasks.ts";

export const EXECUTOR_TOOLS: readonly ExecutorToolName[] = [
	"artifact_publish",
	"local_read",
	"local_list",
	"local_write",
	"local_edit",
	"local_exec",
	"task_output",
	"task_stop",
];

/** The ledger operations the executor needs; tests wrap a real ledger to simulate a crash between steps. */
export type ExecutorLedger = Pick<
	ReceiptLedger,
	"get" | "accept" | "recordGroup" | "finish" | "ack" | "recordTask" | "finishTask" | "task"
> & Partial<Pick<ReceiptLedger, "reconcileArtifact" | "confirmStopped" | "consumeTask">>;

export type ExecutorOptions = {
 readonly connectors?:ConnectorSupervisor;
	readonly requireAuthority?:boolean;
 readonly targetId: string;
	/** Default directory for relative paths and commands. */
	readonly workspace: string;
	readonly ledger: ExecutorLedger;
	/** Canonical `<data>/artifacts`: full output of cut results; readable by `local_read` without a grant. */
	readonly artifactsDirectory: string;
	/** How long a foreground command runs before it moves to the background. */
	readonly yieldMs?: number;
	readonly artifactStore?: ArtifactStore;
};

type Running = { readonly argsDigest: string; outcome: Promise<ToolOutcome>; readonly abort: AbortController };

const DIGEST_MISMATCH: ToolOutcome = { status: "failed", output: "Refused: this invocation ID was used with other arguments" };

export class LocalExecutor {
	readonly #options: ExecutorOptions;
	/** Invocations this process is running, so a repeat joins the run and `cancel` reaches it. */
	readonly #running = new Map<string, Running>();
	readonly #tasks: CommandTasks;
 #revision=-1;
 readonly #revoked=new Set<string>();

	constructor(options: ExecutorOptions) {
		this.#options = options;
		this.#tasks = new CommandTasks(options.ledger, options.yieldMs ?? DEFAULT_YIELD_MS);
	}

	/** Reconcile only executor-owned immutable publication; never repeat an uncertain external side effect. */
	receipt(invocationId: string): Receipt | undefined {
		const { ledger, artifactStore } = this.#options,
			receipt = ledger.get(invocationId);
		if (receipt?.status !== "unknown" || receipt.tool !== "artifact_publish" || !ledger.reconcileArtifact) return receipt;
		const artifact = artifactStore?.published(invocationId);
		if (!artifact) return receipt;
		ledger.reconcileArtifact(invocationId, receipt.argsDigest, { status: "succeeded", output: JSON.stringify(artifact), artifact });
		return ledger.get(invocationId);
	}

	/**
	 * Run an invocation at most once. Repeating its ID returns the recorded outcome, or `unknown` when an earlier
	 * executor accepted it and died before recording one; a different digest is refused.
	 */
	invoke(invocation: ToolInvocation, onProgress: (output: string) => void): Promise<ToolOutcome> {
		try {
			assertLocalTarget(invocation.target, this.#options.targetId);
		} catch {
			return Promise.resolve({ status: "failed", output: "Refused: wrong execution target" });
		}
		const running = this.#running.get(invocation.invocationId);
		if (running !== undefined) return running.argsDigest === invocation.argsDigest ? running.outcome : Promise.resolve(DIGEST_MISMATCH);
		const { ledger } = this.#options;
		let receipt;
		try {
			receipt = ledger.get(invocation.invocationId);
			if (receipt === undefined) {
    if(this.#revoked.has(invocation.invocationId)||(this.#options.requireAuthority&&invocation.authorityRevision!==this.#revision)|| (invocation.authorityRevision!==undefined&&invocation.authorityRevision!==this.#revision))return Promise.resolve({status:"failed",output:"permission_revoked: stale execution authority"});
    ledger.accept(invocation);
   }
		} catch (error) {
			// Nothing ran: the side effect starts only after `accepted` is committed.
			return Promise.resolve({ status: "failed", output: `The executor could not record the invocation: ${errorText(error)}` });
		}
		if (receipt !== undefined) {
			if (receipt.argsDigest !== invocation.argsDigest) return Promise.resolve(DIGEST_MISMATCH);
			if (receipt.status === "unknown" && invocation.tool === "artifact_publish")
				receipt = this.receipt(invocation.invocationId) ?? receipt;

			// `accepted` without a run in this process cannot happen after open, which turns such rows `unknown`.
			return Promise.resolve(receipt.outcome ?? { status: "unknown", output: "This action's outcome was not recorded" });
		}

		// Set right below, once the promise exists.
		const entry: Running = { argsDigest: invocation.argsDigest, outcome: Promise.resolve(DIGEST_MISMATCH), abort: new AbortController() };
		this.#running.set(invocation.invocationId, entry);
		const outcome = this.#run(invocation, entry.abort.signal, onProgress)
			.catch(
				(error: unknown): ToolOutcome => ({
					status: entry.abort.signal.aborted?"cancelled":"failed",
					output: error instanceof AccessDenied ? `Access denied: ${errorText(error)}` : errorText(error),
				}),
			)
			.then((result) => {
				this.#running.delete(invocation.invocationId);
				ledger.finish(invocation.invocationId, result);
				// A newer ledger may have marked the row `unknown` meanwhile; the ledger's outcome is the final one.
				return ledger.get(invocation.invocationId)?.outcome ?? result;
			});
		entry.outcome = outcome;
		return outcome;
	}

 authorizedOperation(id:string,revision:number|undefined):boolean{return revision===this.#revision&&!this.#revoked.has(id);}
 synchronize(revision:number):boolean {if(!Number.isSafeInteger(revision)||revision<0||revision<this.#revision)return false;this.#revision=revision;return true;}
 async revoke(ids:readonly string[]):Promise<boolean>{
  const selected=new Set(ids);for(const id of selected)this.#revoked.add(id);
  const running=[...this.#running].filter(([id])=>selected.has(id)).map(([,entry])=>{entry.abort.abort();return entry.outcome;});
  const [outcomes,tasks]=await Promise.all([Promise.all(running),this.#tasks.stopInvocations(selected)]);
  const late=await this.#tasks.stopInvocations(selected);
  return outcomes.every(outcome=>outcome.status!=="unknown")&&[...tasks,...late].every(exit=>exit.groupGone!==false)&&(this.#options.ledger.confirmStopped?.(ids)??!this.#options.requireAuthority);
 }

	/** Cancel a running invocation. A command already in the background is stopped with `task_stop` instead. */
	cancel(invocationId: string): void {
		this.#running.get(invocationId)?.abort.abort();
	}

	/** Stop background commands for one Run, or the whole conversation when no Run is specified. */
	stopTasks(conversationId: string, runId?: string): void {
		this.#tasks.stopConversation(conversationId, runId);
	}

	/** Cancel everything this process runs, for shutdown: no command outlives the executor that started it. */
	async cancelAll(): Promise<boolean> {
		const outcomes = [...this.#running.values()].map((entry) => {
			entry.abort.abort();
			return entry.outcome;
		});
		const [finished, tasks, connectors] = await Promise.all([Promise.all(outcomes), this.#tasks.stopAll(), this.#options.connectors?.stopAll() ?? true]);
		const lateTasks = await this.#tasks.stopAll();
		return connectors && finished.every((outcome) => outcome.status !== "unknown") && [...tasks, ...lateTasks].every((exit) => exit.groupGone !== false);
	}

	/** The Host committed the outcome; the receipt may be pruned after the retention period. */
	ack(invocationId: string): void {
		this.#options.ledger.ack(invocationId);
	}

	async #run(invocation: ToolInvocation, signal: AbortSignal, onProgress: (output: string) => void): Promise<ToolOutcome> {
		assertLocalTarget(invocation.target, this.#options.targetId);
		if (Date.now() > invocation.deadline) return { status: "failed", output: "Refused: the invocation's deadline passed" };
		signal.throwIfAborted();
  if(invocation.tool.startsWith("mcp__")){
            if(!invocation.connector||!this.#options.connectors)return {status:"failed",output:"Connector is unavailable"};
            return this.#options.connectors.invoke(invocation.connector,invocation.tool,invocation.args,signal);
        }
  const context: FileContext = { signal, workspace: this.#options.workspace, grants: invocation.grants, readGrants: invocation.readGrants };
		const spill = artifactPath(this.#options.artifactsDirectory, invocation.invocationId);
		const limited = (output: string): ToolOutcome => {
			const { text, truncated } = limitText(output, spill);
			return { status: "succeeded", output: text, ...(truncated ? { truncated } : {}) };
		};
		// Pi validated the arguments against the catalog schema before the call reached the router.
		const args = invocation.args as never;
		switch (invocation.tool) {
			case "artifact_publish": {
				const input = invocation.args as { path: string; name?: string };
				const original = selectedPath(absolutePath(input.path, context.workspace));
				const path = await grantedPath(original, context.workspace, [...context.grants, ...context.readGrants]);
				signal.throwIfAborted();
				const store = this.#options.artifactStore;
				if (!store) throw new Error("Artifact storage is unavailable");
				const artifact = store.capture(invocation.invocationId, path, "result", input.name);
				return { status: "succeeded", output: JSON.stringify(artifact), artifact };
			}
			case "local_read": {
				// Spilled output is the executor's own; reading it back needs no grant, and only `local_read` gets it.
				const readContext = { ...context, readGrants: [...context.readGrants, this.#options.artifactsDirectory] };
				// Reads page with offset under the same limits; the file itself is the full output, so nothing is spilled.
				const { output, truncated } = await readText(args, readContext);
				return { status: "succeeded", output, ...(truncated ? { truncated } : {}) };
			}
			case "local_list":
				return limited(await listDirectory(args, context));
			case "local_write":
				return limited(await writeText(args, context));
			case "local_edit":
				return limited(await editText(args, context));
			case "local_exec": {
				const { command, cwd, timeout_seconds, background } = invocation.args as {
					command: string;
					cwd?: string;
					timeout_seconds?: number;
					background?: boolean;
				};
				// Commands are authorized per call by the user; the working directory is checked like a path so the
				// approval card shows where it runs, but a command can reach anything the user can.
				const directory = cwd === undefined ? this.#options.workspace : absolutePath(cwd, this.#options.workspace);
				return this.#tasks.exec(
					invocation,
					{
						command,
						cwd: directory,
						...(timeout_seconds === undefined ? {} : { timeout_seconds }),
						...(background === undefined ? {} : { background }),
					},
					spill,
					onProgress,
					signal,
				);
			}
			case "task_output": {
				const { taskId, wait_seconds } = invocation.args as { taskId: string; wait_seconds?: number };
				return this.#tasks.output(invocation.conversationId, taskId, wait_seconds ?? 0, signal);
			}
			case "task_stop": {
				const { taskId } = invocation.args as { taskId: string };
				return this.#tasks.stop(invocation.conversationId, taskId);
			}
		}
        return {status:"failed",output:"Unknown executor tool"};
	}
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export { grantedPath };

export { SkillStore } from "./skills.ts";

export { ConnectorSupervisor } from "./connectors.ts";

export { listReaderFiles, readWorkspaceFile, readSelectedFile } from "./reader.ts";

export { validateExecutorBackup } from "./backup.ts";
