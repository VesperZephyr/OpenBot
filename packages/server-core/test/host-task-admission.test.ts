import type { ToolInvocation } from "@openbot/protocol";
import { describe, expect, it } from "vitest";
import { admitHostTask, type TaskAdmissionHost } from "../src/host-task-admission.ts";

function invocation(overrides: Partial<ToolInvocation> = {}): ToolInvocation {
	return {
		invocationId: "inv",
		botId: "bot",
		conversationId: "42",
		tool: "local_exec" as ToolInvocation["tool"],
		args: { command: "pwd" },
		argsDigest: "digest",
		target: { kind: "local", targetId: "mac" },
		grants: [],
		readGrants: [],
		deadline: 1,
		authorityRevision: 3,
		runId: "run",
		...overrides,
	};
}

function host(options?: {
	channel?: "group" | "routine" | "task";
	run?: { taskId?: string; origin?: string };
	revision?: number;
	rejection?: string;
	assert?: () => Promise<void>;
	allowed?: () => void;
}) {
	const calls: string[] = [];
	let gotRun = 0;
	const admission: TaskAdmissionHost = {
		runtime: {
			runsStore: () => ({
				get: async () => {
					gotRun += 1;
					return options?.run;
				},
			}),
			channels: async () => (options?.channel ? [{ conversationId: 42, kind: options.channel }] : []),
			policy: () => ({ settings: async () => ({ revision: options?.revision ?? 3 }) }),
		},
		status: { targetId: "mac" },
		authority: { change: async (fn) => (calls.push("authority"), fn()) },
		lifecycle: {
			assertAllowed: () => {
				calls.push("allowed");
				options?.allowed?.();
			},
		},
		approvals: { rejection: async (id) => (calls.push(id), options?.rejection) },
		tasks: {
			assertExecution: async () => {
				calls.push("assert");
				await options?.assert?.();
			},
		},
	};
	return { admission, calls, gotRun: () => gotRun };
}

describe("task dispatch admission", () => {
	it("sends a non-task call immediately and refuses one already aborted", async () => {
		const sent: string[] = [];
		const direct = host({ channel: "group", run: { origin: "user" } });
		await admitHostTask(direct.admission, invocation(), new AbortController().signal, () => sent.push("sent"));
		expect(sent).toEqual(["sent"]);
		expect(direct.calls).toEqual([]);
		expect(direct.gotRun()).toBe(1);
		const absent = host();
		const { runId: _runId, ...withoutRun } = invocation();
		await admitHostTask(absent.admission, withoutRun, new AbortController().signal, () => sent.push("no-run"));
		expect(absent.gotRun()).toBe(0);
		expect(sent).toEqual(["sent", "no-run"]);
		const aborted = host({ channel: "group", run: { origin: "user" } });
		await expect(admitHostTask(aborted.admission, invocation(), AbortSignal.abort(), () => sent.push("late"))).rejects.toMatchObject({ name: "AbortError" });
		expect(sent).toEqual(["sent", "no-run"]);
	});

	it("admits a task channel, task id, or task origin only while authority still matches", async () => {
		const sent: string[] = [];
		for (const options of [{ channel: "task" as const }, { run: { taskId: "task" } }, { run: { origin: "task" } }]) {
			const sample = host(options);
			await admitHostTask(sample.admission, invocation(), new AbortController().signal, () => sent.push("ok"));
			expect(sample.calls).toEqual(["authority", "allowed", "approval:inv", "assert"]);
		}
		expect(sent).toEqual(["ok", "ok", "ok"]);
		const taskOnly = host({ channel: "task" });
		const { runId: _ignored, ...withoutRun } = invocation();
		await admitHostTask(taskOnly.admission, withoutRun, new AbortController().signal, () => sent.push("channel"));
		expect(taskOnly.gotRun()).toBe(0);
		const mismatches = [
			invocation({ target: { kind: "remote", targetId: "mac" } as unknown as ToolInvocation["target"] }),
			invocation({ target: { kind: "local", targetId: "other" } }),
			invocation({ authorityRevision: 9 }),
		];
		for (const call of mismatches) {
			const sample = host({ channel: "task" });
			await expect(admitHostTask(sample.admission, call, new AbortController().signal, () => sent.push("bad"))).rejects.toMatchObject({
				code: "permission_revoked",
				message: "Task authority changed before dispatch",
			});
			expect(sample.calls).toEqual(["authority", "allowed"]);
		}
		const rejected = host({ run: { origin: "task" }, rejection: "The user denied this" });
		await expect(admitHostTask(rejected.admission, invocation(), new AbortController().signal, () => sent.push("denied"))).rejects.toMatchObject({
			code: "permission_revoked",
			message: "The user denied this",
		});
		expect(sent).toEqual(["ok", "ok", "ok", "channel"]);
	});

	it("does not send when the lifecycle or the signal fails inside the authority line", async () => {
		const sent: string[] = [];
		const paused = host({ channel: "task", allowed: () => { throw new Error("paused"); } });
		await expect(admitHostTask(paused.admission, invocation(), new AbortController().signal, () => sent.push("paused"))).rejects.toThrow("paused");
		expect(paused.calls).toEqual(["authority", "allowed"]);
		const late = host({ channel: "task", assert: async () => controller.abort() });
		const controller = new AbortController();
		await expect(admitHostTask(late.admission, invocation(), controller.signal, () => sent.push("late"))).rejects.toMatchObject({ name: "AbortError" });
		expect(sent).toEqual([]);
	});
});
