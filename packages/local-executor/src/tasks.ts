/**
 * `local_exec` and its background tasks. A command runs in the foreground until it ends or `yieldMs` passes; then (or
 * right away with `background: true`) it becomes a background task the executor supervises after the tool call ended,
 * so the Run continues. `task_output` returns the output added since the last read, and `task_stop` signals the
 * command's process group as cancellation does.
 *
 * A task is recorded in the ledger's `background_tasks` table before the `local_exec` call reports it, so an executor
 * that dies with tasks running leaves rows the next one finds: it kills their groups and reports them `unknown`.
 * Tasks belong to the conversation that started them; another conversation's task ID is unknown to it.
 */
import { randomUUID } from "node:crypto";
import type { InvocationStatus, ToolOutcome } from "@openbot/protocol";
import { type CommandArgs, type CommandExit, commandOutcome, type RunningCommand, runCommand } from "./command.ts";
import type { ReceiptLedger } from "./ledger.ts";
import { LOG_START, type LogPosition, OutputLog } from "./output.ts";

/** How long a foreground command runs before it yields to the background. */
export const DEFAULT_YIELD_MS = 60_000;
const MAX_WAIT_SECONDS = 60;

export type TaskLedger = Pick<ReceiptLedger, "recordGroup" | "recordTask" | "finishTask" | "task">;

type Task = {
 readonly invocationId:string;
	readonly runId?: string;
	readonly taskId: string;
	readonly conversationId: string;
	readonly command: RunningCommand;
	readonly log: OutputLog;
	readonly startedAt: number;
	readonly timeoutSeconds: number | undefined;
	/** Where the next `task_output` starts. */
	readFrom: LogPosition;
	/** Set once the command ended. */
	exit?: CommandExit;
	readonly ended: Promise<CommandExit>;
};

export class CommandTasks {
	readonly #ledger: TaskLedger;
	readonly #yieldMs: number;
	readonly #tasks = new Map<string, Task>();

	constructor(ledger: TaskLedger, yieldMs: number) {
		this.#ledger = ledger;
		this.#yieldMs = yieldMs;
	}

	/**
	 * Run a command for `local_exec`. Resolves when it ends in the foreground, or when it moved to the background with
	 * the output so far and a `taskId`. `signal` cancels it only while it is in the foreground.
	 */
	async exec(
		invocation: { readonly invocationId: string; readonly conversationId: string; readonly runId?: string },
		args: CommandArgs & { readonly background?: boolean },
		logPath: string,
		onProgress: (output: string) => void,
		signal: AbortSignal,
	): Promise<ToolOutcome> {
		signal.throwIfAborted();
  const log = new OutputLog(logPath);
		let foreground = true;
		const command = runCommand(args, log, (chunk) => {
			if (foreground) onProgress(chunk);
		});
		// The group is recorded so a later executor can kill it if this one dies first.
		if (command.pid !== undefined) this.#ledger.recordGroup(invocation.invocationId, command.pid);
		const cancel = (): void => command.cancel();
		signal.addEventListener("abort", cancel, { once: true });

		let timer: NodeJS.Timeout | undefined;
		const yielded = new Promise<undefined>((resolve) => {
			if (args.background === true) resolve(undefined);
			else timer = setTimeout(resolve, this.#yieldMs, undefined);
		});
		const exit = await Promise.race([command.exited, yielded]);
		clearTimeout(timer);
		signal.removeEventListener("abort", cancel);
		if (exit !== undefined) {
			const { text, truncated } = log.render();
			log.close();
			return commandOutcome(exit, text, truncated, args.timeout_seconds);
		}

		foreground = false;
		// From here on every chunk goes to the artifact file, and memory keeps only the recent tail.
		log.spill();
		const taskId = `task_${randomUUID().slice(0, 8)}`;
		const task: Task = {
 invocationId:invocation.invocationId,
			...(invocation.runId ? { runId: invocation.runId } : {}),
			taskId,
			conversationId: invocation.conversationId,
			command,
			log,
			startedAt: Date.now(),
			timeoutSeconds: args.timeout_seconds,
			readFrom: log.position,
			ended: command.exited.then((ended) => {
				task.exit = ended;
				log.close();
				this.#ledger.finishTask(taskId, taskStatus(ended), { code: ended.code, signal: ended.signal });
				return ended;
			}),
		};
		this.#ledger.recordTask(taskId, invocation.invocationId, invocation.conversationId);
		this.#tasks.set(taskId, task);
		const { text, truncated } = log.render(LOG_START);
		const how =
			args.background === true ? "Started in the background" : `Still running after ${this.#yieldMs / 1000}s; moved to the background`;
		return {
			status: "succeeded",
			output: `${text === "" ? "(no output yet)" : text}\n[${how} as task ${taskId}. Check it with task_output; stop it with task_stop.]`,
			truncated,
			taskId,
		};
	}

	/** New output since the last read and the task's status, after waiting up to `waitSeconds` for it to end. */
	async output(conversationId: string, taskId: string, waitSeconds: number, signal: AbortSignal): Promise<ToolOutcome> {
		const task = this.#tasks.get(taskId);
		if (task === undefined || task.conversationId !== conversationId) return this.#notRunningHere(conversationId, taskId);
		const wait = Math.min(Math.max(waitSeconds, 0), MAX_WAIT_SECONDS) * 1000;
		if (task.exit === undefined && wait > 0) {
			const { promise: stopped, resolve } = Promise.withResolvers<void>();
			const timer = setTimeout(resolve, wait);
			signal.addEventListener("abort", () => resolve(), { once: true });
			await Promise.race([task.ended, stopped]);
			clearTimeout(timer);
		}
		return this.#report(task);
	}

	/** Stop a task's process group and report its last output. */
	async stop(conversationId: string, taskId: string): Promise<ToolOutcome> {
		const task = this.#tasks.get(taskId);
		if (task === undefined || task.conversationId !== conversationId) return this.#notRunningHere(conversationId, taskId);
		task.command.cancel();
		await task.ended;
		return this.#report(task);
	}

	/** A Run stop preserves other Runs' commands; lifecycle changes can stop the whole conversation. */
	stopConversation(conversationId: string, runId?: string): void {
		for (const task of this.#tasks.values())
			if (task.conversationId === conversationId && (runId === undefined || task.runId === runId)) task.command.cancel();
	}

	/** Stop every task, for shutdown: no command outlives the executor that started it. */
	stopAll(): Promise<CommandExit[]> {
		return Promise.all([...this.#tasks.values()].map((task) => (task.command.cancel(), task.ended)));
	}

 stopInvocations(ids:ReadonlySet<string>):Promise<CommandExit[]> {return Promise.all([...this.#tasks.values()].filter(task=>ids.has(task.invocationId)).map(task=>(task.command.cancel(),task.ended)));}

	#report(task: Task): ToolOutcome {
		const end = task.log.position;
		const { text, truncated } = task.log.render(task.readFrom);
		task.readFrom = end;
		const body = text === "" ? "(no new output)" : text;
		const exit = task.exit;
		if (exit === undefined) {
			const seconds = Math.round((Date.now() - task.startedAt) / 1000);
			return {
				status: "succeeded",
				output: `${body}\n[task ${task.taskId}: running, ${seconds}s in the background]`,
				truncated,
				taskId: task.taskId,
			};
		}
		const state =
			exit.startError !== undefined
				? `could not start: ${exit.startError}`
				: exit.reason === "cancelled"
					? exit.groupGone
						? "stopped"
						: "stopped, but its processes may still be running"
					: exit.reason === "timeout"
						? `timed out after ${task.timeoutSeconds}s`
						: `exited with ${exit.code === null ? `signal ${exit.signal}` : `code ${exit.code}`}`;
		// The final output is out; the ledger row answers later reads, and the buffer is freed.
		this.#tasks.delete(task.taskId);
		return {
			status: "succeeded",
			output: `${body}\n[task ${task.taskId}: ${state}]`,
			exit: { code: exit.code, signal: exit.signal },
			truncated,
			taskId: task.taskId,
		};
	}

	/** A task not in memory: one already reported ended, one a previous executor ran, or another conversation's. */
	#notRunningHere(conversationId: string, taskId: string): ToolOutcome {
		const row = this.#ledger.task(taskId);
		if (row === undefined || row.conversationId !== conversationId) {
			return { status: "failed", output: `Unknown task ${taskId}; use the taskId local_exec returned` };
		}
		if (row.status === "unknown") {
			return {
				status: "succeeded",
				output: `[task ${taskId}: unknown. The executor restarted while it ran and stopped it; it may have partly run. Check its effect before running it again.]`,
				taskId,
			};
		}
		return { status: "succeeded", output: `[task ${taskId}: ${row.status}; no further output]`, taskId };
	}
}

function taskStatus(exit: CommandExit): InvocationStatus {
	if (exit.reason === "cancelled") return exit.groupGone ? "cancelled" : "unknown";
	return exit.reason === undefined && exit.code === 0 ? "succeeded" : "failed";
}
