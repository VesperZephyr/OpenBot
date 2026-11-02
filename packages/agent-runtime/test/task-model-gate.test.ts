import { expect, it } from "vitest";
import type { CommitPublication } from "@earendil-works/pi-durable";
import { TaskModelGate } from "../src/task-model-gate.ts";
import { scriptedModels } from "../src/testing.ts";
import type { StoredRun } from "../src/runs.ts";
const run: StoredRun = {
  runId: "run-a",
  botId: "core",
  taskId: "task-a",
  channelId: "task-a",
  origin: "task",
  state: "running",
  createdAt: 1,
  requestIds: ["input"],
  messages: [],
  inputs: [],
};
const task = { taskId: "task-a", currentRunId: run.runId };
it.each(["generation", "compaction"])(
  "task stop fences %s after asynchronous provider preparation",
  async (kind) => {
    const scripted = scriptedModels("Must not run"),
      gate = new TaskModelGate();
    const provider = scripted.models.getProviders()[0]!;
    scripted.models.setProvider(gate.provider(provider));
    gate.register("task-provider", task, run);
    const entered = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    const messages = [{ role: "user" as const, content: "test", timestamp: 0 }];
    const request = scripted.models
      .streamSimple(
        scripted.models.getModel("faux", "faux-1")!,
        {
          messages:
            kind === "generation"
              ? [...gate.bind(messages, task, run)]
              : messages,
        },
        {
          sessionId: "task-provider",
          transformHeaders: async (headers) => {
            entered.resolve();
            await release.promise;
            return headers;
          },
        },
      )
      .result();
    await entered.promise;
    gate.committed({
      changes: [
        {
          type: "document",
          record: { kind: "openbot.local-task" },
          value: {
            task: {
              ...task,
              stopIntent: {
                runId: run.runId,
                requestId: "stop",
                requestedAt: 2,
              },
            },
          },
        },
      ],
    } as unknown as CommitPublication);
    release.resolve();
    expect((await request).stopReason).not.toBe("stop");
    expect(scripted.requests()).toBe(0);
  },
);
it("keeps direct Core dispatch independent of a stopped task", async () => {
  const scripted = scriptedModels("Core reply"),
    gate = new TaskModelGate();
  scripted.models.setProvider(
    gate.provider(scripted.models.getProviders()[0]!),
  );
  gate.register(
    "task-provider",
    {
      ...task,
      stopIntent: { runId: run.runId, requestId: "stop", requestedAt: 2 },
    },
    run,
  );
  const response = await scripted.models.completeSimple(
    scripted.models.getModel("faux", "faux-1")!,
    { messages: [] },
    { sessionId: "core-provider" },
  );
  expect(response.stopReason).toBe("stop");
  expect(scripted.requests()).toBe(1);
});

it("does not attach a delayed old request to the next Run's provider session", async () => {
  const scripted = scriptedModels("Must not run"),
    gate = new TaskModelGate();
  scripted.models.setProvider(
    gate.provider(scripted.models.getProviders()[0]!),
  );
  gate.register("task-provider", task, run);
  const messages = gate.bind(
    [{ role: "user", content: "old", timestamp: 0 }],
    task,
    run,
  );
  gate.committed({
    changes: [
      {
        type: "document",
        record: { kind: "openbot.local-task" },
        value: { task: { ...task, currentRunId: "run-b" } },
      },
      {
        type: "document",
        record: { kind: "openbot.runs" },
        value: { runs: { "run-b": { ...run, runId: "run-b" } } },
      },
    ],
  } as unknown as CommitPublication);
  const result = await scripted.models.completeSimple(
    scripted.models.getModel("faux", "faux-1")!,
    { messages: [...messages] },
    { sessionId: "task-provider" },
  );
  expect(result.stopReason).not.toBe("stop");
  expect(scripted.requests()).toBe(0);
});
