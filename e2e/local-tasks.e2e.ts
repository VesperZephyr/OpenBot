import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { launchApp, type AppHarness } from "./harness.ts";
let h: AppHarness, core: string;
beforeAll(async () => {
  h = await launchApp("local-tasks");
  await h.page().getByRole("textbox", { name: "Message OpenBot" }).waitFor();
  await h.api("settings.update", {
    defaultModel: { provider: "scripted", modelId: "scripted" },
  });
  core = (await h.api("bots.list")).find((b: any) => b.kind === "core").botId;
}, 60000);
afterAll(async () => {
  await h?.close();
});
async function taskList() {
  await h
    .page()
    .getByRole("button", { name: "Conversation details", exact: true })
    .click();
  await h.page().getByRole("button", { name: "Tasks", exact: true }).click();
}
async function create(text: string) {
  await h.page().getByRole("button", { name: "New task", exact: true }).click();
  await h.page().getByRole("textbox", { name: "New task for Core" }).fill(text);
  await h.page().getByRole("button", { name: "Send", exact: true }).click();
  await h
    .page()
    .getByRole("textbox", { name: `Follow-up for ${text}` })
    .waitFor();
  return (await h.api("tasks.list")).tasks.find((t: any) => t.title === text);
}
it("two tasks leave Core responsive; stop then explicitly send a correction", async () => {
  const aGate = Promise.withResolvers<void>(),
    bGate = Promise.withResolvers<void>();
  h.model.script(
    { text: "A old result", wait: aGate.promise },
    { text: "B result", wait: bGate.promise },
    { text: "Core stays responsive" },
    { text: "A corrected result" },
  );
  try {
    await taskList();
    const a = await create("Research A");
    await expect.poll(() => h.model.requests.length).toBe(1);
    const b = await create("Research B");
    await expect.poll(() => h.model.requests.length).toBe(2);
    await h
      .page()
      .getByRole("button", { name: "Back to Core", exact: true })
      .click();
    await h.send("Hello Core");
    await h
      .page()
      .getByText("Core stays responsive", { exact: true })
      .waitFor();
    expect((await h.api("tasks.get", { taskId: a.taskId })).busy).toBe(true);
    expect((await h.api("tasks.get", { taskId: b.taskId })).busy).toBe(true);
    await taskList();
    await h
      .page()
      .getByRole("button")
      .filter({ has: h.page().getByText("Research A", { exact: true }) })
      .click();
    const draft = h
      .page()
      .getByRole("textbox", { name: "Follow-up for Research A" });
    await draft.fill("Change the dates");
    expect(
      await h
        .page()
        .getByRole("button", { name: "Send", exact: true })
        .isDisabled(),
    ).toBe(true);
    await h.page().getByRole("button", { name: "Stop to edit" }).click();
    await expect
      .poll(async () => (await h.api("tasks.get", { taskId: a.taskId })).busy)
      .toBe(false);
    await expect
      .poll(() =>
        h.page().getByRole("button", { name: "Send", exact: true }).isEnabled(),
      )
      .toBe(true);
    expect(await draft.inputValue()).toBe("Change the dates");
    expect(h.model.requests).toHaveLength(3);
    expect((await h.api("tasks.get", { taskId: a.taskId })).run.state).toBe("cancelled");
  await h.shot("01-stopped-draft");
    await h.page().getByRole("button", { name: "Send", exact: true }).click();
    await h.page().getByText("A corrected result", { exact: true }).waitFor();
    expect(JSON.stringify(h.model.requests[3])).toContain("Research A");
    expect(JSON.stringify(h.model.requests[3])).toContain("Change the dates");
    expect(JSON.stringify(h.model.requests[3])).not.toContain("Research B");
    bGate.resolve();
    await expect
      .poll(async () => (await h.api("tasks.get", { taskId: b.taskId })).state)
      .toBe("result");
    aGate.resolve();
    await h.nextFrame();
    await h.shot("02-task-result");
    expect(h.model.requests).toHaveLength(4);
    const result = await h.api("tasks.get", { taskId: a.taskId });
    await h.relaunch();
    await h
      .page()
      .getByRole("textbox", { name: "Follow-up for Research A" })
      .waitFor();
    expect((await h.api("tasks.get", { taskId: a.taskId })).result).toEqual(
      result.result,
    );
    expect(h.model.requests).toHaveLength(4);
    await h
      .page()
      .getByRole("button", { name: "Back to Core", exact: true })
      .click();
    expect(
      await h.page().getByText("A corrected result", { exact: true }).count(),
    ).toBe(0);
    expect((await h.api("bots.list")).length).toBe(1);
  } finally {
    aGate.resolve();
    bGate.resolve();
  }
});
it("fresh output folder, private history, archive and localized controls", async () => {
  await taskList();
  let outputPath = "";
  const initial = "# Local report\nVerified fixture";
  const edited = "# Local report\nVerified edited fixture";
  h.model.script(
    {
      tool: "local_write",
      args: (request) => {
        const text = JSON.stringify(request.messages);
        const root = text.match(
          /Write and publish only inside \\"([^"\\]+)\\"/,
        )?.[1];
        if (!root) throw Error("Missing task output root");
        outputPath = `${root}/report.md`;
        return { path: outputPath, content: initial };
      },
    },
    {
      tool: "local_edit",
      args: () => ({
        path: outputPath,
        old_text: "Verified fixture",
        new_text: "Verified edited fixture",
        expected_sha256: createHash("sha256").update(initial).digest("hex"),
      }),
    },
    { tool: "artifact_publish", args: () => ({ path: outputPath }) },
    { text: "Report saved" },
  );
  const a = await create("Output report");
  await expect
    .poll(async () => (await h.api("tasks.get", { taskId: a.taskId })).state)
    .toBe("result");
  await h.page().getByText("Report saved", { exact: true }).waitFor();
  expect(await readFile(outputPath, "utf8")).toBe(edited);
  const published = await h.api("artifacts.list", {
    offset: 0,
    query: "",
    source: "result",
  });
  expect(
    published.items.some(
      (a: any) =>
        a.name === "report.md" &&
        a.sha256 === createHash("sha256").update(edited).digest("hex"),
    ),
  ).toBe(true);
  const selected = await h.api("conversations.window", {
    conversationKey: `bot:${core}`,
    taskId: a.taskId,
    position: { kind: "latest" },
    limit: 1,
  });
  expect(selected.status).toBe("ready");
  const all = (await h.api("tasks.list")).tasks;
  const other = all.find((t: any) => t.taskId !== a.taskId);
  await expect
    .poll(
      async () =>
        (
          await h.api("conversations.window", {
            conversationKey: `bot:${core}`,
            taskId: other.taskId,
            position: { kind: "latest" },
          })
        ).status,
    )
    .toBe("ready");
  if (selected.window.before)
    await expect(
      h.api("conversations.window", {
        conversationKey: `bot:${core}`,
        taskId: other.taskId,
        position: { kind: "cursor", cursor: selected.window.before },
      }),
    ).rejects.toThrow();
  await h.page().getByRole("button", { name: "Archive", exact: true }).click();
  await expect
    .poll(async () => (await h.api("tasks.get", { taskId: a.taskId })).archived)
    .toBe(true);
  await h.page().getByRole("button", { name: "Tasks", exact: true }).click();
  expect(
    await h.page().getByText("Output report", { exact: true }).count(),
  ).toBe(0);
  await h.page().getByRole("checkbox", { name: "Archived tasks" }).check();
  await h.page().getByText("Output report", { exact: true }).click();
  await h
    .page()
    .getByRole("button", { name: "Unarchive", exact: true })
    .click();
  await h.api("settings.update", { language: "zh-CN" });
  await h
    .page()
    .getByRole("button", { name: "返回 Core", exact: true })
    .waitFor();
  await h
    .app()
    .evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.setSize(900, 720),
    );
  await h.page().getByRole("button", { name: "归档", exact: true }).waitFor();
  await h.nextFrame();
  await h.shot("03-chinese-task");
  await h.api("settings.update", { language: "en" });
});
it("review uncertain effects and keep a fresh output Run", async () => {
  const { seedTaskUncertainty } = await import(
    "../packages/agent-runtime/test/task-history-fixture.ts"
  );
  const task = (await h.api("tasks.list")).tasks.find(
    (t: any) => t.title === "Output report",
  );
  await h.relaunch(() =>
    seedTaskUncertainty(`${h.dataDirectory}/openbot.sqlite`, task.taskId),
  );
  await h
    .page()
    .getByRole("checkbox", { name: "Continue with uncertain previous effects" })
    .waitFor();
  const draft = h
    .page()
    .getByRole("textbox", { name: "Follow-up for Output report" });
  await draft.fill("Inspect the prior report and produce a fresh version");
  expect(
    await h
      .page()
      .getByRole("button", { name: "Send", exact: true })
      .isDisabled(),
  ).toBe(true);
  await h.shot("04-uncertain-effects");
  await h.api("settings.update", { language: "zh-CN" });
  await h
    .page()
    .getByRole("checkbox", { name: "知悉先前效果不确定，继续执行" })
    .waitFor();
  await h.nextFrame();
  await h.shot("05-uncertain-chinese");
  await h.api("settings.update", { language: "en" });
  h.model.script({ text: "New report after inspecting uncertain effects" });
  await h
    .page()
    .getByRole("checkbox", { name: "Continue with uncertain previous effects" })
    .check();
  await h.page().getByRole("button", { name: "Send", exact: true }).click();
  await h
    .page()
    .getByText("New report after inspecting uncertain effects", { exact: true })
    .waitFor();
  expect(
    (await h.api("tasks.get", { taskId: task.taskId })).currentRunId,
  ).not.toBe(task.currentRunId);
});
it("destination drafts survive navigation and a queued stop survives restart", async () => {
  await h
    .page()
    .getByRole("button", { name: "Back to Core", exact: true })
    .click();
  await taskList();
  await h.page().getByRole("button", { name: "New task", exact: true }).click();
  await h
    .page()
    .getByRole("textbox", { name: "New task for Core" })
    .fill("Paused report");
  await h
    .page()
    .getByRole("button", { name: "Back to Core", exact: true })
    .click();
  await h
    .page()
    .getByRole("textbox", { name: "Message OpenBot" })
    .fill("Unsent Core draft");
  await taskList();
  await h.page().getByRole("button", { name: "New task", exact: true }).click();
  expect(
    await h
      .page()
      .getByRole("textbox", { name: "New task for Core" })
      .inputValue(),
  ).toBe("Paused report");
  await h.api("lifecycle.pause");
  const before = h.model.requests.length;
  await h.page().getByRole("button", { name: "Send", exact: true }).click();
  await h
    .page()
    .getByRole("textbox", { name: "Follow-up for Paused report" })
    .waitFor();
  const task = (await h.api("tasks.list")).tasks.find(
    (t: any) => t.title === "Paused report",
  );
  expect((await h.api("tasks.get", { taskId: task.taskId })).state).toBe(
    "paused",
  );
  await h
    .page()
    .getByRole("textbox", { name: "Follow-up for Paused report" })
    .fill("Change the dates");
  await h.page().getByRole("button", { name: "Stop to edit" }).click();
  await expect
    .poll(async () => (await h.api("tasks.get", { taskId: task.taskId })).busy)
    .toBe(false);
  await h.relaunch();
  await h
    .page()
    .getByRole("textbox", { name: "Follow-up for Paused report" })
    .waitFor();
  expect(
    await h
      .page()
      .getByRole("textbox", { name: "Follow-up for Paused report" })
      .inputValue(),
  ).toBe("Change the dates");
  expect(h.model.requests.length).toBe(before);
  expect(
    await h
      .page()
      .getByRole("button", { name: "Continue", exact: true })
      .isDisabled(),
  ).toBe(true);
  await h.shot("06-paused-stopped-draft");
  h.model.script({ text: "Original task and changed dates retained" });
  await h.page().getByRole("button", { name: "Send", exact: true }).click();
  expect(h.model.requests.length).toBe(before);
  await h.api("lifecycle.resume");
  await h
    .page()
    .getByText("Original task and changed dates retained", { exact: true })
    .waitFor();
  expect(JSON.stringify(h.model.requests.at(-1))).toContain("Paused report");
  expect(JSON.stringify(h.model.requests.at(-1))).toContain("Change the dates");
  await h
    .page()
    .getByRole("button", { name: "Back to Core", exact: true })
    .click();
  expect(
    await h
      .page()
      .getByRole("textbox", { name: "Message OpenBot" })
      .inputValue(),
  ).toBe("Unsent Core draft");
});
it("task approvals stay unattended and cannot authorize after Stop", async () => {
  const { writeFile } = await import("node:fs/promises");
  const input = `${h.run}/outside-workspace.txt`;
  await writeFile(input, "Approval fixture");
  const before = (await h.api("bots.list")).find(
    (b: any) => b.botId === core,
  ).lastRun;
  h.model.script({ tool: "local_read", args: { path: input } });
  await taskList();
  const task = await create("Approval task");
  await h.page().getByRole("group", { name: "Approval request" }).waitFor();
  const snapshot = await h.api("tasks.get", { taskId: task.taskId }),
    approval = snapshot.approvals[0];
  expect(approval.binding.origin).toBe("unattended");
  expect(approval.deadline - approval.createdAt).toBe(600000);
  const roster = (await h.api("bots.list")).find((b: any) => b.botId === core);
  expect(roster.pendingApprovals).toBe(1);
  expect(roster.activity).toBe("working");
  expect(roster.lastRun).toEqual(before);
  await h.shot("07-task-approval");
  await h.page().getByRole("button", { name: "Stop to edit" }).click();
  await expect
    .poll(async () => (await h.api("tasks.get", { taskId: task.taskId })).busy)
    .toBe(false);
  await expect(
    h.api("approvals.decide", {
      approvalId: approval.approvalId,
      decision: approval.alwaysAllowOptions?.[0]
        ? { kind: "always_allow", scope: approval.alwaysAllowOptions[0].scope }
        : "allow_once",
    }),
  ).rejects.toThrow();
  expect(
    (await h.api("bots.list")).find((b: any) => b.botId === core).lastRun,
  ).toEqual(before);
});
