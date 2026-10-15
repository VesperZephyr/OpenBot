/**
 * Local executor process. Started by the Host with an IPC channel; serves `tool.invoke` and `tool.cancel` for the
 * bound local target and exits when the Host goes away, stopping the commands it supervises.
 */
import { EXECUTOR_TOOLS, LocalExecutor } from "@openbot/local-executor";
import { type ExecutorMessage, type ExecutorRequest, PROTOCOL_VERSION } from "@openbot/protocol";

const targetId = process.env.OPENBOT_TARGET_ID;
const workspace = process.env.OPENBOT_WORKSPACE;
if (targetId === undefined || workspace === undefined || process.send === undefined) {
	console.error("The local executor must be started by the Host Runtime");
	process.exit(2);
}

const executor = new LocalExecutor({ targetId, workspace });
const running = new Set<string>();
const send = (message: ExecutorMessage): void => {
	if (process.connected) process.send?.(message);
};

process.on("message", (message: ExecutorRequest) => {
	switch (message.kind) {
		case "tool.invoke": {
			const { invocationId } = message.invocation;
			running.add(invocationId);
			void executor
				.invoke(message.invocation, (output) => send({ kind: "tool.progress", invocationId, output }))
				.then((outcome) => {
					running.delete(invocationId);
					send({ kind: "tool.result", invocationId, outcome });
					// Demo: the Host records results in Pi's transcript; a persistent receipt ledger is backlog work.
					executor.forget(invocationId);
				});
			return;
		}
		case "tool.cancel":
			executor.cancel(message.invocationId);
	}
});

// Losing the Host means nobody can receive results: stop supervised commands, then exit.
process.on("disconnect", () => {
	for (const invocationId of running) executor.cancel(invocationId);
	setTimeout(() => process.exit(0), 3_500).unref();
	if (running.size === 0) process.exit(0);
});

send({ kind: "executor.hello", protocolVersion: PROTOCOL_VERSION, targetId, tools: EXECUTOR_TOOLS });
