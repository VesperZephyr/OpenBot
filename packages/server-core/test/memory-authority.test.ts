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

it("validates bound reads, sanitizes exceptions and preserves cancellation", async () => {
 const { memoryRead } = await import("../src/memory-tool.ts");
 const read = vi.fn(async () => { throw new Error("secret body"); });
 const invoke = memoryRead(read, "memory_search"), signal = new AbortController().signal;
 const call = { botId: "a", conversationId: "1", runId: "r" };
 expect(await invoke({ query: "coffee", botId: "b" }, signal, call)).toMatchObject({ status: "failed", output: expect.stringContaining("invalid_arguments") });
 expect(await invoke({ query: "coffee" }, signal, { botId: "a", conversationId: "1" })).toMatchObject({ output: expect.stringContaining("unavailable") });
 expect(read).not.toHaveBeenCalled();
 const result = await invoke({ query: "coffee" }, signal, call);
 expect(result.output).toContain("internal_error"); expect(result.output).not.toContain("secret");
 expect(await invoke({ query: "coffee" }, AbortSignal.abort(), call)).toMatchObject({ output: expect.stringContaining("cancelled") });
});

it("drops a pending read's content when Stop arrives before delivery", async () => {
 const { memoryRead } = await import("../src/memory-tool.ts");
 const gate = Promise.withResolvers<import("@openbot/protocol").MemoryReadResponse>();
 const controller = new AbortController();
 const pending = memoryRead(async () => gate.promise, "memory_search")({ query: "coffee" }, controller.signal, { botId: "a", conversationId: "c", runId: "r" });
 controller.abort();
 gate.resolve({ ok: true, observedAt: 1, revisions: { local: 1, shared: 0 }, hits: [], truncated: false });
 expect(await pending).toMatchObject({ status: "failed", output: expect.stringContaining('"cancelled"') });
});
