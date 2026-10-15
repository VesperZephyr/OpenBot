/**
 * `memory_update`: a Host tool that edits one section of the calling Bot's memory. Rerunning the same call after a
 * restart leaves the memory as the first run did (see `applyMemoryEdit`), so it is replay-safe without a receipt.
 */
import type { MemoryEdit } from "@openbot/agent-runtime";
import { ProtocolError, type ToolOutcome } from "@openbot/protocol";

/** `editMemory` is `BotRuntime.editMemory`; a port, because the router is built before the runtime opens. */
export function memoryUpdate(editMemory: (botId: string, edit: MemoryEdit) => Promise<string>) {
	return async (
		args: Readonly<Record<string, unknown>>,
		_signal: AbortSignal,
		call: { readonly botId: string },
	): Promise<ToolOutcome> => {
		const { action, section, content } = args;
		if ((action !== "replace" && action !== "append") || typeof section !== "string" || typeof content !== "string") {
			return { status: "failed", output: "memory_update needs action (replace or append), section, and content" };
		}
		try {
			const memory = await editMemory(call.botId, { action, section, content });
			return { status: "succeeded", output: `Memory updated (${new TextEncoder().encode(memory).length} bytes).` };
		} catch (error) {
			if (error instanceof ProtocolError) return { status: "failed", output: error.message };
			throw error;
		}
	};
}
