/** Offline storage validation: never constructs an executor, connector session or process supervisor. */
import { validateExecutorBackup } from "@openbot/local-executor";
let directory = "";
for await (const chunk of process.stdin) {
	directory += String(chunk);
	if (directory.length > 8192) throw Error("Invalid backup path");
}
validateExecutorBackup(directory);
