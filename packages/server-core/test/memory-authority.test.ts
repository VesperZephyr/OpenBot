import { expect, it, vi } from "vitest";
import { memoryUpdate } from "../src/memory-tool.ts";

it("rejects model-supplied scope or attribution before any memory mutation", async () => {
	const edit = vi.fn(async () => 1);
	const invoke = memoryUpdate(edit);
	const args = { action: "append", section: "City", content: "Singapore", expectedRevision: 0 };
	const call = { botId: "a", conversationId: "1", callId: "c", runId: "r" };
	for (const extra of [{ scope: "shared" }, { botId: "other" }, { source: { kind: "user" } }, { protected: true }])
		expect((await invoke({ ...args, ...extra }, new AbortController().signal, call)).status).toBe("failed");
	const { runId: _, ...unbound } = call;
	expect((await invoke(args, new AbortController().signal, unbound)).status).toBe("failed");
	expect(edit).not.toHaveBeenCalled();
});
