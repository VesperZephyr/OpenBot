import { createHash } from "node:crypto";
import { PolicyDoc } from "./policy.ts";
import {
  defineDoc,
  defineDocFamily,
  type Harness,
  type Tx,
  type ConversationId,
} from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord/context";
import {
  LOCAL_TASK_LIMITS,
  ProtocolError,
  type ExecutionTarget,
  type ArtifactRef,
  type SkillRef,
  type SkillAttachment,
} from "@openbot/protocol";
import { RunsDoc, type StoredRun } from "./runs.ts";
import { ChannelsDoc } from "./channels.ts";
import { BotsDoc } from "./bots.ts";
import { recordOutcomes } from "./message-records.ts";

type Mutable<T> = T extends readonly (infer U)[]
  ? Mutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: Mutable<T[K]> }
    : T;
export type TaskInput = { requestId: string; text: string; anchor: string };
export type LocalTaskRecord = {
  taskId: string;
  botId: string;
  target: ExecutionTarget;
  channelId: string;
  conversationId: number;
  title: string;
  outputRoot: string;
  commandRevision: number;
  currentRunId: string;
  inputs: TaskInput[];
  attachments: readonly ArtifactRef[];
  skills: readonly SkillAttachment[];
  stopIntent?: { runId: string; requestId: string; requestedAt: number };
  settlement?: { runId: string; confirmedAt: number };
  result?: { runId: string; canonicalAnchor: string };
};
export type LocalTaskMetadata = Omit<LocalTaskRecord, "inputs" | "skills"> & {
  inputs: { requestId: string; anchor: string; bytes: number }[];
  skills: readonly SkillRef[];
};
export type TaskReceipt = {
  requestId: string;
  digest: string;
  taskId: string;
  commandRevision: number;
  runId: string;
  operation: string;
  recoveryToken?: string;
};
export type TaskRegistryEntry = {
  taskId: string;
  createdAt: number;
  archived: boolean;
};
export const LocalTasksDoc = defineDoc<{ entries: TaskRegistryEntry[] }>({
  kind: "openbot.local-tasks",
  version: 1,
  scope: "session",
  initial: () => ({ entries: [] }),
});
export const LocalTaskDoc = defineDocFamily<
  { task?: Mutable<LocalTaskMetadata> },
  null
>({
  kind: "openbot.local-task",
  version: 1,
  scope: "session",
  family: true,
  initial: () => ({}),
});
const TaskBriefDoc = defineDocFamily<
  { inputs: TaskInput[]; skills: Mutable<SkillAttachment>[] },
  null
>({
  kind: "openbot.local-task-brief",
  version: 1,
  scope: "session",
  family: true,
  initial: () => ({ inputs: [], skills: [] }),
});
const TaskReceipts = defineDocFamily<{ receipt?: TaskReceipt }, null>({
  kind: "openbot.local-task-receipt",
  version: 1,
  scope: "session",
  family: true,
  initial: () => ({}),
});
const copy = <T>(value: T): Mutable<T> => JSON.parse(JSON.stringify(value));
export async function assertTaskRun(
  tx: Tx,
  run: StoredRun,
): Promise<LocalTaskMetadata | undefined> {
  const bound = (await tx.doc(ChannelsDoc)).channels[
    JSON.stringify([run.botId, run.channelId ?? "direct"])
  ];
  if (!run.taskId && run.origin !== "task" && bound?.kind !== "task") return;
  const task = run.taskId
    ? (await tx.doc(LocalTaskDoc, run.taskId, null)).task
    : undefined;
  const channel = task
    ? (await tx.doc(ChannelsDoc)).channels[
        JSON.stringify([task.botId, task.channelId])
      ]
    : undefined;
  const bot = (await tx.doc(BotsDoc)).bots[run.botId];
  if (
    !task ||
    !channel ||
    channel.kind !== "task" ||
    channel.taskId !== task.taskId ||
    channel.conversationId !== task.conversationId ||
    bot?.kind !== "core" ||
    task.botId !== run.botId ||
    task.channelId !== run.channelId ||
    task.currentRunId !== run.runId ||
    run.origin !== "task" ||
    task.stopIntent ||
    run.interruption ||
    run.state !== "running"
  )
    throw new ProtocolError(
      "invalid_request",
      "Task execution is no longer authorized",
    );
  return copy(task);
}
export type TaskCommand = {
  requestId: string;
  digest: string;
  operation: string;
  taskId: string;
  expectedRevision?: number;
  expectedRunId?: string;
  createdAt: number;
  recoveryToken?: string;
};
export type TaskChange = {
  task: LocalTaskRecord;
  run?: StoredRun;
  archived?: boolean;
  input?: { text: string; requestId: string };
};
export function localTaskStore(
  harness: Harness,
  context: Context,
  createChannel: (tx: Tx, task: LocalTaskRecord) => Promise<number>,
  accepted?: (task: LocalTaskMetadata) => Promise<void>,
) {
  const receipt = async (
    requestId: string,
    digest: string,
  ): Promise<TaskReceipt | undefined> => {
    const old = (await harness.snapshot(TaskReceipts, requestId, context))
      ?.receipt;
    if (old && old.digest !== digest)
      throw new ProtocolError(
        "request_conflict",
        "Task request ID was reused with different arguments",
      );
    return old;
  };
  return {
    receipt,
    async registry(): Promise<readonly TaskRegistryEntry[]> {
      return (await harness.snapshot(LocalTasksDoc, context))?.entries ?? [];
    },
    async metadata(taskId: string): Promise<LocalTaskMetadata | undefined> {
      return (await harness.snapshot(LocalTaskDoc, taskId, context))?.task;
    },
    async get(taskId: string): Promise<LocalTaskRecord | undefined> {
      const task = (await harness.snapshot(LocalTaskDoc, taskId, context))
        ?.task;
      if (!task) return;
      const brief = await harness.snapshot(TaskBriefDoc, taskId, context);
      if (!brief) throw Error("Retained task inputs are unavailable");
      return { ...task, inputs: brief.inputs, skills: brief.skills };
    },
    async command(
      command: TaskCommand,
      change: (
        task: LocalTaskRecord | undefined,
        run: StoredRun | undefined,
      ) => TaskChange,
    ): Promise<TaskReceipt> {
      const result = await harness.commit(async (tx) => {
        const receipts = await tx.doc(TaskReceipts, command.requestId, null);
        if (receipts.receipt) {
          if (receipts.receipt.digest !== command.digest)
            throw new ProtocolError(
              "request_conflict",
              "Task request ID was reused with different arguments",
            );
          return { ...receipts.receipt };
        }
        const doc = await tx.doc(LocalTaskDoc, command.taskId, null),
          brief = await tx.doc(TaskBriefDoc, command.taskId, null);
        const previous = doc.task
          ? { ...doc.task, inputs: brief.inputs, skills: brief.skills }
          : undefined;
        const registry = await tx.doc(LocalTasksDoc),
          runs = await tx.doc(RunsDoc);
        if (
          command.expectedRevision !== undefined &&
          (!previous ||
            previous.commandRevision !== command.expectedRevision ||
            (command.expectedRunId !== undefined &&
              previous.currentRunId !== command.expectedRunId))
        )
          throw new ProtocolError(
            "request_conflict",
            "Task changed. Refresh before trying again.",
            previous === undefined ? undefined : { currentRevision: previous.commandRevision },
          );
        if (command.operation === "submit" && previous) {
          const operations = Object.values(
            (await tx.doc(PolicyDoc)).operations ?? {},
          )
            .filter((o) => o.runId === previous.currentRunId)
            .sort((a, b) => a.id.localeCompare(b.id));
          const token = createHash("sha256")
            .update(
              JSON.stringify([
                previous.taskId,
                previous.currentRunId,
                previous.commandRevision,
                previous.settlement,
                operations,
              ]),
            )
            .digest("hex");
          if (operations.length && command.recoveryToken !== token)
            throw new ProtocolError(
              "invalid_request",
              "Review and acknowledge the current uncertain effects before continuing",
            );
        }
        const next = change(
          previous,
          previous ? runs.runs[previous.currentRunId] : undefined,
        );
        if (next.task.taskId !== command.taskId)
          throw new Error("Task identity changed");
        let entry = registry.entries.find(
          (item) => item.taskId === command.taskId,
        );
        const archive = next.archived ?? entry?.archived ?? false;
        if (
          !archive &&
          (!entry || entry.archived) &&
          registry.entries.filter((item) => !item.archived).length >=
            LOCAL_TASK_LIMITS.active
        )
          throw new ProtocolError(
            "invalid_request",
            "Archive a settled task before adding another active task",
          );
        const value = copy(next.task);
        if (!previous) {
          value.conversationId = await createChannel(tx, value);
          entry = {
            taskId: command.taskId,
            createdAt: command.createdAt,
            archived: archive,
          };
          registry.entries.push(entry);
        }
        if (!entry) throw new Error("Task registry is missing");
        entry.archived = archive;
        if (next.input) {
          if (
            !next.input.text.trim() ||
            Buffer.byteLength(next.input.text) > LOCAL_TASK_LIMITS.inputBytes ||
            value.inputs.length >= LOCAL_TASK_LIMITS.inputs ||
            value.inputs.reduce((n, i) => n + Buffer.byteLength(i.text), 0) +
              Buffer.byteLength(next.input.text) >
              LOCAL_TASK_LIMITS.briefBytes
          )
            throw new ProtocolError(
              "invalid_request",
              "Task input limit reached. Start a new task with selected context.",
            );
          const anchor = await tx.appendEntry(
            value.conversationId as ConversationId,
            {
              kind: "openbot.user-input",
              data: {
                text: next.input.text,
                attachments: previous ? [] : copy(value.attachments),
                skills: previous
                  ? []
                  : value.skills.map(({ name, revision, sha256 }) => ({
                      name,
                      revision,
                      sha256,
                    })),
                at: command.createdAt,
              },
            },
          );
          value.inputs.push({ ...next.input, anchor: String(anchor.id) });
        }
        brief.inputs = copy(value.inputs);
        brief.skills = copy(value.skills);
        doc.task = {
          ...value,
          inputs: value.inputs.map(({ requestId, anchor, text }) => ({
            requestId,
            anchor,
            bytes: Buffer.byteLength(text),
          })),
          skills: value.skills.map(({ name, revision, sha256 }) => ({
            name,
            revision,
            sha256,
          })),
        };
        if (next.run) {
          const run = copy(next.run);
          if (
            run.taskId !== value.taskId ||
            run.runId !== value.currentRunId ||
            run.botId !== value.botId ||
            run.channelId !== value.channelId ||
            run.origin !== "task"
          )
            throw new Error("Task Run binding is invalid");
          await recordOutcomes(tx, run, runs.runs[run.runId]);
          runs.runs[run.runId] = run;
        }
        receipts.receipt = {
          requestId: command.requestId,
          digest: command.digest,
          operation: command.operation,
          ...(command.recoveryToken
            ? { recoveryToken: command.recoveryToken }
            : {}),
          taskId: value.taskId,
          commandRevision: value.commandRevision,
          runId: value.currentRunId,
        };
        return { ...receipts.receipt };
      }, context);
      const task = (
        await harness.snapshot(LocalTaskDoc, result.taskId, context)
      )?.task;
      if (task) await accepted?.(task);
      return result;
    },
    async settle(
      taskId: string,
      runId: string,
      confirmedAt: number,
      result?: LocalTaskRecord["result"],
    ): Promise<void> {
      await harness.commit(async (tx) => {
        const doc = await tx.doc(LocalTaskDoc, taskId, null);
        if (!doc.task || doc.task.currentRunId !== runId) return;
        doc.task.settlement = { runId, confirmedAt };
        if (result && !doc.task.stopIntent) doc.task.result = copy(result);
      }, context);
    },
    async assertRun(runId: string): Promise<LocalTaskMetadata | undefined> {
      return harness.commit(async (tx) => {
        const run = (await tx.doc(RunsDoc)).runs[runId];
        if (!run) throw new ProtocolError("not_found", "Run is unavailable");
        return assertTaskRun(tx, run);
      }, context);
    },
  };
}
export type LocalTaskStore = ReturnType<typeof localTaskStore>;
