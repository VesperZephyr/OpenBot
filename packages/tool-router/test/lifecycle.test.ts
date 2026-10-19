import { expect, it, vi } from "vitest";
import { ToolRouter, type ToolCall } from "../src/index.ts";
const call = (tool = "local_write"): ToolCall => ({
	botId: "bot",
	conversationId: "c",
	callId: "one",
	tool,
	args: tool === "codemode" ? { code: "return 1" } : { path: "a.txt", content: "data" },
	signal: new AbortController().signal,
	onProgress: () => {},
});
function fixture() {
	let blocked = false;
	const invoke = vi.fn(async () => ({ status: "succeeded" as const, output: "done" }));
	const options = {
		target: { kind: "local" as const, targetId: "mac" },
		policy: {
			decide: vi.fn(async () => ({ kind: "allow" as const })),
			grants: vi.fn(async () => ({ readwrite: ["/workspace"], read: [] })),
		},
		approvals: { request: vi.fn(async () => "allow_once" as const) },
		executor: { invoke },
		hostTools: {},
		assertExecutionAllowed: () => {
			if (blocked) throw Error("paused");
		},
	};
	return {
		options,
		invoke,
		router: new ToolRouter(options),
		pause: () => {
			blocked = true;
		},
	};
}
it("refuses a leaf and Code Mode parent when execution is gated", async () => {
	const f = fixture();
	f.pause();
	await expect(f.router.invoke(call())).rejects.toThrow("paused");
	await expect(f.router.admitOrchestration(call("codemode"))).rejects.toThrow("paused");
	expect(f.invoke).not.toHaveBeenCalled();
});
it("rechecks after asynchronous grants before executor dispatch", async () => {
	const f = fixture(),
		gate = Promise.withResolvers<void>();
	f.options.policy.grants.mockImplementation(async () => {
		await gate.promise;
		return { readwrite: ["/workspace"], read: [] };
	});
	const pending = f.router.invoke(call());
	await vi.waitFor(() => expect(f.options.policy.grants).toHaveBeenCalled());
	f.pause();
	gate.resolve();
	await expect(pending).rejects.toThrow("paused");
	expect(f.invoke).not.toHaveBeenCalled();
});
it("an approval granted after pause never dispatches its action", async () => {
	let blocked = false;
	const asked = Promise.withResolvers<void>(),
		approval = Promise.withResolvers<"allow_once">(),
		invoke = vi.fn();
	const router = new ToolRouter({
		target: { kind: "local", targetId: "mac" },
		policy: { decide: async () => ({ kind: "ask", reason: "confirm" }), grants: async () => ({ readwrite: [], read: [] }) },
		approvals: {
			request: async () => {
				asked.resolve();
				return approval.promise;
			},
		},
		executor: { invoke },
		hostTools: {},
		assertExecutionAllowed: () => {
			if (blocked) throw Error("paused");
		},
	});
	const pending = router.invoke(call());
	await asked.promise;
	blocked = true;
	approval.resolve("allow_once");
	await expect(pending).rejects.toThrow("paused");
	expect(invoke).not.toHaveBeenCalled();
});
