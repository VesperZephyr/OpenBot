import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BotRuntime,
  type LocalTaskRecord,
  type StoredRun,
} from "../src/index.ts";
import { scriptedModels } from "../src/testing.ts";

let directory: string, runtime: BotRuntime, botId: string;
const open = () =>
  BotRuntime.open({
    databasePath: join(directory, "openbot.sqlite"),
    history: false,
    models: scriptedModels().models,
  });
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "openbot-local-tasks-"));
  runtime = await open();
  botId = (await runtime.ensureCoreBot(0)).botId;
});
afterEach(async () => {
  await runtime.close();
  await rm(directory, { recursive: true, force: true });
});
function candidate(id = "task_a"): {
  task: LocalTaskRecord;
  run: StoredRun;
  input: { requestId: string; text: string };
} {
  const task: LocalTaskRecord = {
    taskId: id,
    botId,
    target: { kind: "local", targetId: "mac" },
    channelId: id,
    conversationId: 0,
    title: "Research",
    outputRoot: join(directory, id),
    commandRevision: 1,
    currentRunId: `run_${id}`,
    inputs: [],
    attachments: [],
    skills: [],
  };
  return {
    task,
    run: {
      runId: task.currentRunId,
      botId,
      channelId: id,
      taskId: id,
      origin: "task",
      messageMode: "messages-v1",
      state: "queued",
      createdAt: 1,
      requestIds: [id],
      messages: [{ requestId: id, text: "Research" }],
      inputs: [],
    },
    input: { requestId: id, text: "Research" },
  };
}
it("atomic acceptance and durable replay", async () => {
  const value = candidate();
  const command = {
    taskId: value.task.taskId,
    requestId: "create",
    digest: "input-a",
    operation: "create",
    createdAt: 1,
  };
  await expect(
    runtime.tasks().command(command, () => ({
      ...value,
      run: { ...value.run, taskId: "wrong" },
    })),
  ).rejects.toThrow("binding");
  expect(await runtime.channels()).toEqual([]);
  expect(await runtime.tasks().registry()).toEqual([]);
  expect(await runtime.tasks().receipt("create", "input-a")).toBeUndefined();
  expect(await runtime.runsStore().get(value.run.runId)).toBeUndefined();
  const accepted = await runtime.tasks().command(command, () => value);
  const task = (await runtime.tasks().get(value.task.taskId))!;
  expect(task.inputs).toMatchObject([
    { requestId: value.task.taskId, text: "Research" },
  ]);
  expect(await runtime.channels()).toMatchObject([
    { kind: "task", taskId: task.taskId, conversationId: task.conversationId },
  ]);
  await runtime.close();
  runtime = await open();
  expect(
    await runtime.tasks().command(command, () => {
      throw Error("Replay must not revalidate material");
    }),
  ).toEqual(accepted);
  await expect(
    runtime.tasks().command({ ...command, digest: "different" }, () => value),
  ).rejects.toThrow("reused");
  expect(
    (await runtime.snapshot(botId, task.channelId, "omit")).channelId,
  ).toBe(task.channelId);
  expect(
    (await runtime.snapshot(botId, task.channelId)).items.filter(
      (i) => i.kind === "user",
    ),
  ).toHaveLength(1);
  expect((await runtime.snapshot(botId)).items).toHaveLength(0);
});
it("serializes competing revisions and the active task bound", async () => {
  const value = candidate();
  await runtime.tasks().command(
    {
      taskId: value.task.taskId,
      requestId: "create",
      digest: "create",
      operation: "create",
      createdAt: 1,
    },
    () => value,
  );
  const commands = await Promise.allSettled(
    ["a", "b"].map((id) =>
      runtime.tasks().command(
        {
          taskId: value.task.taskId,
          requestId: id,
          digest: id,
          operation: "stop",
          expectedRevision: 1,
          expectedRunId: value.run.runId,
          createdAt: 2,
        },
        (task) => ({
          task: {
            ...task!,
            commandRevision: 2,
            stopIntent: {
              runId: value.run.runId,
              requestId: id,
              requestedAt: 2,
            },
          },
        }),
      ),
    ),
  );
  expect(commands.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(commands.filter((r) => r.status === "rejected")).toHaveLength(1);
  for (let i = 1; i < 32; i++) {
    const v = candidate(`task_${i}`);
    await runtime.tasks().command(
      {
        taskId: v.task.taskId,
        requestId: `create_${i}`,
        digest: String(i),
        operation: "create",
        createdAt: i,
      },
      () => v,
    );
  }
  const extra = candidate("task_extra");
  await expect(
    runtime.tasks().command(
      {
        taskId: extra.task.taskId,
        requestId: "extra",
        digest: "extra",
        operation: "create",
        createdAt: 33,
      },
      () => extra,
    ),
  ).rejects.toThrow("Archive");
  expect(await runtime.channels()).toHaveLength(32);
  const archived = [];
  for (const id of ["archive_a", "archive_b"]) {
    const v = candidate(id);
    await runtime
      .tasks()
      .command(
        {
          taskId: id,
          requestId: id,
          digest: id,
          operation: "create",
          createdAt: 40,
        },
        () => ({ ...v, archived: true }),
      );
    archived.push(id);
  }
  await runtime
    .tasks()
    .command(
      {
        taskId: "task_1",
        requestId: "free",
        digest: "free",
        operation: "archive",
        expectedRevision: 1,
        createdAt: 41,
      },
      (task) => ({ task: { ...task!, commandRevision: 2 }, archived: true }),
    );
  const competing = await Promise.allSettled(
    archived.map((id) =>
      runtime
        .tasks()
        .command(
          {
            taskId: id,
            requestId: `unarchive-${id}`,
            digest: id,
            operation: "archive",
            expectedRevision: 1,
            createdAt: 42,
          },
          (task) => ({
            task: { ...task!, commandRevision: 2 },
            archived: false,
          }),
        ),
    ),
  );
  expect(competing.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    (await runtime.tasks().registry()).filter((e) => !e.archived),
  ).toHaveLength(32);
});
it("rolls back oversized accepted input and fences a stopped task Run", async () => {
  const value = candidate();
  await expect(
    runtime.tasks().command(
      {
        taskId: value.task.taskId,
        requestId: "large",
        digest: "large",
        operation: "create",
        createdAt: 1,
      },
      () => ({
        ...value,
        input: { requestId: "large", text: "🦊".repeat(6145) },
      }),
    ),
  ).rejects.toThrow("input limit");
  expect(await runtime.channels()).toEqual([]);
  await runtime.tasks().command(
    {
      taskId: value.task.taskId,
      requestId: "create",
      digest: "create",
      operation: "create",
      createdAt: 1,
    },
    () => ({ ...value, run: { ...value.run, state: "running" } }),
  );
  expect((await runtime.tasks().assertRun(value.run.runId))?.taskId).toBe(
    value.task.taskId,
  );
  await runtime.tasks().command(
    {
      taskId: value.task.taskId,
      requestId: "stop",
      digest: "stop",
      operation: "stop",
      expectedRevision: 1,
      expectedRunId: value.run.runId,
      createdAt: 2,
    },
    (task) => ({
      task: {
        ...task!,
        commandRevision: 2,
        stopIntent: {
          runId: value.run.runId,
          requestId: "stop",
          requestedAt: 2,
        },
      },
    }),
  );
  await expect(runtime.tasks().assertRun(value.run.runId)).rejects.toThrow(
    "no longer authorized",
  );
  await runtime.close();
  runtime = await open();
  await expect(runtime.tasks().assertRun(value.run.runId)).rejects.toThrow(
    "no longer authorized",
  );
});
it("stale Always allow and publication cannot cross a task stop fence", async () => {
  const value = candidate();
  await runtime.tasks().command(
    {
      taskId: value.task.taskId,
      requestId: "create",
      digest: "create",
      operation: "create",
      createdAt: 1,
    },
    () => ({ ...value, run: { ...value.run, state: "running" } }),
  );
  const task = (await runtime.tasks().get(value.task.taskId))!;
  const approval = {
    approvalId: "task-approval",
    botId,
    conversationId: String(task.conversationId),
    callId: "write",
    tool: "local_write",
    args: { path: join(directory, "report.md") },
    target: task.target,
    reason: "Write report",
    createdAt: 1,
    state: "pending" as const,
    binding: {
      runId: value.run.runId,
      origin: "unattended" as const,
      argsDigest: "digest",
      revision: 0,
    },
  };
  await runtime.approvals().put(approval);
  await runtime.tasks().command(
    {
      taskId: task.taskId,
      requestId: "stop",
      digest: "stop",
      operation: "stop",
      expectedRevision: 1,
      expectedRunId: value.run.runId,
      createdAt: 2,
    },
    (old) => ({
      task: {
        ...old!,
        commandRevision: 2,
        stopIntent: {
          runId: value.run.runId,
          requestId: "stop",
          requestedAt: 2,
        },
      },
    }),
  );
  const saved = {
    id: "escape-grant",
    createdAt: 2,
    scope: {
      kind: "folder" as const,
      path: directory,
      access: "readwrite" as const,
    },
  };
  await expect(
    runtime
      .approvals()
      .put({ ...approval, state: "allowed", decision: "allow_once" }, saved),
  ).rejects.toThrow("no longer authorized");
  expect(await runtime.policy().grants()).toHaveLength(0);
  await expect(
    runtime.approvals().put(
      {
        ...approval,
        binding: { ...approval.binding, runId: "pruned-run" },
        state: "allowed",
        decision: "allow_once",
      },
      saved,
    ),
  ).rejects.toThrow("no longer authorized");
  expect(await runtime.policy().grants()).toHaveLength(0);
  await expect(
    runtime.messages().publish(
      {
        botId,
        conversationId: String(task.conversationId),
        runId: value.run.runId,
        callId: "publish",
        targetId: "mac",
        text: "Late answer",
      },
      () => {},
    ),
  ).rejects.toThrow();
});
it("task retention keeps current inputs and accepted receipts after old Runs are pruned", async () => {
  const value = candidate();
  const accepted = await runtime.tasks().command(
    {
      taskId: value.task.taskId,
      requestId: "create",
      digest: "create",
      operation: "create",
      createdAt: 1,
    },
    () => value,
  );
  for (let i = 0; i < 55; i++)
    await runtime.runsStore().put({
      ...value.run,
      runId: `past_${i}`,
      state: "completed",
      createdAt: i + 2,
      endedAt: i + 2,
    });
  expect(
    (await runtime.runsStore().list()).filter((r) =>
      r.runId.startsWith("past_"),
    ),
  ).toHaveLength(50);
  expect(await runtime.runsStore().get(value.run.runId)).toBeDefined();
  expect((await runtime.tasks().get(value.task.taskId))?.inputs).toHaveLength(
    1,
  );
  expect(await runtime.tasks().receipt("create", "create")).toEqual(accepted);
  await expect(runtime.tasks().receipt("create", "changed")).rejects.toThrow(
    "reused",
  );
});

it.each([{ name: "input count", count: 32, text: "x" }, { name: "brief bytes", count: 5, text: "x".repeat(24 * 1024) }])("retains the last accepted revision when $name is exhausted", async ({ count, text }) => {
  const value = candidate();
  for (let i = 0; i <= count; i++) {
    const runId = `bounded-${i}`;
    const command = runtime.tasks().command({ taskId: value.task.taskId, requestId: `bounded-${i}`, digest: `bounded-${i}`, operation: i ? "submit" : "create", createdAt: i, ...(i ? { expectedRevision: i, expectedRunId: `bounded-${i - 1}` } : {}) }, task => ({ task: { ...(task ?? value.task), commandRevision: i + 1, currentRunId: runId }, run: { ...value.run, runId }, input: { requestId: `bounded-${i}`, text } }));
    if (i === count) await expect(command).rejects.toThrow("input limit");
    else { await command; await runtime.tasks().settle(value.task.taskId, runId, i); }
  }
  const saved = (await runtime.tasks().get(value.task.taskId))!;
  expect(saved.commandRevision).toBe(count);
  expect(saved.inputs).toHaveLength(count);
  expect(saved.currentRunId).toBe(`bounded-${count - 1}`);
  expect(await runtime.tasks().receipt(`bounded-${count}`, `bounded-${count}`)).toBeUndefined();
});
