import { expect, it, vi } from "vitest";
import { ToolRouter, type ToolCall } from "../src/index.ts";
const connector = { connectorId: "notes", revision: 1, schemaHash: "a".repeat(64) };
const call: ToolCall = {
	botId: "bot",
	conversationId: "1",
	callId: "call",
	tool: "mcp__notes__write",
	connector,
	args: { text: "x" },
	signal: new AbortController().signal,
	onProgress: () => {},
};
function fixture() {
	const invoke = vi.fn(async () => ({ status: "succeeded" as const, output: "done" })),
		approve = vi.fn(async () => "allow_once" as const),
		receipt = vi.fn(async (..._args: any[]): Promise<any> => undefined),
		decide = vi.fn(async () => ({ kind: "ask" as const, reason: "Connector" }));
	const router = new ToolRouter({
		target: { kind: "local", targetId: "mac" },
		resolveTool: (name) =>
			name === call.tool
				? { name, description: "Write", capability: "connectors", destination: "executor", parameters: { type: "object" }, connector }
				: undefined,
		policy: { decide, grants: async () => ({ read: [], readwrite: [] }) },
		approvals: { request: approve },
		executor: { invoke, receipt },
		hostTools: {},
	});
	return { router, invoke, approve, receipt, decide };
}
it("binds dynamic connector calls and digests the trusted identity separately from model arguments", async () => {
	const f = fixture();
	expect((await f.router.invoke(call)).status).toBe("succeeded");
	const first = (f.invoke.mock.calls as any)[0][0];
	expect(first.target).toEqual({ kind: "local", targetId: "mac" });
	expect(first.connector).toEqual(connector);
	expect(f.approve).toHaveBeenCalledTimes(1);
	await f.router.invoke({ ...call, connector: { ...connector, revision: 2 } });
	const second = (f.invoke.mock.calls as any)[1][0];
	expect(second.argsDigest).not.toBe(first.argsDigest);
	expect((await f.router.invoke({ ...call, target: { kind: "local", targetId: "other" } })).status).toBe("failed");
	expect(f.invoke).toHaveBeenCalledTimes(2);
});
it("reads known receipt before fresh connector policy and never dispatches the effect again", async () => {
	const f = fixture();
	f.receipt.mockResolvedValue({ status: "unknown", output: "Unconfirmed external write" });
	expect((await f.router.invoke(call)).status).toBe("unknown");
	expect(f.decide).not.toHaveBeenCalled();
	expect(f.approve).not.toHaveBeenCalled();
	expect(f.invoke).not.toHaveBeenCalled();
});
