import { expect, it, vi } from "vitest";
import { ToolRouter, type ToolCall } from "../src/index.ts";

const call = (signal = new AbortController().signal): ToolCall => ({ botId: "a", conversationId: "c", runId: "r", callId: "read", tool: "memory_search", args: { query: "coffee" }, signal, onProgress: () => {} });
it("keeps memory denials and cancellation outside successful read results", async () => {
 const read = vi.fn(async () => ({ status: "succeeded" as const, output: "PRIVATE_FACT" }));
 const router = new ToolRouter({ target: { kind: "local", targetId: "mac" }, policy: { decide: async () => ({ kind: "ask", reason: "Review memory" }), grants: async () => ({ read: [], readwrite: [] }) }, approvals: { request: async () => "deny" }, executor: { invoke: vi.fn() }, hostTools: { memory_search: read } });
 expect(await router.invoke(call())).toMatchObject({ status: "failed", failureReason: "approval_denied" });
 await expect(router.invoke(call(AbortSignal.abort()))).rejects.toThrow();
 expect(read).not.toHaveBeenCalled();
});
it("checks bound lifecycle again after approval before a memory read", async () => {
 let active = true;
 const read = vi.fn(), router = new ToolRouter({ target: { kind: "local", targetId: "mac" }, policy: { decide: async () => ({ kind: "ask", reason: "Review memory" }), grants: async () => ({ read: [], readwrite: [] }) }, approvals: { request: async () => { active = false; return "allow_once"; } }, executor: { invoke: vi.fn() }, hostTools: { memory_search: read }, assertCallAllowed: async () => { if (!active) throw Error("Run stopped"); } });
 await expect(router.invoke(call())).rejects.toThrow("Run stopped");
 expect(read).not.toHaveBeenCalled();
});
