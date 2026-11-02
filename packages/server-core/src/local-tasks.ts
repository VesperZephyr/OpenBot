import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  BotRuntime,
  LocalTaskRecord,
  LocalTaskMetadata,
  StoredRun,
  TaskReceipt,
} from "@openbot/agent-runtime";
import { isTerminal } from "@openbot/agent-runtime";
import {
  LOCAL_TASK_TOOLS,
  LOCAL_TASK_LIMITS,
  ProtocolError,
  type LocalTaskCreate,
  type LocalTaskControl,
  type LocalTaskSubmit,
  type LocalTaskArchive,
  type LocalTaskAccepted,
  type LocalTaskSnapshot,
  type LocalTaskCard,
  type ArtifactRef,
  type SkillAttachment,
  type SkillRef,
} from "@openbot/protocol";
import { canonicalPath, isWithin } from "./policy.ts";
import { composeRoleSkills } from "./role-skills.ts";
import type { RunScheduler } from "./runs.ts";
import type { AuthorityCoordinator, AuthorityExecutor } from "./authority.ts";
import type { ApprovalBook } from "./approvals.ts";
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const publicRun = ({
  messages: _messages,
  inputs: _inputs,
  ...run
}: StoredRun) => run;
const missing = (): never => {
  throw new ProtocolError("not_found", "Task is unavailable");
};
export class LocalTasks {
  readonly #settling = new Map<string, Promise<void>>();
  readonly #preparing = new Map<string, Promise<void>>();
  readonly #errors = new Map<string, string>();
  #closed = false;
  private options: {
    runtime: BotRuntime;
    runs: RunScheduler;
    authority: AuthorityCoordinator;
    executor?: AuthorityExecutor;
    approvals: ApprovalBook;
    workspace: string;
    targetId: string;
    cap: number;
    now: () => number;
    paused: () => boolean;
    changed: () => void;
    resolveAttachments: (
      botId: string,
      ids: readonly string[],
    ) => Promise<readonly ArtifactRef[]>;
    resolveSkills: (
      refs: readonly SkillRef[],
    ) => Promise<readonly SkillAttachment[]>;
  };
  constructor(options: LocalTasks["options"]) {
    this.options = options;
  }
  private get store() {
    return this.options.runtime.tasks();
  }
  async record(id: string) {
    return (await this.store.get(id)) ?? missing();
  }
  private async operations(runId: string) {
    return (await this.options.runtime.policy().operations())
      .filter((o) => o.runId === runId)
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  private async token(
    task: Pick<
      LocalTaskRecord,
      "taskId" | "currentRunId" | "commandRevision" | "settlement"
    >,
  ) {
    const ops = await this.operations(task.currentRunId);
    return {
      ops,
      token: hash([
        task.taskId,
        task.currentRunId,
        task.commandRevision,
        task.settlement,
        ops,
      ]),
    };
  }
  async get(taskId: string): Promise<LocalTaskSnapshot> {
    const task = (await this.store.metadata(taskId)) ?? missing(),
      entry =
        (await this.store.registry()).find((e) => e.taskId === taskId) ??
        missing(),
      run =
        (await this.options.runtime.runsStore().get(task.currentRunId)) ??
        missing();
    const settled = task.settlement?.runId === run.runId,
      busy = !settled;
    const { ops, token } = await this.token(task);
    const approvals = (await this.options.runtime.approvals().pending()).filter(
      (a) => a.binding?.runId === run.runId && a.state === "pending",
    );
    const error =
      this.#errors.get(run.runId) ??
      (run.state === "needs_attention" && !settled ? run.error : undefined);
    const observation = this.options.runtime.execution.current.get(run.runId);
    const activity = observation
      ? {
          runId: run.runId,
          labelKey:
            observation.family ??
            (observation.phase === "generating"
              ? ("generating" as const)
              : ("preparing" as const)),
        }
      : undefined;
    const state: LocalTaskSnapshot["state"] =
      !settled && (error || run.interruption)
        ? "attention"
        : !settled && task.stopIntent
          ? "stopping"
          : approvals.length
            ? "approving"
            : run.state === "queued"
              ? this.options.paused()
                ? "paused"
                : "queued"
              : !settled
                ? "working"
                : ops.length
                  ? "attention"
                  : task.stopIntent
                    ? "stopped"
                    : run.interruption
                      ? "interrupted"
                      : run.state === "failed"
                        ? "failed"
                        : run.state === "cancelled"
                          ? "stopped"
                          : task.result?.runId === run.runId
                            ? "result"
                            : "empty";
    const snapshot: LocalTaskSnapshot = {
      botId: task.botId,
      title: task.title,
      ...entry,
      commandRevision: task.commandRevision,
      currentRunId: run.runId,
      state,
      ...(activity ? { activity } : {}),
      run: {
        ...publicRun(run),
        ...(run.error ? { error: run.error.slice(0, 2048) } : {}),
      },
      approvals: approvals.map(({ args: _args, state: _state, ...a }) => a),
      attachments: task.attachments,
      skills: task.skills.map(({ name, revision, sha256 }) => ({
        name,
        revision,
        sha256,
      })),
      inputCount: task.inputs.length,
      inputBytes: task.inputs.reduce((n, i) => n + i.bytes, 0),
      busy,
      canContinue:
        settled &&
        !entry.archived &&
        (Boolean(task.stopIntent) ||
          Boolean(run.interruption) ||
          ["failed", "cancelled", "needs_attention"].includes(run.state)),
      serial: this.options.cap === 1,
      waitingForCapacity: run.state === "queued" && !this.options.paused(),
      ...(task.result ? { result: task.result } : {}),
      ...((!settled && (task.stopIntent || run.interruption)) || ops.length
        ? {
            recovery: {
              confirmed: settled,
              unknownCount: settled ? ops.length : 0,
              operations: ops.slice(0, 32).map((o) => {
                let path: unknown;
                try {
                  path = JSON.parse(o.argsJson).path;
                } catch {}
                return {
                  invocationId: o.id,
                  callId: o.id.slice(o.conversationId.length + 1),
                  tool: o.tool,
                  ...(typeof path === "string"
                    ? { path: path.slice(0, 512) }
                    : {}),
                };
              }),
              more: ops.length > 32,
              ...(settled && ops.length ? { token } : {}),
              ...(error ? { error: error.slice(0, 2048) } : {}),
            },
          }
        : {}),
    };
    while (
      Buffer.byteLength(JSON.stringify(snapshot)) >
        LOCAL_TASK_LIMITS.pageBytes &&
      snapshot.recovery?.operations.length
    ) {
      snapshot.recovery.operations = snapshot.recovery.operations.slice(0, -1);
      snapshot.recovery.more = true;
    }
    if (
      Buffer.byteLength(JSON.stringify(snapshot)) > LOCAL_TASK_LIMITS.pageBytes
    )
      throw new ProtocolError(
        "invalid_request",
        "Task control metadata exceeds the response limit",
      );
    return snapshot;
  }
  async list(input: {
    archived?: boolean;
    cursor?: string;
  }): Promise<{ tasks: LocalTaskCard[]; next?: string }> {
    const archived = input.archived ?? false;
    let cursor: { at: number; id: string } | undefined;
    if (input.cursor) {
      try {
        const v = JSON.parse(Buffer.from(input.cursor, "base64url").toString());
        if (
          v.archived !== archived ||
          !Number.isFinite(v.at) ||
          typeof v.id !== "string"
        )
          throw Error();
        cursor = v;
      } catch {
        throw new ProtocolError("invalid_request", "Invalid task cursor");
      }
    }
    const entries = (await this.store.registry())
      .filter(
        (e) =>
          e.archived === archived &&
          (!cursor ||
            e.createdAt < cursor.at ||
            (e.createdAt === cursor.at && e.taskId > cursor.id)),
      )
      .sort(
        (a, b) => b.createdAt - a.createdAt || (a.taskId < b.taskId ? -1 : 1),
      );
    const tasks: LocalTaskCard[] = [];
    for (const entry of entries.slice(0, 32)) {
      const s = await this.get(entry.taskId);
      const card: LocalTaskCard = {
        taskId: s.taskId,
        botId: s.botId,
        title: s.title,
        createdAt: s.createdAt,
        archived: s.archived,
        commandRevision: s.commandRevision,
        currentRunId: s.currentRunId,
        state: s.state,
        ...(s.result ? { result: s.result } : {}),
      };
      if (
        Buffer.byteLength(JSON.stringify([...tasks, card])) >
        LOCAL_TASK_LIMITS.pageBytes - 1024
      )
        break;
      tasks.push(card);
    }
    const last = tasks.at(-1);
    return {
      tasks,
      ...(last && entries.length > tasks.length
        ? {
            next: Buffer.from(
              JSON.stringify({ archived, at: last.createdAt, id: last.taskId }),
            ).toString("base64url"),
          }
        : {}),
    };
  }
  private async accepted(receipt: TaskReceipt): Promise<LocalTaskAccepted> {
    return {
      taskId: receipt.taskId,
      commandRevision: receipt.commandRevision,
      runId: receipt.runId,
      snapshot: await this.get(receipt.taskId),
    };
  }
  private run(
    task: LocalTaskRecord,
    runId: string,
    requestId: string,
    text?: string,
  ): StoredRun {
    const brief = [
      ...task.inputs.map((i) => i.text),
      ...(text === undefined ? [] : [text]),
    ]
      .map((t, i) => `Owner instruction ${i + 1}:\n${t}`)
      .join("\n\n");
    return {
      runId,
      botId: task.botId,
      taskId: task.taskId,
      channelId: task.channelId,
      origin: "task",
      messageMode: "messages-v1",
      state: "queued",
      createdAt: this.options.now(),
      requestIds: [requestId],
      messages: [
        {
          requestId,
          text: `Continue this local task using its history and the ordered owner instructions below. Later refinements take precedence. Inspect previous outputs and uncertain effects before producing a fresh report; do not replay old operations. Write and publish only inside ${JSON.stringify(join(task.outputRoot, runId))}. Shell, connectors, shared-file edits and management are unavailable.\n\n${brief}`,
          attachments: task.attachments,
          skills: task.skills,
        },
      ],
      inputs: [],
    };
  }
  async create(input: LocalTaskCreate): Promise<LocalTaskAccepted> {
    const digest = hash([
      "create",
      input.text,
      input.attachments ?? [],
      (input.skills ?? []).map((s) => [s.name, s.revision, s.sha256]),
    ]);
    const old = await this.store.receipt(input.requestId, digest);
    if (old) return this.accepted(old);
    const core =
      (await this.options.runtime.listBots()).find((b) => b.kind === "core") ??
      missing();
    if (!core.model && !(await this.options.runtime.defaultModel()))
      throw new ProtocolError(
        "invalid_request",
        "Choose a model in Settings before starting a task",
      );
    const attachments = await this.options.resolveAttachments(
        core.botId,
        input.attachments ?? [],
      ),
      skills = await this.options.resolveSkills(
        composeRoleSkills(core.defaultSkills ?? [], input.skills ?? []),
      );
    const taskId = `task_${randomUUID()}`,
      runId = `run_${randomUUID()}`;
    const outputRoot = join(
      canonicalPath(this.options.workspace, this.options.workspace),
      "tasks",
      taskId,
    );
    if (canonicalPath(outputRoot, this.options.workspace) !== outputRoot)
      throw new ProtocolError(
        "invalid_request",
        "Task output root must not be redirected",
      );
    const task: LocalTaskRecord = {
      taskId,
      botId: core.botId,
      target: { kind: "local", targetId: this.options.targetId },
      channelId: taskId,
      conversationId: 0,
      title: [...(input.text.split(/\r?\n/).find((t) => t.trim()) ?? "").trim()]
        .slice(0, 80)
        .join(""),
      outputRoot,
      commandRevision: 1,
      currentRunId: runId,
      inputs: [],
      attachments,
      skills,
    };
    const receipt = await this.options.authority.change(() =>
      this.store.command(
        {
          taskId,
          requestId: input.requestId,
          digest,
          operation: "create",
          createdAt: this.options.now(),
        },
        () => ({
          task,
          run: this.run(
            task,
            runId,
            `task-input:${input.requestId}`,
            input.text,
          ),
          input: { requestId: input.requestId, text: input.text },
        }),
      ),
    );
    this.options.changed();
    void this.options.runs.acceptTask(receipt.runId).catch(() => {});
    return this.accepted(receipt);
  }
  async submit(input: LocalTaskSubmit): Promise<LocalTaskAccepted> {
    const digest = hash([
      "submit",
      input.taskId,
      input.expectedRevision,
      input.expectedRunId,
      input.input.kind,
      input.input.kind === "input" ? input.input.text : null,
      input.recoveryToken,
    ]);
    const old = await this.store.receipt(input.requestId, digest);
    if (old) return this.accepted(old);
    const receipt = await this.options.authority.change(async () => {
      const record = await this.record(input.taskId),
        evidence = await this.token(record),
        entry =
          (await this.store.registry()).find(
            (e) => e.taskId === input.taskId,
          ) ?? missing();
      if (entry.archived)
        throw new ProtocolError(
          "invalid_request",
          "Unarchive the task before continuing",
        );
      if (input.input.kind === "continue" && this.options.paused())
        throw new ProtocolError(
          "invalid_request",
          "Resume work before continuing this task",
        );
      if (evidence.ops.length && input.recoveryToken !== evidence.token)
        throw new ProtocolError(
          "invalid_request",
          "Review and acknowledge the current uncertain effects before continuing",
        );
      return this.store.command(
        {
          ...input,
          digest,
          operation: "submit",
          createdAt: this.options.now(),
        },
        (task, previous) => {
          if (!task || !previous) missing();
          if (task!.settlement?.runId !== previous!.runId)
            throw new ProtocolError(
              "invalid_request",
              "Stop and confirm settlement before sending a change",
            );
          if (
            input.input.kind === "continue" &&
            !task!.stopIntent &&
            !previous!.interruption &&
            !["failed", "cancelled", "needs_attention"].includes(
              previous!.state,
            )
          )
            throw new ProtocolError(
              "invalid_request",
              "Use a follow-up to refine a completed task",
            );
          const runId = `run_${randomUUID()}`,
            { stopIntent: _stop, settlement: _settlement, ...kept } = task!;
          const next = {
            ...kept,
            currentRunId: runId,
            commandRevision: task!.commandRevision + 1,
          };
          const text =
            input.input.kind === "input" ? input.input.text : undefined;
          const run = this.run(
            next,
            runId,
            `task-input:${input.requestId}`,
            text,
          );
          const messages = run.messages.map((m) => ({
            ...m,
            text: evidence.ops.length
              ? `${m.text}\n\nPrevious effects remain uncertain (${evidence.ops.length} operations; first 32 references below, full evidence remains in task history). Inspect relevant paths before writing; never infer success from this acknowledgement: ${JSON.stringify(evidence.ops.slice(0, 32).map((o) => ({ invocationId: o.id, tool: o.tool })))}`
              : m.text,
          }));
          return {
            task: next,
            run: { ...run, messages },
            ...(text === undefined
              ? {}
              : { input: { requestId: input.requestId, text } }),
          };
        },
      );
    });
    this.options.changed();
    void this.options.runs.acceptTask(receipt.runId).catch(() => {});
    return this.accepted(receipt);
  }
  async stop(input: LocalTaskControl): Promise<LocalTaskAccepted> {
    const digest = hash([
      "stop",
      input.taskId,
      input.expectedRevision,
      input.expectedRunId,
    ]);
    const receipt = await this.options.authority.change(() =>
      this.store.command(
        { ...input, digest, operation: "stop", createdAt: this.options.now() },
        (task, run) => {
          if (!task || !run) missing();
          if (task!.settlement?.runId === run!.runId) return { task: task! };
          const next = {
            ...task!,
            commandRevision: task!.commandRevision + (task!.stopIntent ? 0 : 1),
            stopIntent: task!.stopIntent ?? {
              runId: run!.runId,
              requestId: input.requestId,
              requestedAt: this.options.now(),
            },
          };
          if (run!.state === "queued" && run!.startedAt === undefined)
            return {
              task: {
                ...next,
                settlement: {
                  runId: run!.runId,
                  confirmedAt: this.options.now(),
                },
              },
              run: { ...run!, state: "cancelled", endedAt: this.options.now() },
            };
          return { task: next };
        },
      ),
    );
    this.options.changed();
    void this.reconcile(input.taskId);
    return this.accepted(receipt);
  }
  async archive(input: LocalTaskArchive): Promise<LocalTaskAccepted> {
    const digest = hash([
      "archive",
      input.taskId,
      input.expectedRevision,
      input.archived,
    ]);
    const receipt = await this.options.authority.change(() =>
      this.store.command(
        {
          ...input,
          digest,
          operation: "archive",
          createdAt: this.options.now(),
        },
        (task) => {
          if (!task) missing();
          if (task!.settlement?.runId !== task!.currentRunId)
            throw new ProtocolError(
              "invalid_request",
              "Only a settled task can be archived",
            );
          return {
            task: { ...task!, commandRevision: task!.commandRevision + 1 },
            archived: input.archived,
          };
        },
      ),
    );
    this.options.changed();
    return this.accepted(receipt);
  }
  async admissible(run: StoredRun): Promise<boolean> {
    if (!run.taskId && run.origin !== "task") return true;
    const task = run.taskId ? await this.store.metadata(run.taskId) : undefined;
    return (
      !!task &&
      task.currentRunId === run.runId &&
      task.botId === run.botId &&
      task.channelId === run.channelId &&
      run.origin === "task" &&
      !task.stopIntent &&
      !run.interruption &&
      task.target.targetId === this.options.targetId
    );
  }
  async assertExecution(call: {
    runId?: string;
    botId: string;
    conversationId: string;
    tool: string;
    args: Readonly<Record<string, unknown>>;
  }) {
    const channel = (await this.options.runtime.channels()).find(
      (c) => String(c.conversationId) === call.conversationId,
    );
    const run = call.runId
      ? await this.options.runtime.runsStore().get(call.runId)
      : undefined;
    if (channel?.kind !== "task" && !run?.taskId && run?.origin !== "task")
      return;
    if (
      !run ||
      !run.taskId ||
      channel?.taskId !== run.taskId ||
      run.botId !== call.botId ||
      !LOCAL_TASK_TOOLS.some((t) => t === call.tool)
    )
      throw new ProtocolError(
        "invalid_request",
        "This tool is unavailable in local tasks",
      );
    const task = await this.store.assertRun(run.runId);
    if (!task || task.target.targetId !== this.options.targetId)
      throw new ProtocolError("invalid_request", "Task target changed");
    if (
      canonicalPath(task.outputRoot, this.options.workspace) !== task.outputRoot
    )
      throw new ProtocolError("invalid_request", "Task output root changed");
    const root = join(task.outputRoot, run.runId);
    if (canonicalPath(root, this.options.workspace) !== root)
      throw new ProtocolError("invalid_request", "Run output root changed");
    if (["local_write", "local_edit", "artifact_publish"].includes(call.tool)) {
      const path =
        typeof call.args.path === "string"
          ? canonicalPath(call.args.path, this.options.workspace)
          : "";
      if (!path || !isWithin(path, root))
        throw new ProtocolError(
          "invalid_request",
          "Task writes and publication must stay in this Run's output directory",
        );
      if (
        call.tool === "local_edit" &&
        typeof call.args.expected_sha256 !== "string"
      )
        throw new ProtocolError(
          "invalid_request",
          "Read the file and provide expected_sha256 before editing",
        );
    }
    return root;
  }
  preparing(runId: string, work: Promise<void>) {
    this.#preparing.set(runId, work);
    void work
      .finally(() => {
        if (this.#preparing.get(runId) === work) this.#preparing.delete(runId);
      })
      .catch(() => {});
  }
  async reconcile(taskId: string): Promise<void> {
    if (this.#closed) return;
    const task = (await this.store.metadata(taskId)) ?? missing();
    const existing = this.#settling.get(task.currentRunId);
    if (existing) return existing;
    const work = this.finish(task)
      .catch((error) => {
        this.#errors.set(
          task.currentRunId,
          error instanceof Error
            ? error.message
            : "Stop could not be confirmed",
        );
        this.options.changed();
      })
      .finally(() => this.#settling.delete(task.currentRunId));
    this.#settling.set(task.currentRunId, work);
    return work;
  }
  private async finish(task: LocalTaskMetadata) {
    const run = await this.options.runtime.runsStore().get(task.currentRunId);
    if (!run) return;
    if (task.settlement?.runId === run.runId) {
      await this.options.runs.refreshTask(run.runId);
      return;
    }
    if (!task.stopIntent && !run.interruption && !isTerminal(run.state)) return;
    if (task.stopIntent || run.interruption) {
      await this.options.approvals.revokeRun(run.runId);
      const operations = await this.operations(run.runId);
      const stopExecutor = async () => {
        if (operations.length && !this.options.executor)
          throw Error("Executor stop confirmation is unavailable");
        for (let i = 0; i < operations.length; i += 4096)
          await this.options.executor!.revoke(
            operations.slice(i, i + 4096).map((o) => o.id),
          );
      };
      await Promise.all([
        this.options.runtime.cancel(task.botId, task.channelId, true),
        stopExecutor(),
      ]);
      await this.#preparing.get(run.runId);
    }
    if (
      !(await this.options.runtime.channelQuiescent(task.botId, task.channelId))
    )
      return;
    const operations = await this.operations(run.runId);
    if (operations.length) {
      if (!this.options.executor)
        throw Error("Executor stop confirmation is unavailable");
      for (let i = 0; i < operations.length; i += 4096)
        await this.options.executor.revoke(
          operations.slice(i, i + 4096).map((o) => o.id),
        );
    }
    const current = await this.options.runtime.runsStore().get(run.runId);
    if (!current) return;
    if (!isTerminal(current.state))
      await this.options.runtime.runsStore().put({
        ...current,
        state: current.interruption ? "needs_attention" : "cancelled",
        endedAt: this.options.now(),
        ...(current.interruption
          ? {
              interruption: {
                ...current.interruption,
                settledAt: this.options.now(),
              },
            }
          : {}),
      });
    const result = await this.options.runtime.taskResultAnchor(run.runId);
    await this.store.settle(
      task.taskId,
      run.runId,
      this.options.now(),
      result ? { runId: run.runId, canonicalAnchor: result } : undefined,
    );
    this.#errors.delete(run.runId);
    await this.options.runs.refreshTask(run.runId);
    this.options.changed();
  }
  async changed() {
    if (this.#closed) return;
    for (const e of await this.store.registry())
      if (!e.archived) void this.reconcile(e.taskId).catch(() => {});
  }
  async close() {
    this.#closed = true;
    await Promise.allSettled(this.#settling.values());
  }
}
