import { mkdtemp, rm, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BotRuntime } from "@openbot/agent-runtime";
import { scriptedModels, SCRIPTED_MODEL } from "@openbot/agent-runtime/testing";
import { PROTOCOL_VERSION, TOOL_CATALOG } from "@openbot/protocol";
import { HostService, ApprovalBook, MemorySecretStore } from "../src/index.ts";
let directory: string, runtime: BotRuntime, service: HostService, core: string;
let scripted: ReturnType<typeof scriptedModels>;
let hostClock: number | undefined;
const gates = new Map<string, PromiseWithResolvers<void>>();
const entered = new Set<string>();
let revoke = vi.fn(async (_ids: readonly string[]) => {});
beforeEach(async () => {
  hostClock = undefined;
  revoke = vi.fn(async (_ids: readonly string[]) => {});
  directory = await mkdtemp(join(tmpdir(), "openbot-tasks-host-"));
  gates.clear();
  entered.clear();
  scripted = scriptedModels();
  runtime = await BotRuntime.open({
    databasePath: join(directory, "db"),
    history: false,
    models: scripted.models,
    tools: {
      definitions: TOOL_CATALOG.filter((d) => d.name === "local_read"),
      invoke: async (call) => {
        await service.tasks.assertExecution(call);
        const key = String(call.args.path);
        entered.add(key);
        const gate = Promise.withResolvers<void>();
        gates.set(key, gate);
        const aborted = Promise.withResolvers<void>();
        call.signal.addEventListener("abort", () => aborted.resolve(), {
          once: true,
        });
        await Promise.race([gate.promise, aborted.promise]);
        return {
          status: call.signal.aborted ? "cancelled" : "succeeded",
          output: "Read complete",
        };
      },
    },
  });
  await start();
  core = (await runtime.ensureCoreBot(0)).botId;
  await runtime.setDefaultModel(SCRIPTED_MODEL);
});
async function start(cap = 3) {
  service = new HostService({
    maxActiveRuns: cap,
    now: () => hostClock ?? Date.now(),
    authorityExecutor: {
      synchronize: async () => {},
      revoke: (ids) => revoke(ids),
    },
    runtime,
    workspace: directory,
    dataDirectory: directory,
    status: {
      protocolVersion: PROTOCOL_VERSION,
      hostVersion: "test",
      nodeVersion: "test",
      targetId: "mac",
      startedAt: 0,
    },
    secrets: new MemorySecretStore(),
    approvals: new ApprovalBook(() => {}),
    emit: () => {},
    modelConfig: {
      path: join(directory, "models.json"),
      read: async () => undefined,
      write: async () => {},
      environment: { env: () => undefined, run: async () => "" },
    },
  });
  await service.start();
}
afterEach(async () => {
  for (const g of gates.values()) g.resolve();
  await service.stop();
  await runtime.close();
  await rm(directory, { recursive: true, force: true });
});
const control = (
  s: { taskId: string; commandRevision: number; currentRunId: string },
  requestId: string,
) => ({
  taskId: s.taskId,
  requestId,
  expectedRevision: s.commandRevision,
  expectedRunId: s.currentRunId,
});
it("two tasks leave Core responsive and preserve separate results", async () => {
  scripted.answer(
    { tool: "local_read", args: { path: "a" } },
    { tool: "local_read", args: { path: "b" } },
    "Core answer",
    "A report",
    "B report",
  );
  const a = await service.handle("tasks.create", {
    requestId: "a",
    text: "Research A",
  });
  await vi.waitFor(() => expect(entered.has("a")).toBe(true));
  const b = await service.handle("tasks.create", {
    requestId: "b",
    text: "Research B",
  });
  await vi.waitFor(() => expect(entered.has("b")).toBe(true));
  const direct = await service.handle("messages.submit", {
    botId: core,
    requestId: "core",
    text: "Hello",
  });
  await vi.waitFor(async () =>
    expect((await runtime.runsStore().get(direct.runId))?.state).toBe(
      "completed",
    ),
  );
  expect((await service.handle("tasks.get", { taskId: a.taskId })).busy).toBe(
    true,
  );
  expect((await service.handle("tasks.get", { taskId: b.taskId })).busy).toBe(
    true,
  );
  gates.get("a")!.resolve();
  await vi.waitFor(async () =>
    expect(
      (await service.handle("tasks.get", { taskId: a.taskId })).state,
    ).toBe("result"),
  );
  gates.get("b")!.resolve();
  await vi.waitFor(async () =>
    expect(
      (await service.handle("tasks.get", { taskId: b.taskId })).state,
    ).toBe("result"),
  );
  expect(await runtime.listBots()).toHaveLength(1);
  expect(
    (await runtime.snapshot(core)).items.filter((i) => i.kind === "assistant"),
  ).toMatchObject([{ parts: [{ type: "text", text: "Core answer" }] }]);
  expect(scripted.requests()).toBe(5);
});
it("explicit edits and stale controls", async () => {
  scripted.answer(
    { tool: "local_read", args: { path: "a" } },
    "Revised report",
  );
  const created = await service.handle("tasks.create", {
    requestId: "a",
    text: "Original task",
  });
  await vi.waitFor(() => expect(entered.has("a")).toBe(true));
  const first = await service.handle("tasks.get", { taskId: created.taskId });
  await expect(
    service.handle("tasks.submit", {
      ...control(first, "busy"),
      input: { kind: "input", text: "Change dates" },
    }),
  ).rejects.toThrow("Stop");
  await expect(
    service.handle("runs.cancel", { runId: first.currentRunId }),
  ).rejects.toThrow("task Stop");
  const stopped = await service.handle("tasks.stop", control(first, "stop"));
  await vi.waitFor(async () =>
    expect(
      (await service.handle("tasks.get", { taskId: created.taskId })).busy,
    ).toBe(false),
  );
  expect(scripted.requests()).toBe(1);
  const current = await service.handle("tasks.get", { taskId: created.taskId });
  const next = await service.handle("tasks.submit", {
    ...control(current, "edit"),
    input: { kind: "input", text: "Change dates" },
  });
  expect(next.runId).not.toBe(created.runId);
  const replay = await service.handle("tasks.stop", control(first, "stop"));
  expect(replay.commandRevision).toBe(stopped.commandRevision);
  expect(replay.snapshot.currentRunId).toBe(next.runId);
  await expect(
    service.handle("tasks.stop", control(first, "stale")),
  ).rejects.toThrow("changed");
  await vi.waitFor(async () =>
    expect(
      (await service.handle("tasks.get", { taskId: created.taskId })).state,
    ).toBe("result"),
  );
  const record = await runtime.tasks().get(created.taskId);
  expect(record?.inputs.map((i) => i.text)).toEqual([
    "Original task",
    "Change dates",
  ]);
  expect(
    (await runtime.snapshot(core, record!.channelId)).items.filter(
      (i) => i.kind === "user",
    ),
  ).toHaveLength(2);
});
it.each([1, 2, 3])("task lanes reserve capacity at cap %i", async (cap) => {
  await service.stop();
  await start(cap);
  scripted.answer(
    { tool: "local_read", args: { path: "a" } },
    ...(cap === 3 ? [{ tool: "local_read", args: { path: "b" } }] : []),
    "Core reply",
    "Remaining reply",
    "Last reply",
  );
  const a = await service.handle("tasks.create", { requestId: "a", text: "A" });
  await vi.waitFor(() => expect(entered.has("a")).toBe(true));
  const b = await service.handle("tasks.create", { requestId: "b", text: "B" });
  if (cap === 3) await vi.waitFor(() => expect(entered.has("b")).toBe(true));
  else
    expect(
      (await service.handle("tasks.get", { taskId: b.taskId })).run.state,
    ).toBe("queued");
  const direct = await service.handle("messages.submit", {
    botId: core,
    requestId: "direct",
    text: "Core",
  });
  if (cap === 1) {
    expect(direct.state).toBe("queued");
    await service.handle(
      "tasks.stop",
      control(await service.tasks.get(a.taskId), "stop-a"),
    );
  }
  await vi.waitFor(async () =>
    expect((await runtime.runsStore().get(direct.runId))?.state).toBe(
      "completed",
    ),
  );
  if (cap > 1) expect((await service.tasks.get(b.taskId)).busy).toBe(true);
  for (const g of gates.values()) g.resolve();
});
it("quiescence is separate from effect certainty", async () => {
  scripted.answer({ tool: "local_read", args: { path: "a" } }, "Fresh report");
  const a = await service.tasks.create({ requestId: "a", text: "Research" });
  await vi.waitFor(() => expect(entered.has("a")).toBe(true));
  const record = (await runtime.tasks().get(a.taskId))!;
  await runtime.policy().remember({
    id: "lost-file-call",
    botId: core,
    conversationId: String(record.conversationId),
    runId: a.runId,
    tool: "local_write",
    argsJson: JSON.stringify({
      path: join(record.outputRoot, a.runId, "report.md"),
      content: "uncertain",
    }),
    revision: 0,
  });
  revoke.mockRejectedValue(new Error("Stop response was lost"));
  const stop = await service.tasks.stop(
    control(await service.tasks.get(a.taskId), "stop"),
  );
  await vi.waitFor(async () =>
    expect((await service.tasks.get(a.taskId)).state).toBe("attention"),
  );
  expect((await service.tasks.get(a.taskId)).busy).toBe(true);
  await expect(
    service.tasks.archive({
      taskId: a.taskId,
      requestId: "archive",
      expectedRevision: stop.commandRevision,
      archived: true,
    }),
  ).rejects.toThrow("settled");
  await expect(
    service.tasks.submit({
      ...control(await service.tasks.get(a.taskId), "early"),
      input: { kind: "continue" },
    }),
  ).rejects.toThrow();
  revoke.mockResolvedValue();
  await service.tasks.stop(
    control(await service.tasks.get(a.taskId), "recheck"),
  );
  await vi.waitFor(async () =>
    expect((await service.tasks.get(a.taskId)).recovery?.confirmed).toBe(true),
  );
  const settled = await service.tasks.get(a.taskId);
  expect(settled.recovery?.unknownCount).toBe(1);
  await expect(
    service.tasks.submit({
      ...control(settled, "no-ack"),
      input: { kind: "continue" },
    }),
  ).rejects.toThrow("acknowledge");
  await runtime.policy().remember({
    id: "late-evidence",
    botId: core,
    conversationId: String(record.conversationId),
    runId: a.runId,
    tool: "local_write",
    argsJson: "{}",
    revision: 0,
  });
  await expect(
    service.tasks.submit({
      ...control(settled, "stale-ack"),
      input: { kind: "continue" },
      recoveryToken: settled.recovery!.token!,
    }),
  ).rejects.toThrow("acknowledge");
  const current = await service.tasks.get(a.taskId);
  const fresh = await service.tasks.submit({
    ...control(current, "ack"),
    input: { kind: "continue" },
    recoveryToken: current.recovery!.token!,
  });
  expect(fresh.runId).not.toBe(a.runId);
  await vi.waitFor(async () =>
    expect((await service.tasks.get(a.taskId)).busy).toBe(false),
  );
  expect((await runtime.policy().operations()).map((o) => o.id)).toEqual([
    "lost-file-call",
    "late-evidence",
  ]);
  expect(
    (await runtime.runsStore().get(fresh.runId))?.messages[0]?.text,
  ).toContain(join(record.outputRoot, fresh.runId));
});
it("retained brief survives pre-admission stop and concurrent follow-ups", async () => {
  await service.handle("lifecycle.pause", {});
  const first = await service.tasks.create({
    requestId: "initial",
    text: "Original dates and required report",
  });
  const stopped = await service.tasks.stop(
    control(await service.tasks.get(first.taskId), "stop-before-admit"),
  );
  expect(stopped.snapshot.busy).toBe(false);
  expect(scripted.requests()).toBe(0);
  const both = await Promise.allSettled(
    ["one", "two"].map((id) =>
      service.tasks.submit({
        ...control(stopped.snapshot, id),
        input: { kind: "input", text: "Change the dates" },
      }),
    ),
  );
  expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const next = await service.tasks.get(first.taskId),
    run = await runtime.runsStore().get(next.currentRunId);
  expect(run?.messages[0]?.text).toContain(
    "Original dates and required report",
  );
  expect(run?.messages[0]?.text).toContain("Change the dates");
  expect(run?.state).toBe("queued");
  expect(scripted.requests()).toBe(0);
  scripted.answer("Revised report");
  await service.handle("lifecycle.resume", {});
  await vi.waitFor(async () =>
    expect((await service.tasks.get(first.taskId)).state).toBe("result"),
  );
  const record = (await runtime.tasks().get(first.taskId))!;
  expect(
    (await runtime.snapshot(core, record.channelId)).items.filter(
      (i) => i.kind === "user",
    ),
  ).toHaveLength(2);
});
it("fresh Run output grants and task context fail closed", async () => {
  scripted.answer({ tool: "local_read", args: { path: "a" } });
  const a = await service.tasks.create({ requestId: "a", text: "Report" });
  await vi.waitFor(() => expect(entered.has("a")).toBe(true));
  const task = (await runtime.tasks().get(a.taskId))!,
    base = {
      runId: a.runId,
      botId: core,
      conversationId: String(task.conversationId),
    };
  const root = join(task.outputRoot, a.runId);
  expect(
    await service.tasks.assertExecution({
      ...base,
      tool: "local_write",
      args: { path: join(root, "report.md") },
    }),
  ).toBe(root);
  for (const path of [
    join(directory, "input.md"),
    join(task.outputRoot, "old-run", "report.md"),
    join(root, "..", "escape.md"),
  ])
    await expect(
      service.tasks.assertExecution({
        ...base,
        tool: "local_write",
        args: { path },
      }),
    ).rejects.toThrow("output directory");
  for (const tool of [
    "local_exec",
    "mcp__service__write",
    "memory_write",
    "app_call",
    "skill_save",
  ])
    await expect(
      service.tasks.assertExecution({ ...base, tool, args: {} }),
    ).rejects.toThrow("unavailable");
  await expect(
    service.tasks.assertExecution({
      ...base,
      runId: "forged",
      tool: "local_read",
      args: { path: directory },
    }),
  ).rejects.toThrow("unavailable");
  await expect(
    service.tasks.assertExecution({
      ...base,
      tool: "local_edit",
      args: { path: join(root, "report.md") },
    }),
  ).rejects.toThrow("expected_sha256");
  await mkdir(task.outputRoot, { recursive: true });
  await symlink(directory, root);
  await expect(
    service.tasks.assertExecution({
      ...base,
      tool: "local_write",
      args: { path: join(root, "redirect.md") },
    }),
  ).rejects.toThrow("Run output root changed");
  await service.tasks.stop(control(await service.tasks.get(a.taskId), "stop"));
  await expect(
    service.tasks.assertExecution({
      ...base,
      tool: "local_read",
      args: { path: directory },
    }),
  ).rejects.toThrow("no longer authorized");
});
it("archive and bounded reads do not load archived briefs", async () => {
  const { seedArchivedTasks } = await import(
    "../../agent-runtime/test/task-history-fixture.ts"
  );
  await service.stop();
  await runtime.close();
  await seedArchivedTasks(join(directory, "db"));
  runtime = await BotRuntime.open({
    databasePath: join(directory, "db"),
    models: scripted.models,
  });
  await start();
  let cursor: string | undefined,
    total = 0;
  do {
    const page = await service.tasks.list({
      archived: true,
      ...(cursor ? { cursor } : {}),
    });
    expect(page.tasks.length).toBeLessThanOrEqual(32);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(65536);
    total += page.tasks.length;
    cursor = page.next;
  } while (cursor);
  expect(total).toBe(1000);
  expect(await service.tasks.list({})).toEqual({ tasks: [] });
  // Fixture omits brief bodies: control/list reads must never materialize them.
  await expect(runtime.tasks().get("archive_0000")).rejects.toThrow(
    "Retained task inputs",
  );
  const input = {
    conversationKey: `bot:${core}` as const,
    taskId: "archive_0000",
    position: { kind: "latest" as const },
  };
  await vi.waitFor(
    async () =>
      expect((await runtime.historyWindow(input)).status).toBe("ready"),
    { timeout: 15000 },
  );
  const result = await runtime.historyWindow(input);
  if (result.status !== "ready") throw Error("Missing window");
  expect(result.window.rows.length).toBeLessThanOrEqual(100);
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(
    1024 * 1024,
  );
  expect(result.window.before).toBeDefined();
  expect(result.window.readCursor).toBeUndefined();
  expect(scripted.requests()).toBe(0);
}, 45000);
it("terminal Pi with unconfirmed executor stop retains its slot across reopen", async () => {
  await service.stop();
  await start(2);
  scripted.answer(
    { tool: "local_read", args: { path: "a" } },
    "Core still responds",
    "B report",
  );
  const a = await service.tasks.create({ requestId: "a", text: "A" });
  await vi.waitFor(() => expect(entered.has("a")).toBe(true));
  const record = (await runtime.tasks().get(a.taskId))!;
  await runtime.policy().remember({
    id: "uncertain",
    botId: core,
    conversationId: String(record.conversationId),
    runId: a.runId,
    tool: "local_write",
    argsJson: "{}",
    revision: 0,
  });
  revoke.mockRejectedValue(Error("No stop confirmation"));
  await service.tasks.stop(control(await service.tasks.get(a.taskId), "stop"));
  await vi.waitFor(async () =>
    expect((await service.tasks.get(a.taskId)).state).toBe("attention"),
  );
  const b = await service.tasks.create({ requestId: "b", text: "B" });
  const direct = await service.handle("messages.submit", {
    botId: core,
    requestId: "direct",
    text: "Hello",
  });
  await vi.waitFor(async () =>
    expect((await runtime.runsStore().get(direct.runId))?.state).toBe(
      "completed",
    ),
  );
  expect((await service.tasks.get(b.taskId)).run.state).toBe("queued");
  await service.stop();
  await runtime.close();
  runtime = await BotRuntime.open({
    databasePath: join(directory, "db"),
    history: false,
    models: scripted.models,
  });
  await start(2);
  if (service.lifecycle.state.blocked)
    await service.handle("lifecycle.resume", {});
  expect((await service.tasks.get(b.taskId)).run.state).toBe("queued");
  expect((await service.tasks.get(a.taskId)).busy).toBe(true);
  expect(scripted.requests()).toBe(2);
  revoke.mockResolvedValue();
  await service.tasks.stop(
    control(await service.tasks.get(a.taskId), "recheck"),
  );
  await vi.waitFor(async () =>
    expect((await service.tasks.get(b.taskId)).state).toBe("result"),
  );
  expect(scripted.requests()).toBe(3);
  expect((await service.tasks.get(a.taskId)).recovery?.unknownCount).toBe(1);
});

it("rejects a preexisting redirected task directory before acceptance", async () => {
  const outside = join(directory, "outside");
  await mkdir(outside);
  await symlink(outside, join(directory, "tasks"));
  await expect(
    service.tasks.create({ requestId: "redirected", text: "Report" }),
  ).rejects.toThrow("must not be redirected");
  expect(await runtime.tasks().registry()).toHaveLength(0);
  expect(scripted.requests()).toBe(0);
});

it.each(["suspended", "quitting", "pause"])(
  "%s interrupts a task without restarting it on resume",
  async (reason) => {
    scripted.answer(
      { tool: "local_read", args: { path: "held" } },
      "Fresh result",
    );
    const a = await service.tasks.create({
      requestId: "lifecycle-task",
      text: "Research",
    });
    await vi.waitFor(() => expect(entered.has("held")).toBe(true));
    const native = {
      sourceId: "test",
      seq: 1,
      locked: false,
      suspended: false,
      quitting: false,
    };
    if (reason === "pause") await service.handle("lifecycle.pause", {});
    else
      await service.handle("lifecycle.native", { ...native, [reason]: true });
    await vi.waitFor(async () =>
      expect((await service.tasks.get(a.taskId)).busy).toBe(false),
    );
    const calls = scripted.requests();
    await service.handle("lifecycle.native", { ...native, seq: 2 });
    await service.handle("lifecycle.resume", {});
    const interrupted = await service.tasks.get(a.taskId);
    expect(interrupted.currentRunId).toBe(a.runId);
    expect(interrupted.state).toBe("interrupted");
    expect(scripted.requests()).toBe(calls);
    const fresh = await service.tasks.submit({
      ...control(interrupted, "explicit-resume"),
      input: { kind: "continue" },
    });
    expect(fresh.runId).not.toBe(a.runId);
    await vi.waitFor(async () =>
      expect((await service.tasks.get(a.taskId)).state).toBe("result"),
    );
  },
);

it("drains saturated legacy lanes without preemption and reserves Core admission", async () => {
  for (const id of ["one", "two", "three"])
    await runtime.createBot({ botId: id, name: id, createdAt: 0 });
  scripted.answer(
    ...["one", "two", "three"].map((path) => ({
      tool: "local_read",
      args: { path },
    })),
    "Core answered",
    { tool: "local_read", args: { path: "task" } },
  );
  const legacy = [];
  for (const id of ["one", "two", "three"]) {
    legacy.push(
      await service.handle("messages.submit", {
        botId: id,
        requestId: id,
        text: "Hold",
      }),
    );
    await vi.waitFor(() => expect(entered.has(id)).toBe(true));
  }
  const task = await service.tasks.create({
    requestId: "task",
    text: "Report",
  });
  expect((await service.tasks.get(task.taskId)).waitingForCapacity).toBe(true);
  const direct = await service.handle("messages.submit", {
    botId: core,
    requestId: "core",
    text: "Hello",
  });
  expect(direct.state).toBe("queued");
  expect(legacy.map((r) => r.state)).toEqual(["running", "running", "running"]);
  await service.handle("runs.cancel", { runId: legacy[0]!.runId });
  await vi.waitFor(async () =>
    expect((await runtime.runsStore().get(direct.runId))?.state).toBe(
      "completed",
    ),
  );
  expect((await service.tasks.get(task.taskId)).run.state).toBe("queued");
  expect((await runtime.runsStore().get(legacy[2]!.runId))?.state).toBe(
    "running",
  );
  await service.handle("runs.cancel", { runId: legacy[1]!.runId });
  await vi.waitFor(() => expect(entered.has("task")).toBe(true));
});
it("aged task work wins the general slot and settlement releases the reserve", async () => {
  await service.stop();
  await start(2);
  hostClock = 1;
  for (const id of ["blocker", "newer", "last"])
    await runtime.createBot({ botId: id, name: id, createdAt: 0 });
  scripted.answer(
    { tool: "local_read", args: { path: "blocker" } },
    { tool: "local_read", args: { path: "aged-task" } },
    { tool: "local_read", args: { path: "newer" } },
    { tool: "local_read", args: { path: "last" } },
  );
  const blocker = await service.handle("messages.submit", {
    botId: "blocker",
    requestId: "blocker",
    text: "Hold",
  });
  await vi.waitFor(() => expect(entered.has("blocker")).toBe(true));
  const task = await service.tasks.create({
    requestId: "old",
    text: "Old report",
  });
  hostClock = 31002;
  const newer = await service.handle("messages.submit", {
    botId: "newer",
    requestId: "newer",
    text: "New work",
  });
  expect(newer.state).toBe("queued");
  await service.handle("runs.cancel", { runId: blocker.runId });
  await vi.waitFor(() => expect(entered.has("aged-task")).toBe(true));
  expect((await runtime.runsStore().get(newer.runId))?.state).toBe("queued");
  await service.tasks.stop(
    control(await service.tasks.get(task.taskId), "stop-old"),
  );
  await vi.waitFor(() => expect(entered.has("newer")).toBe(true));
  await service.handle("messages.submit", {
    botId: "last",
    requestId: "last",
    text: "Use released capacity",
  });
  await vi.waitFor(() => expect(entered.has("last")).toBe(true));
});

it("bounds selected recovery references without embedding operation bodies", async () => {
  await service.handle("lifecycle.pause", {});
  const a = await service.tasks.create({ requestId: "bounded", text: "Report" });
  await service.tasks.stop(control(a.snapshot, "stop"));
  const task = (await runtime.tasks().metadata(a.taskId))!;
  for (let i = 0; i < 40; i++) await runtime.policy().remember({ id: `${task.conversationId}:op-${i}`, botId: core, conversationId: String(task.conversationId), runId: a.runId, tool: "local_write", argsJson: JSON.stringify({ path: "long/".repeat(1000), content: "PRIVATE_BODY".repeat(1000) }), revision: 0 });
  const snapshot = await service.tasks.get(a.taskId);
  expect(snapshot.recovery).toMatchObject({ confirmed: true, unknownCount: 40, more: true });
  expect(snapshot.recovery?.operations).toHaveLength(32);
  expect(Buffer.byteLength(JSON.stringify(snapshot))).toBeLessThanOrEqual(64 * 1024);
  expect(JSON.stringify(snapshot)).not.toContain("PRIVATE_BODY");
});
