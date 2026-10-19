/**
 * The executor's receipt ledger (Section 6.2): one row per invocation in its own SQLite file, so a restarted executor
 * knows whether an invocation already ran. A row is committed as `accepted` before the side effect starts and becomes
 * terminal with the recorded outcome afterwards; a row still `accepted` when a ledger opens belonged to an executor
 * that died mid-run, so it becomes `unknown` and is never rerun.
 *
 * Commands also record their process group; opening the ledger kills groups such a dead executor left running. A
 * command that moved to the background ends its invocation (the receipt is terminal) but keeps a `background_tasks`
 * row with the same group until it ends; opening the ledger kills the groups of rows still `running` and marks them
 * `unknown`.
 */
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import type { InvocationStatus, ToolInvocation, ToolOutcome } from "@openbot/protocol";

/** Acknowledged receipts are kept this long, so a rerun soon after an ack still finds the outcome. */
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type ReceiptStatus = "accepted" | InvocationStatus;

export type Receipt = {
	readonly invocationId: string;
	readonly argsDigest: string;
	readonly tool: string;
	readonly status: ReceiptStatus;
	/** Present once terminal. */
	readonly outcome?: ToolOutcome;
};

type Row = { invocation_id: string; args_digest: string; tool: string; status: ReceiptStatus; outcome: string | null };

export type TaskStatus = "running" | InvocationStatus;

export type TaskRecord = {
	readonly runId?: string;
	readonly botId?: string;
	readonly output?: string;
	readonly truncated?: boolean;
	readonly consumed: boolean;
	readonly finishedAt?: number;
	readonly taskId: string;
	readonly invocationId: string;
	readonly conversationId: string;
	readonly status: TaskStatus;
	readonly exit?: { readonly code: number | null; readonly signal: string | null };
};

type TaskRow = {
	run_id: string | null; bot_id: string | null; output: string | null; truncated: number; consumed: number; finished_at: number | null;
	task_id: string;
	invocation_id: string;
	conversation_id: string;
	status: TaskStatus;
	exit: string | null;
	pgid: number | null;
	leader_started: string | null;
};

const SCHEMA = `
create table if not exists receipts (
	invocation_id  text primary key,
	args_digest    text not null,
	tool           text not null,
	status         text not null check (status in ('accepted','succeeded','failed','cancelled','unknown')),
	outcome        text,
	accepted_at    integer not null,
	finished_at    integer,
	acked_at       integer,
	pgid           integer,
	leader_started text
);
create table if not exists background_tasks (
	task_id         text primary key,
	invocation_id   text not null,
	conversation_id text not null,
	pgid            integer,
	leader_started  text,
	status          text not null check (status in ('running','succeeded','failed','cancelled','unknown')),
	exit            text,
	started_at      integer not null,
	finished_at     integer
)`;

/** Outcome recorded for an invocation whose executor died while it ran. */
export const INTERRUPTED_OUTCOME: ToolOutcome = {
	status: "unknown",
	output: "The executor stopped while this action ran; it may have partly run",
};

export class ReceiptLedger {
	readonly #db: DatabaseSync;
	readonly #now: () => number;

	private constructor(db: DatabaseSync, now: () => number) {
		this.#db = db;
		this.#now = now;
	}

	/**
	 * Open (or create) the ledger. Every `accepted` row becomes `unknown`: this is a new process, so nothing the old one
	 * started is still supervised. Process groups those rows recorded are killed when their leader is still the same
	 * process; acknowledged rows past retention are deleted.
	 */
	static open(path: string, now: () => number = Date.now): ReceiptLedger {
		const db = new DatabaseSync(path);
		db.exec("pragma journal_mode = wal");
		// Every accepted row must be on disk before the effect it guards starts.
		db.exec("pragma synchronous = full");
		db.exec(SCHEMA);
		const columns = new Set((db.prepare("pragma table_info(background_tasks)").all() as {name:string}[]).map(row => row.name));
		for (const [name, type] of Object.entries({run_id:"text",bot_id:"text",output:"text",truncated:"integer not null default 0",consumed:"integer not null default 0",wake_tracked:"integer not null default 0",wake_acked_at:"integer"}))
			if (!columns.has(name)) db.exec(`alter table background_tasks add column ${name} ${type}`);
		const ledger = new ReceiptLedger(db, now);
		ledger.#recover();
		db.prepare("delete from receipts where acked_at is not null and acked_at < ?").run(now() - RETENTION_MS);
		db.prepare("delete from background_tasks where finished_at is not null and finished_at < ? and (wake_tracked=0 or wake_acked_at is not null)").run(now() - RETENTION_MS);
		return ledger;
	}

	close(): void {
		this.#db.close();
	}

	get(invocationId: string): Receipt | undefined {
		const row = this.#db.prepare("select * from receipts where invocation_id = ?").get(invocationId) as Row | undefined;
		if (row === undefined) return undefined;
		return {
			invocationId: row.invocation_id,
			argsDigest: row.args_digest,
			tool: row.tool,
			status: row.status,
			...(row.outcome === null ? {} : { outcome: JSON.parse(row.outcome) as ToolOutcome }),
		};
	}

	/** Commit the `accepted` row. Throws if the ID exists; the caller checks `get` first. */
	accept(invocation: ToolInvocation): void {
		this.#db
			.prepare("insert into receipts (invocation_id, args_digest, tool, status, accepted_at) values (?, ?, ?, 'accepted', ?)")
			.run(invocation.invocationId, invocation.argsDigest, invocation.tool, this.#now());
	}

	/** Record the process group a command runs in, with its leader's start time to detect PID reuse later. */
	recordGroup(invocationId: string, pgid: number): void {
		const started = processStartTime(pgid);
		this.#db
			.prepare("update receipts set pgid = ?, leader_started = ? where invocation_id = ? and status = 'accepted'")
			.run(pgid, started ?? null, invocationId);
	}

	/**
	 * Record the terminal outcome. Only an `accepted` row changes: once a row is terminal, or `unknown` because a newer
	 * ledger took over, its outcome is final.
	 */
	finish(invocationId: string, outcome: ToolOutcome): void {
		this.#db
			.prepare("update receipts set status = ?, outcome = ?, finished_at = ? where invocation_id = ? and status = 'accepted'")
			.run(outcome.status, JSON.stringify(outcome), this.#now(), invocationId);
	}

	/** Only a committed artifact-store receipt can resolve an interrupted publication. No external operation is repeated. */
	reconcileArtifact(invocationId: string, argsDigest: string, outcome: ToolOutcome): void {
		this.#db
			.prepare(
				"update receipts set status=?,outcome=?,finished_at=? where invocation_id=? and args_digest=? and tool='artifact_publish' and status='unknown'",
			)
			.run(outcome.status, JSON.stringify(outcome), this.#now(), invocationId, argsDigest);
	}

	/** The Host committed the outcome; the row is pruned after the retention period. */
	ack(invocationId: string): void {
		this.#db
			.prepare("update receipts set acked_at = ? where invocation_id = ? and acked_at is null and status != 'accepted'")
			.run(this.#now(), invocationId);
	}

	/**
	 * Record that an invocation's command moved to the background as `taskId`, with the process group its receipt
	 * recorded. Committed before the invocation's result is reported.
	 */
	recordTask(taskId: string, invocationId: string, conversationId: string, metadata: {runId?:string;botId?:string;completionTracking?:boolean} = {}): void {
		this.#db
			.prepare(
				`insert into background_tasks (task_id, invocation_id, conversation_id, pgid, leader_started, status, started_at, run_id, bot_id, wake_tracked)
				 select ?, invocation_id, ?, pgid, leader_started, 'running', ?, ?, ?, ? from receipts where invocation_id = ?`,
			)
			.run(taskId, conversationId, this.#now(), metadata.runId??null, metadata.botId??null, metadata.completionTracking?1:0, invocationId);
	}

	/** Record how a background task ended. Only a `running` row changes, as with receipts. */
	finishTask(taskId: string, status: InvocationStatus, exit: { code: number | null; signal: string | null }, output?: {text:string;truncated:boolean}): void {
		this.#db
			.prepare("update background_tasks set status = ?, exit = ?, finished_at = ?, output = ?, truncated = ? where task_id = ? and status = 'running'")
			.run(status, JSON.stringify(exit), this.#now(), output?.text??null, output?.truncated?1:0, taskId);
	}

	task(taskId: string): TaskRecord | undefined {
		const row = this.#db.prepare("select * from background_tasks where task_id = ?").get(taskId) as TaskRow | undefined;
		if (row === undefined) return undefined;
		return {
			taskId: row.task_id,
			...(row.run_id ? {runId:row.run_id} : {}), ...(row.bot_id ? {botId:row.bot_id} : {}),
			...(row.output === null ? {} : {output:row.output,truncated:!!row.truncated}), consumed:!!row.consumed,
			...(row.finished_at === null ? {} : {finishedAt:row.finished_at}),
			invocationId: row.invocation_id,
			conversationId: row.conversation_id,
			status: row.status,
			...(row.exit === null ? {} : { exit: JSON.parse(row.exit) as NonNullable<TaskRecord["exit"]> }),
		};
	}

	consumeTask(taskId: string): void {
		this.#db.prepare("update background_tasks set consumed=1 where task_id=? and status!='running'").run(taskId);
	}
	ackTask(taskId: string, invocationId: string): void {
		this.#db.prepare("update background_tasks set wake_acked_at=? where task_id=? and invocation_id=? and status!='running'").run(this.#now(),taskId,invocationId);
	}

 /** Recovery can stop a process without knowing its earlier effects; acknowledge only confirmed quiescence. */
 confirmStopped(ids:readonly string[]):boolean {
  for(const id of ids){
   const rows=this.#db.prepare("select pgid, tool from receipts where invocation_id = ? and status in ('accepted','unknown')").all(id) as {pgid:number|null;tool:string}[];
   const tasks=this.#db.prepare("select pgid from background_tasks where invocation_id = ? and status in ('running','unknown')").all(id) as {pgid:number|null}[];
   for(const row of [...rows.filter(row=>row.tool==="local_exec"),...tasks]){
    if(row.pgid===null)return false;
    try{process.kill(-row.pgid,0);return false;}catch(error){if((error as NodeJS.ErrnoException).code!=="ESRCH")return false;}
   }
  }return true;
 }

	#recover(): void {
		const stale = this.#db.prepare("select invocation_id, pgid, leader_started from receipts where status = 'accepted'").all() as {
			invocation_id: string;
			pgid: number | null;
			leader_started: string | null;
		}[];
		const markUnknown = this.#db.prepare("update receipts set status = 'unknown', outcome = ?, finished_at = ? where invocation_id = ?");
		for (const row of stale) {
			markUnknown.run(JSON.stringify(INTERRUPTED_OUTCOME), this.#now(), row.invocation_id);
			if (row.pgid !== null && row.leader_started !== null) killOrphanGroup(row.pgid, row.leader_started);
		}
		const tasks = this.#db.prepare("select * from background_tasks where status = 'running'").all() as TaskRow[];
		const markTaskUnknown = this.#db.prepare("update background_tasks set status = 'unknown', finished_at = ? where task_id = ?");
		for (const row of tasks) {
			markTaskUnknown.run(this.#now(), row.task_id);
			if (row.pgid !== null && row.leader_started !== null) killOrphanGroup(row.pgid, row.leader_started);
		}
	}
}

/**
 * Kill a process group a dead executor left behind. The leader still running with the recorded start time proves the
 * group is ours; a different start time means the PID was reused, so it is left alone. A leader that exited while its
 * group lives on also proves it: a PID is not reused while a process group with that ID exists.
 */
function killOrphanGroup(pgid: number, leaderStarted: string): void {
	const started = processStartTime(pgid);
	if (started !== undefined && started !== leaderStarted) return;
	try {
		process.kill(-pgid, "SIGKILL");
	} catch {
		// The group is gone.
	}
}

/** `ps` start time of a process, or undefined when it does not exist. */
function processStartTime(pid: number): string | undefined {
	try {
		const started = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" }).trim();
		return started === "" ? undefined : started;
	} catch {
		return undefined;
	}
}
