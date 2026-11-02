import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  ConversationSnapshot,
  LocalTaskSnapshot,
  LocalTaskState,
  PendingApproval,
  WindowResult,
} from "@openbot/protocol";
import {
  api,
  openBot,
  refreshTasks,
  report,
  errorMessage,
  useStore,
  type TaskView,
} from "./store";
import { ChatComposer } from "./ChatComposer";
import { ConversationShell } from "./ConversationUI";
import { ApprovalCard } from "./ApprovalCard";
import { ArtifactCard } from "./ArtifactCard";
import { t } from "./i18n";
import { composers } from "./useComposer";
import type { SendAttempt } from "./composers";

function newDraft(botId: string): string {
  const key = `openbot.new-task.v1:${botId}`;
  const saved = localStorage.getItem(key);
  if (saved) return saved;
  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}
const labels: Record<LocalTaskState, string> = {
  queued: "Queued",
  paused: "Paused",
  working: "Working",
  approving: "Awaiting approval",
  stopping: "Stopping",
  attention: "Needs attention",
  stopped: "Stopped",
  interrupted: "Interrupted",
  failed: "Could not finish",
  result: "Result available",
  empty: "Finished without a result",
};
export function LocalTasks({
  view,
  renderHistory,
}: {
  view: TaskView;
  renderHistory: (snapshot: ConversationSnapshot, taskId: string) => ReactNode;
}) {
  const selected = useStore((s) => s.task),
    cards = useStore((s) => s.tasks),
    paused = useStore((s) => s.lifecycle?.blocked ?? false);
  const task = selected?.taskId === view.taskId ? selected : undefined;
  const [acknowledged, setAcknowledged] = useState<string>();
  const [acting, setActing] = useState(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const navigate = (next: Partial<TaskView>) =>
    useStore.setState({ view: { kind: "tasks", botId: view.botId, ...next } });
  const controls = (s: LocalTaskSnapshot) => ({
    taskId: s.taskId,
    expectedRevision: s.commandRevision,
    expectedRunId: s.currentRunId,
  });
  const act = async (kind: "stop" | "continue" | "archive") => {
    if (!task || acting) return;
    const key = `openbot.task-control.v1:${task.taskId}:${kind}`;
    setActing(true);
    try {
      const saved = localStorage.getItem(key);
      const args = saved
        ? JSON.parse(saved)
        : {
            ...controls(task),
            requestId: crypto.randomUUID(),
            ...(kind === "continue"
              ? {
                  input: { kind: "continue" },
                  ...(acknowledged ? { recoveryToken: acknowledged } : {}),
                }
              : kind === "archive"
                ? { archived: !task.archived }
                : {}),
          };
      localStorage.setItem(key, JSON.stringify(args));
      if (kind === "stop") await api["tasks.stop"](args);
      else if (kind === "continue") await api["tasks.submit"](args);
      else {
        const { expectedRunId: _run, ...archive } = args;
        await api["tasks.archive"](archive);
      }
      localStorage.removeItem(key);
      await refreshTasks();
    } catch (error) {
      if (
        /Task changed|acknowledge|Resume work|settled task|Only a settled|already ended/.test(
          errorMessage(error),
        )
      )
        localStorage.removeItem(key);
      report(error);
      await refreshTasks();
    } finally {
      if (alive.current) setActing(false);
    }
  };
  const send = async (attempt: SendAttempt) => {
    const destination = view;
    try {
      if (view.draftId) {
        const accepted = await api["tasks.create"]({
          requestId: attempt.requestId,
          text: attempt.text,
          ...(attempt.attachments?.length
            ? { attachments: attempt.attachments.map((a) => a.artifactId) }
            : {}),
          ...(attempt.skills?.length ? { skills: attempt.skills } : {}),
        });
        if (
          composers.get(attempt.conversationKey).draft.revision ===
            attempt.draftRevision &&
          localStorage.getItem(`openbot.new-task.v1:${view.botId}`) ===
            view.draftId
        )
          localStorage.removeItem(`openbot.new-task.v1:${view.botId}`);
        if (useStore.getState().view === destination)
          navigate({ taskId: accepted.taskId });
      } else {
        if (!attempt.task)
          throw Error(
            "Task destination is unavailable. Dismiss this attempt and send again.",
          );
        await api["tasks.submit"]({
          ...attempt.task,
          requestId: attempt.requestId,
          input: { kind: "input", text: attempt.text },
        });
      }
    } finally {
      await refreshTasks();
    }
  };
  const recoveryReady =
    !task?.recovery?.token || acknowledged === task.recovery.token;
  return (
    <ConversationShell className="local-tasks" label={t("Tasks")}>
      <header className="conversation-header">
        <div>
          <button
            aria-label={t("Back to Core")}
            onClick={() => void openBot(view.botId).catch(report)}
          >
            ← {t("Back to Core")}
          </button>
          <h2>
            Core / {task?.title ?? t(view.draftId ? "New task" : "Tasks")}
          </h2>
        </div>
        <div className="header-actions">
          {(view.taskId || view.draftId) && (
            <button onClick={() => navigate({})}>{t("Tasks")}</button>
          )}
          <button onClick={() => navigate({ draftId: newDraft(view.botId) })}>
            {t("New task")}
          </button>
        </div>
      </header>
      {paused && (
        <p className="compose-notice" role="status">
          {t("Work is paused. Resume work to run queued tasks.")}
        </p>
      )}
      {!view.taskId && !view.draftId && (
        <div className="task-list">
          <label>
            <input
              type="checkbox"
              checked={view.archived ?? false}
              onChange={(e) => navigate({ archived: e.target.checked })}
            />
            {t("Archived tasks")}
          </label>
          {!cards ? (
            <p>{t("Loading…")}</p>
          ) : cards.tasks.length ? (
            cards.tasks.map((card) => (
              <button
                className="task-card"
                key={card.taskId}
                onClick={() => navigate({ taskId: card.taskId })}
              >
                <strong>{card.title}</strong>
                <span>{t(labels[card.state])}</span>
              </button>
            ))
          ) : (
            <p>
              {t(
                "No tasks here. Start a task for an independent report or research request.",
              )}
            </p>
          )}
          {cards?.next && (
            <button
              onClick={() =>
                navigate({
                  archived: view.archived ?? false,
                  cursor: cards.next!,
                })
              }
            >
              {t("Next page")}
            </button>
          )}
          {view.cursor && (
            <button
              onClick={() => navigate({ archived: view.archived ?? false })}
            >
              {t("First page")}
            </button>
          )}
        </div>
      )}
      {view.draftId && (
        <>
          <div className="task-intro">
            <p>
              {t(
                "This task runs separately from Core chat. It can read allowed sources and write a report in its own folder.",
              )}
            </p>
            <p>
              {t("Choose files and skills now. Later changes are text only.")}
            </p>
          </div>
          <ChatComposer
            conversationKey={`new-task:${view.draftId}`}
            label={t("New task for Core")}
            onSend={send}
          />
        </>
      )}
      {view.taskId && !task && <p>{t("Loading task…")}</p>}
      {task && (
        <>
          <div className="task-status" role="status">
            <strong>{t(labels[task.state])}</strong>
            {task.waitingForCapacity && (
              <span>{t("Waiting for capacity")}</span>
            )}
            {task.serial && (
              <span>
                {t("One execution slot: tasks and Core run one at a time.")}
              </span>
            )}
            {task.busy ? (
              <button disabled={acting} onClick={() => void act("stop")}>
                {t(
                  task.state === "attention" || task.state === "stopping"
                    ? "Check stop again"
                    : "Stop to edit",
                )}
              </button>
            ) : (
              <button disabled={acting} onClick={() => void act("archive")}>
                {t(task.archived ? "Unarchive" : "Archive")}
              </button>
            )}
          </div>
          {!!task.attachments.length && (
            <div className="attachment-chips">
              {task.attachments.map((a) => (
                <ArtifactCard key={a.artifactId} artifact={a} />
              ))}
            </div>
          )}
          {!!task.skills.length && (
            <p className="compose-notice">
              {t("Pinned skills")}:{" "}
              {task.skills.map((s) => `/${s.name} v${s.revision}`).join(" · ")}
            </p>
          )}
          {task.recovery && (
            <div className="send-recovery">
              <p>
                {task.recovery.confirmed
                  ? t(
                      "Previous effects are uncertain ({count}). Inspect the task history before continuing.",
                      { count: task.recovery.unknownCount },
                    )
                  : t("Stop is not confirmed. No replacement will start.")}
              </p>
              {task.recovery.error && <p>{task.recovery.error}</p>}
              <ul>
                {task.recovery.operations.map((operation) => (
                  <li key={operation.invocationId}>
                    <button
                      onClick={() =>
                        useStore.setState({
                          searchTarget: {
                            conversationKey: `bot:${task.botId}`,
                            taskId: task.taskId,
                            messageId: operation.callId,
                            nonce: crypto.randomUUID(),
                          },
                        })
                      }
                    >
                      {operation.tool} ·{" "}
                      {operation.path ?? operation.invocationId}
                    </button>
                  </li>
                ))}
              </ul>
              {task.recovery.more && (
                <p>
                  {t("More operation evidence is available in task history.")}
                </p>
              )}
              {task.recovery.token && (
                <label>
                  <input
                    type="checkbox"
                    checked={acknowledged === task.recovery.token}
                    onChange={(e) =>
                      setAcknowledged(
                        e.target.checked ? task.recovery!.token : undefined,
                      )
                    }
                  />
                  {t("Continue with uncertain previous effects")}
                </label>
              )}
            </div>
          )}
          {task.approvals.map((a) => (
            <TaskApproval key={a.approvalId} approval={a} task={task} />
          ))}
          {renderHistory(
            {
              botId: task.botId,
              channelId: task.taskId,
              items: [],
              approvals: [],
              messageMode: true,
              ...(task.state === "working"
                ? {
                    live: {
                      state: "running" as const,
                      ...(task.activity ? { activity: task.activity } : {}),
                    },
                  }
                : {}),
            },
            task.taskId,
          )}
          {task.busy && (
            <p className="compose-notice">
              {t(
                "Edit your draft while work runs. Stop, wait for confirmation, then send explicitly.",
              )}
            </p>
          )}
          {task.result && (
            <button
              className="task-continue"
              onClick={() =>
                useStore.setState({
                  searchTarget: {
                    conversationKey: `bot:${task.botId}`,
                    taskId: task.taskId,
                    messageId: task.result!.canonicalAnchor,
                    nonce: crypto.randomUUID(),
                  },
                })
              }
            >
              {t(
                task.result.runId === task.currentRunId
                  ? "View result"
                  : "View previous result",
              )}
            </button>
          )}
          {task.canContinue && !task.archived && (
            <button
              className="task-continue"
              disabled={acting || paused || !recoveryReady}
              onClick={() => void act("continue")}
            >
              {t("Continue")}
            </button>
          )}
          <ChatComposer
            conversationKey={`task:${task.taskId}`}
            label={t("Follow-up for {title}", { title: task.title })}
            pinned
            readOnly={task.archived}
            sendDisabled={task.busy || !recoveryReady}
            taskAttempt={{
              ...controls(task),
              ...(acknowledged ? { recoveryToken: acknowledged } : {}),
            }}
            onSend={send}
          />
        </>
      )}
    </ConversationShell>
  );
}
function TaskApproval({
  approval,
  task,
}: {
  approval: Omit<PendingApproval, "args">;
  task: LocalTaskSnapshot;
}) {
  const revision = useStore((s) => s.historyRevision);
  const [resolved, setResolved] = useState<PendingApproval>();
  useEffect(() => {
    let current = true;
    void (async () => {
      const window: WindowResult = await api["conversations.window"]({
        conversationKey: `bot:${task.botId}`,
        taskId: task.taskId,
        position: { kind: "around", rowId: approval.callId },
        limit: 1,
      });
      if (window.status !== "ready") return;
      const row = window.window.rows.find((r) => r.id === approval.callId);
      if (!row) return;
      let content = row.content;
      if (content.kind === "large") {
        let text = "",
          part: number | undefined = 0;
        while (part !== undefined && current) {
          const chunk = await api["conversations.detail"]({
            conversationKey: `bot:${task.botId}`,
            detail: content.detail,
            part,
          });
          text += chunk.text;
          part = chunk.nextPart;
        }
        content = JSON.parse(text);
      }
      if (current && content.kind === "direct" && content.item.kind === "tool")
        setResolved({ ...approval, args: content.item.args });
    })().catch(report);
    return () => {
      current = false;
    };
  }, [task.taskId, task.botId, approval, revision]);
  return resolved ? (
    <ApprovalCard approval={resolved} />
  ) : (
    <p className="compose-notice">{t("Loading approval details…")}</p>
  );
}
