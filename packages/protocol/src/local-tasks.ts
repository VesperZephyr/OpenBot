import type {
  LiveRun,
  PendingApproval,
  ArtifactRef,
  RunRecord,
  SkillRef,
} from "./index.ts";

export const LOCAL_TASK_LIMITS = {
  active: 32,
  inputBytes: 24 * 1024,
  inputs: 32,
  briefBytes: 128 * 1024,
  pageBytes: 64 * 1024,
} as const;
export const LOCAL_TASK_TOOLS = [
  "local_read",
  "local_list",
  "local_write",
  "local_edit",
  "artifact_publish",
  "web_search",
  "web_fetch",
  "skill_load",
  "memory_search",
  "memory_read",
  "send_message",
] as const;
export type LocalTaskState =
  | "queued"
  | "paused"
  | "working"
  | "approving"
  | "stopping"
  | "attention"
  | "stopped"
  | "interrupted"
  | "failed"
  | "result"
  | "empty";
export type LocalTaskCard = {
  taskId: string;
  botId: string;
  title: string;
  createdAt: number;
  archived: boolean;
  commandRevision: number;
  currentRunId: string;
  state: LocalTaskState;
  result?: { runId: string; canonicalAnchor: string };
};
export type LocalTaskSnapshot = LocalTaskCard & {
  run: RunRecord;
  approvals: readonly Omit<PendingApproval, "args">[];
  activity?: LiveRun["activity"];
  attachments: readonly ArtifactRef[];
  skills: readonly SkillRef[];
  inputCount: number;
  inputBytes: number;
  busy: boolean;
  canContinue: boolean;
  serial: boolean;
  waitingForCapacity: boolean;
  recovery?: {
    confirmed: boolean;
    unknownCount: number;
    operations: readonly {
      invocationId: string;
      callId: string;
      tool: string;
      path?: string;
    }[];
    more: boolean;
    token?: string;
    error?: string;
  };
};
export type LocalTaskAccepted = {
  taskId: string;
  commandRevision: number;
  runId: string;
  snapshot: LocalTaskSnapshot;
};
export type LocalTaskCreate = {
  requestId: string;
  text: string;
  attachments?: readonly string[];
  skills?: readonly SkillRef[];
};
export type LocalTaskControl = {
  taskId: string;
  requestId: string;
  expectedRevision: number;
  expectedRunId: string;
};
export type LocalTaskSubmit = LocalTaskControl & {
  input: { kind: "input"; text: string } | { kind: "continue" };
  recoveryToken?: string;
};
export type LocalTaskArchive = {
  taskId: string;
  requestId: string;
  expectedRevision: number;
  archived: boolean;
};
