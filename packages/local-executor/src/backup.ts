/** Offline validation only: importing a snapshot must never revive process ownership or unfinished file mutations. */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function validateExecutorBackup(directory: string): void {
	const checks: [string, string, string[]][] = [
		[
			"executor",
			"receipts.sqlite",
			[
				"select invocation_id from receipts where status='accepted' limit 1",
				"select task_id from background_tasks where status='running' limit 1",
			],
		],
		["executor", "connectors.sqlite", ["select connector_id from connector_processes limit 1"]],
		["attachments", "metadata.sqlite", ["select id from operations where result is null limit 1"]],
		["skills", "metadata.sqlite", ["select id from mutations where result is null limit 1"]],
	];
	for (const [root, file, queries] of checks) {
		if (!existsSync(join(directory, root))) continue;
		const db = new DatabaseSync(join(directory, root, file), { readOnly: true });
		try {
			for (const query of queries)
				if (db.prepare(query).get()) throw Error("Backup contains unfinished executor work; reconcile it before backing up");
		} finally {
			db.close();
		}
	}
}
