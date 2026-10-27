import { afterEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ReceiptLedger } from "../src/ledger.ts";
import { ConnectorSupervisor } from "../src/connectors.ts";
import { validateExecutorBackup } from "../src/backup.ts";
let directory: string;
afterEach(() => {
	if (directory) rmSync(directory, { recursive: true, force: true });
});
it.each(["accepted receipt", "running task", "connector process"])("refuses imported %s without signalling it", async (kind) => {
	directory = mkdtempSync(join(tmpdir(), "backup-process-"));
	mkdirSync(join(directory, "executor"));
	ReceiptLedger.open(join(directory, "executor/receipts.sqlite")).close();
	await new ConnectorSupervisor(join(directory, "executor/connectors.sqlite"), "local:test", directory).close();
	validateExecutorBackup(directory);
	const connector = kind === "connector process";
	const db = new DatabaseSync(join(directory, "executor", connector ? "connectors.sqlite" : "receipts.sqlite"));
	if (connector) db.prepare("insert into connector_processes values('c',?,'not a process')").run(process.pid);
	else if (kind === "accepted receipt")
		db.prepare(
			"insert into receipts(invocation_id,args_digest,tool,status,accepted_at,pgid) values('i','d','local_exec','accepted',0,?)",
		).run(process.pid);
	else
		db.prepare(
			"insert into background_tasks(task_id,invocation_id,conversation_id,status,started_at,pgid) values('t','i','c','running',0,?)",
		).run(process.pid);
	db.close();
	expect(() => validateExecutorBackup(directory)).toThrow("unfinished");
	process.kill(process.pid, 0);
});
