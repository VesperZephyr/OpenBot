import type {
  Message,
  Provider,
  TranscriptContext,
  StreamOptions,
} from "@earendil-works/pi-ai";
import type { CommitPublication } from "@earendil-works/pi-durable";
import type { LocalTaskRecord } from "./local-tasks.ts";
import type { StoredRun } from "./runs.ts";

export class TaskModelGate {
  private bindings = new WeakMap<object, AbortSignal>();
  private controllers = new Map<
    string,
    { taskId: string; abort: AbortController }
  >();
  private tasks = new Map<
    string,
    Pick<LocalTaskRecord, "taskId" | "currentRunId" | "stopIntent">
  >();
  private runs = new Map<
    string,
    Pick<StoredRun, "runId" | "state" | "interruption">
  >();
  private providers = new WeakMap<Provider, Provider>();
  private sessions = new Map<string, string>();
  register(
    sessionId: string,
    task: Pick<LocalTaskRecord, "taskId" | "currentRunId" | "stopIntent">,
    run: StoredRun | undefined,
  ) {
    this.sessions.set(sessionId, task.taskId);
    if (!this.tasks.has(task.taskId))
      this.tasks.set(task.taskId, {
        taskId: task.taskId,
        currentRunId: task.currentRunId,
        ...(task.stopIntent ? { stopIntent: task.stopIntent } : {}),
      });
    if (run && !this.runs.has(run.runId))
      this.runs.set(run.runId, {
        runId: run.runId,
        state: run.state,
        ...(run.interruption ? { interruption: run.interruption } : {}),
      });
  }
  private sessionSignal(
    sessionId: string | undefined,
  ): AbortSignal | undefined {
    const taskId = sessionId ? this.sessions.get(sessionId) : undefined;
    if (!taskId) return;
    const task = this.tasks.get(taskId),
      run = task ? this.runs.get(task.currentRunId) : undefined;
    if (
      !task ||
      !run ||
      task.stopIntent ||
      run.interruption ||
      run.state !== "running"
    )
      throw Error("Task model request is no longer authorized");
    let binding = this.controllers.get(run.runId);
    if (!binding) {
      binding = { taskId, abort: new AbortController() };
      this.controllers.set(run.runId, binding);
    }
    return binding.abort.signal;
  }
  bind(
    messages: readonly Message[],
    task: Pick<LocalTaskRecord, "taskId" | "currentRunId" | "stopIntent">,
    run: StoredRun,
  ): readonly Message[] {
    const latest = this.tasks.get(task.taskId) ?? task,
      current = this.runs.get(run.runId) ?? run;
    if (
      latest.currentRunId !== run.runId ||
      latest.stopIntent ||
      current.interruption ||
      current.state !== "running"
    )
      throw Error("Task model request is no longer authorized");
    let binding = this.controllers.get(run.runId);
    if (!binding) {
      binding = { taskId: task.taskId, abort: new AbortController() };
      this.controllers.set(run.runId, binding);
    }
    binding.abort.signal.throwIfAborted();
    const last = messages.at(-1);
    if (!last) throw Error("Task request has no input");
    const marker = { ...last };
    this.bindings.set(marker, binding.abort.signal);
    return [...messages.slice(0, -1), marker];
  }
  committed(publication: CommitPublication) {
    for (const change of publication.changes) {
      if (change.type !== "document" || !change.value) continue;
      if (change.record.kind === "openbot.local-task") {
        const task = change.value.task as LocalTaskRecord | undefined;
        if (task) {
          this.tasks.set(task.taskId, {
            taskId: task.taskId,
            currentRunId: task.currentRunId,
            ...(task.stopIntent ? { stopIntent: task.stopIntent } : {}),
          });
          for (const [runId, binding] of this.controllers)
            if (
              binding.taskId === task.taskId &&
              (task.stopIntent || task.currentRunId !== runId)
            )
              binding.abort.abort();
        }
      }
      if (change.record.kind === "openbot.runs") {
        this.runs = new Map(
          Object.values(
            change.value.runs as unknown as Record<string, StoredRun>,
          )
            .filter((r) => r.taskId)
            .map((r) => [
              r.runId,
              {
                runId: r.runId,
                state: r.state,
                ...(r.interruption ? { interruption: r.interruption } : {}),
              },
            ]),
        );
        for (const [runId, binding] of this.controllers) {
          const run = this.runs.get(runId);
          if (!run || run.state !== "running" || run.interruption) {
            binding.abort.abort();
            this.controllers.delete(runId);
          }
        }
      }
    }
  }
  provider(provider: Provider): Provider {
    const existing = this.providers.get(provider);
    if (existing) return existing;
    const wrapped = new Proxy(provider, {
      get: (target, key) => {
        const value = Reflect.get(target, key, target);
        if (typeof value !== "function") return value;
        if (
          key !== "stream" &&
          key !== "streamSimple" &&
          key !== "fetchDeferred"
        )
          return value.bind(target);
        return (
          model: unknown,
          context: TranscriptContext,
          options?: StreamOptions,
        ) => {
          const sessionSignal = this.sessionSignal(options?.sessionId);
          const requestSignal =
            key === "fetchDeferred"
              ? undefined
              : context.messages
                  .map((m) => this.bindings.get(m))
                  .find((s) => s !== undefined);
          const signal =
            sessionSignal && requestSignal
              ? AbortSignal.any([sessionSignal, requestSignal])
              : (sessionSignal ?? requestSignal);
          signal?.throwIfAborted();
          return value.call(
            target,
            model,
            context,
            signal
              ? {
                  ...options,
                  signal: options?.signal
                    ? AbortSignal.any([options.signal, signal])
                    : signal,
                }
              : options,
          );
        };
      },
    });
    this.providers.set(provider, wrapped);
    this.providers.set(wrapped, wrapped);
    return wrapped;
  }
  close() {
    for (const c of this.controllers.values()) c.abort.abort();
    this.controllers.clear();
    this.tasks.clear();
    this.runs.clear();
    this.sessions.clear();
    this.bindings = new WeakMap();
  }
}
