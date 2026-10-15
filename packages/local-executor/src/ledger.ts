/**
 * The executor's receipt ledger (Section 6.2): one row per invocation in its own SQLite file, so a restarted executor
 * knows whether an invocation already ran. A row is committed as `accepted` before the side effect starts and becomes
 * terminal with the recorded outcome afterwards; a row still `accepted` when a ledger opens belonged to an executor
 * that died mid-run, so it becomes `unknown` and is never rerun.
 *
 * Commands also record their process group; opening the ledger kills groups such a dead executor left running.
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
		const ledger = new ReceiptLedger(db, now);
		ledger.#recover();
		db.prepare("delete from receipts where acked_at is not null and acked_at < ?").run(now() - RETENTION_MS);
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

	/** The Host committed the outcome; the row is pruned after the retention period. */
	ack(invocationId: string): void {
		this.#db
			.prepare("update receipts set acked_at = ? where invocation_id = ? and acked_at is null and status != 'accepted'")
			.run(this.#now(), invocationId);
	}

	#recover(): void {
		const stale = this.#db.prepare("select invocation_id, pgid, leader_started from receipts where status = 'accepted'").all() as {
			invocation_id: string;
			pgid: number | null;
			leader_started: string | null;
		}[];
		const markUnknown = this.#db.prepare(
			"update receipts set status = 'unknown', outcome = ?, finished_at = ? where invocation_id = ?",
		);
		for (const row of stale) {
			markUnknown.run(JSON.stringify(INTERRUPTED_OUTCOME), this.#now(), row.invocation_id);
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
