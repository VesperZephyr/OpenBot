import {
  Harness,
  createRegistry,
  ProviderDoc,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { BotsDoc } from "../src/bots.ts";
import { ChannelsDoc } from "../src/channels.ts";
import { LocalTasksDoc, LocalTaskDoc } from "../src/local-tasks.ts";
import { RunsDoc } from "../src/runs.ts";
import { scriptedModels } from "../src/testing.ts";
export async function seedArchivedTasks(
  databasePath: string,
  count = 1000,
  rows = 10000,
) {
  const harness = await Harness.open(
    await openNodeSqliteStorage(databasePath),
    { models: scriptedModels().models, registry: createRegistry() },
    BACKGROUND_CONTEXT,
  );
  try {
    const core = Object.values(
      (await harness.snapshot(BotsDoc, BACKGROUND_CONTEXT))!.bots,
    ).find((b) => b.kind === "core")!;
    let first: import("@earendil-works/pi-durable").ConversationId | undefined;
    for (let start = 0; start < count; start += 32)
      await harness.commit(async (tx) => {
        const registry = await tx.doc(LocalTasksDoc),
          channels = await tx.doc(ChannelsDoc),
          runs = await tx.doc(RunsDoc);
        for (let i = start; i < Math.min(start + 32, count); i++) {
          const taskId = `archive_${String(i).padStart(4, "0")}`,
            runId = `run_${taskId}`,
            conversation = await tx.createConversation({
              ownership: { kind: "ownerless" },
            });
          first ??= conversation.id;
          await tx.doc(ProviderDoc, conversation.id);
          registry.entries.push({ taskId, createdAt: i, archived: true });
          channels.channels[JSON.stringify([core.botId, taskId])] = {
            botId: core.botId,
            channelId: taskId,
            conversationId: conversation.id,
            kind: "task",
            taskId,
          };
          (await tx.doc(LocalTaskDoc, taskId, null)).task = {
            taskId,
            botId: core.botId,
            target: { kind: "local", targetId: "mac" },
            channelId: taskId,
            conversationId: conversation.id,
            title: `Archive ${i}`,
            outputRoot: `/fixture/tasks/${taskId}`,
            commandRevision: 1,
            currentRunId: runId,
            inputs: [{ requestId: `input_${i}`, anchor: "1", bytes: 4 }],
            attachments: [],
            skills: [],
            settlement: { runId, confirmedAt: i },
          };
          runs.runs[runId] = {
            runId,
            botId: core.botId,
            taskId,
            channelId: taskId,
            origin: "task",
            state: "completed",
            createdAt: i,
            endedAt: i,
            requestIds: [],
            messages: [],
            inputs: [],
          };
        }
      }, BACKGROUND_CONTEXT);
    for (let start = 0; start < rows; start += 128)
      await harness.commit(async (tx) => {
        for (let i = start; i < Math.min(start + 128, rows); i++)
          await tx.appendEntry(first!, {
            kind: "openbot.bot-message",
            data: {
              text: `Archived task evidence ${i} ${"retained evidence ".repeat(8)}`,
              at: i,
              callId: `call_${i}`,
            },
          });
      }, BACKGROUND_CONTEXT);
    return { botId: core.botId, taskId: "archive_0000" };
  } finally {
    await harness.close(BACKGROUND_CONTEXT);
  }
}

export async function seedTaskUncertainty(
  databasePath: string,
  taskId: string,
) {
  const { BotRuntime } = await import("../src/index.ts");
  const runtime = await BotRuntime.open({ databasePath, history: false });
  try {
    const task = (await runtime.tasks().metadata(taskId))!;
    await runtime
      .policy()
      .remember({
        id: `${task.conversationId}:uncertain-report`,
        botId: task.botId,
        conversationId: String(task.conversationId),
        runId: task.currentRunId,
        tool: "local_write",
        argsJson: JSON.stringify({
          path: `${task.outputRoot}/${task.currentRunId}/report.md`,
          content: "A file write whose response was lost",
        }),
        revision: (await runtime.policy().settings()).revision,
      });
  } finally {
    await runtime.close();
  }
}
