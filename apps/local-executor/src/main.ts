/**
 * Local executor process. Started by the Host with an IPC channel; serves the executor protocol (Section 6.2) for the
 * bound local target over the receipt ledger in `<data>/executor/receipts.sqlite`, saves cut tool output under
 * `<data>/artifacts`, and exits when the Host goes away, stopping the commands it supervises.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_YIELD_MS, EXECUTOR_TOOLS, LocalExecutor, pruneArtifacts, ReceiptLedger } from "@openbot/local-executor";
import { type ExecutorMessage, type ExecutorRequest, PROTOCOL_VERSION } from "@openbot/protocol";

const targetId = process.env.OPENBOT_TARGET_ID;
const workspace = process.env.OPENBOT_WORKSPACE;
const dataDirectory = process.env.OPENBOT_DATA_DIR;
if (targetId === undefined || workspace === undefined || dataDirectory === undefined || process.send === undefined) {
	console.error("The local executor must be started by the Host Runtime");
	process.exit(2);
}
/** Tests shorten how long a foreground command runs before it moves to the background; unset or invalid means the default. */
const yieldSetting = Number(process.env.OPENBOT_EXEC_YIELD_MS);
const yieldMs = process.env.OPENBOT_EXEC_YIELD_MS && Number.isInteger(yieldSetting) && yieldSetting > 0 ? yieldSetting : DEFAULT_YIELD_MS;

const ledgerDirectory = join(dataDirectory, "executor");
mkdirSync(ledgerDirectory, { recursive: true, mode: 0o700 });
// Canonical, because `local_read` compares canonical paths against it.
mkdirSync(join(dataDirectory, "artifacts"), { recursive: true, mode: 0o700 });
const artifactsDirectory = realpathSync(join(dataDirectory, "artifacts"));
pruneArtifacts(artifactsDirectory);
// Opening converts receipts a previous executor left `accepted` to `unknown`, marks its background tasks `unknown`,
// and kills their orphaned process groups.
const ledger = ReceiptLedger.open(join(ledgerDirectory, "receipts.sqlite"));
const executor = new LocalExecutor({
	targetId,
	workspace,
	ledger,
	artifactsDirectory,
	...(Number.isFinite(yieldMs) && yieldMs >= 0 ? { yieldMs } : {}),
});
const send = (message: ExecutorMessage): void => {
	if (process.connected) process.send?.(message);
};

process.on("message", (message: ExecutorRequest) => {
	switch (message.kind) {
		case "tool.invoke": {
			const { invocationId } = message.invocation;
			void executor
				.invoke(message.invocation, (output) => send({ kind: "tool.progress", invocationId, output }))
				.catch((error: unknown) => ({
					status: "unknown" as const,
					output: `The executor could not record this action's result: ${error instanceof Error ? error.message : String(error)}`,
				}))
				.then((outcome) => send({ kind: "tool.result", invocationId, outcome }));
			return;
		}
		case "tool.cancel":
			executor.cancel(message.invocationId);
			return;
		case "tool.status": {
			const receipt = ledger.get(message.invocationId);
			send({
				kind: "tool.status",
				invocationId: message.invocationId,
				status: receipt?.status ?? "absent",
				...(receipt?.outcome === undefined ? {} : { outcome: receipt.outcome }),
			});
			return;
		}
		case "result.ack":
			executor.ack(message.invocationId);
			return;
		case "tasks.stop":
			executor.stopTasks(message.conversationId);
	}
});

// Losing the Host means nobody can receive results: stop supervised commands, record their outcomes, then exit.
let stopping = false;
const shutdown = (): void => {
	if (stopping) return;
	stopping = true;
	setTimeout(() => process.exit(0), 3_500).unref();
	void executor.cancelAll().finally(() => {
		ledger.close();
		process.exit(0);
	});
};
process.on("disconnect", shutdown);
process.on("SIGTERM", shutdown);

send({ kind: "executor.hello", protocolVersion: PROTOCOL_VERSION, targetId, instanceId: randomUUID(), tools: EXECUTOR_TOOLS });
