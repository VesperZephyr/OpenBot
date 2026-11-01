import type { MemoryCallContext, MemoryEdit } from "@openbot/agent-runtime";
import { ProtocolError, memoryReadFailure, validMemoryRead, validMemorySearch, type MemoryReadResponse, type ToolOutcome } from "@openbot/protocol";

export function memoryRead(read: (botId: string, call: MemoryCallContext, tool: "memory_search" | "memory_read", args: unknown, signal: AbortSignal) => Promise<MemoryReadResponse>, tool: "memory_search" | "memory_read") {
	return async (args: Readonly<Record<string, unknown>>, signal: AbortSignal, call: { readonly runId?: string; readonly botId: string; readonly conversationId: string }): Promise<ToolOutcome> => {
		let result: MemoryReadResponse;
		if (signal.aborted) result = memoryReadFailure("cancelled");
		else if (tool === "memory_search" ? !validMemorySearch(args) : !validMemoryRead(args)) result = memoryReadFailure("invalid_arguments");
		else if (!call.runId) result = memoryReadFailure("unavailable");
		else {
			try { result = await read(call.botId, { runId: call.runId, conversationId: call.conversationId }, tool, args, signal); }
			catch { result = memoryReadFailure(signal.aborted ? "cancelled" : "internal_error"); }
		}
		if (signal.aborted) result = memoryReadFailure("cancelled");
		return { status: result.ok ? "succeeded" : "failed", output: JSON.stringify(result) };
	};
}

/** `editMemory` is `BotRuntime.editMemory`; a port, because the router is built before the runtime opens. */
export function memoryUpdate(editMemory: (botId: string, edit: MemoryEdit, invocationId: string, call: MemoryCallContext) => Promise<number>) {
	return async (
		args: Readonly<Record<string, unknown>>,
		_signal: AbortSignal,
		call: { readonly runId?: string; readonly botId: string; readonly conversationId: string; readonly callId: string },
	): Promise<ToolOutcome> => {
		const { action, section, content, expectedRevision } = args;
		if (
			Object.keys(args).some(key => !["action", "section", "content", "expectedRevision"].includes(key)) ||
			(action !== "replace" && action !== "append") ||
			typeof section !== "string" ||
			typeof content !== "string" ||
			!Number.isSafeInteger(expectedRevision) ||
			(expectedRevision as number) < 0
		) {
			return { status: "failed", output: "memory_update needs action (replace or append), section, content, and expectedRevision" };
		}
		if (!call.runId) return { status: "failed", output: "Memory learning requires an active direct user request" };
		try {
			const revision = await editMemory(
				call.botId,
				{ action, section, content, expectedRevision: expectedRevision as number },
				`${call.conversationId}:${call.callId}`,
				{ runId: call.runId, conversationId: call.conversationId },
			);
			return { status: "succeeded", output: `Memory updated. Revision: ${revision}.` };
		} catch (error) {
			if (error instanceof ProtocolError) return { status: "failed", output: error.message };
			throw error;
		}
	};
}
