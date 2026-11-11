import { TEMPLATE_LIMITS } from "@openbot/protocol";
import type { HostMethod, HostParams, HostResult } from "@openbot/protocol";
import { describe, expect, it } from "vitest";
import { dispatchHostRequest, hostMethodAudited, hostMethodSerializes, type HostDispatchState, type HostHandlers } from "../src/host-dispatch.ts";

const SERIALIZED = [
	"bots.templates.import",
	"bots.create",
	"bots.update",
	"bots.duplicate",
	"bots.delete",
	"conversations.delete",
	"conversations.reopen",
	"messages.submit",
	"groups.change",
	"groups.send",
] as const satisfies readonly HostMethod[];

const QUIET = [
	"observation.wait",
	"artifacts.preview",
	"host.status",
	"groups.snapshot",
	"conversations.snapshot",
	"conversations.subscribe",
	"conversations.markRead",
	"conversations.search",
	"files.resolveReveal",
	"usage.get",
	"grants.list",
	"bots.management.history",
] as const satisfies readonly HostMethod[];

const template = {
	format: "openbot-bot-template" as const,
	version: 1 as const,
	profile: {
		name: "Reader",
		role: "research",
		instructions: "Do research",
		avatar: { kind: "generated" as const, version: 1 as const, seed: 1, motif: "leaf" as const },
		model: null,
		thinkingLevel: "off" as const,
		defaultSkills: [],
	},
};

function deferred() {
	let resolve: () => void = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function harness(run?: (method: HostMethod) => Promise<unknown>) {
	const calls: string[] = [];
	let slots = 0;
	let clock = 10;
	const state: HostDispatchState = {
		handlers: new Proxy({} as HostHandlers, {
			get: (_target, key) => {
				if (key === "missing") return undefined;
				const method = String(key) as HostMethod;
				return async () => {
					calls.push(`handler:${method}`);
					return (await run?.(method)) ?? null;
				};
			},
		}),
		now: () => {
			const at = clock;
			clock += 30;
			return at;
		},
		audit: (event) => calls.push(`audit:${event.operation}:${event.outcome}:${event.durationMs}`),
		noteMutation: () => calls.push("mutation"),
		serialize: async (work) => {
			calls.push("serialize");
			return work();
		},
		templateOperations: () => slots,
		setTemplateOperations: (count) => {
			slots = count;
		},
	};
	return {
		state,
		calls,
		slots: () => slots,
		dispatch<M extends HostMethod>(method: M, params: HostParams<M> = {} as HostParams<M>) {
			return dispatchHostRequest(state, method, params);
		},
	};
}

describe("host request dispatch", () => {
	it("rejects an unknown method before a handler or an audit row", async () => {
		const host = harness();
		await expect(host.dispatch("missing" as HostMethod)).rejects.toMatchObject({ code: "unknown_method", message: "Unknown method: missing" });
		expect(host.calls).toEqual([]);
	});

	it("serializes bot, conversation, and group mutations and leaves other methods off that queue", async () => {
		const host = harness();
		for (const method of SERIALIZED) {
			if (method === "bots.templates.import") continue;
			await host.dispatch(method);
			expect(host.calls.at(-4)).toBe("serialize");
			expect(host.calls.at(-3)).toBe(`handler:${method}`);
			expect(host.calls.at(-2)).toBe("mutation");
			expect(host.calls.at(-1)).toBe(`audit:${method}:succeeded:30`);
		}
		host.calls.length = 0;
		await host.dispatch("host.status");
		expect(host.calls).toEqual(["handler:host.status"]);
		expect(hostMethodSerializes("bots.templates.import")).toBe(true);
		const imported = harness();
		await imported.dispatch("bots.templates.import", {
			requestId: "00000000-0000-4000-8000-000000000000",
			template,
			templateDigest: "a".repeat(64),
			choices: { name: "Reader", model: { kind: "default" }, skills: [] },
		});
		expect(imported.calls.slice(0, 2)).toEqual(["serialize", "handler:bots.templates.import"]);
	});

	it("does not audit reads, lists, history, or the projection methods", async () => {
		const host = harness();
		for (const method of QUIET) {
			await host.dispatch(method);
			expect(hostMethodAudited(method)).toBe(false);
		}
		expect(host.calls.filter((call) => call.startsWith("audit:") || call === "mutation")).toEqual([]);
		for (const method of ["credentials.status", "routines.activity", "policy.reconcile"] as const) {
			await host.dispatch(method);
			expect(host.calls.at(-1)).toBe(`audit:${method}:succeeded:30`);
			expect(hostMethodAudited(method)).toBe(true);
		}
	});

	it("records a failed test and a thrown handler without treating either as a mutation", async () => {
		const tested = harness(async (method) => (method === "models.test" ? { ok: false, error: "no" } : null));
		await expect(tested.dispatch("models.test", { provider: "p", modelId: "m" })).resolves.toEqual({ ok: false, error: "no" });
		expect(tested.calls).toEqual(["handler:models.test", "audit:models.test:failed:30"]);
		const failed = harness(async () => {
			throw new Error("nope");
		});
		await expect(failed.dispatch("bots.create", { requestId: "r", name: "A" })).rejects.toThrow("nope");
		expect(failed.calls).toEqual(["serialize", "handler:bots.create", "audit:bots.create:failed:30"]);
	});

	it("returns the result when diagnostics throw, and skips the audit when observation throws", async () => {
		const audited = harness(async () => "saved" as unknown as HostResult<"bots.create">);
		audited.state.audit = () => {
			throw new Error("audit down");
		};
		await expect(audited.dispatch("bots.create", { requestId: "r", name: "A" })).resolves.toBe("saved");
		const observed = harness(async () => "saved" as unknown as HostResult<"bots.create">);
		const audits: string[] = [];
		observed.state.noteMutation = () => {
			throw new Error("observation down");
		};
		observed.state.audit = () => audits.push("audit");
		await expect(observed.dispatch("bots.create", { requestId: "r", name: "A" })).resolves.toBe("saved");
		expect(audits).toEqual([]);
	});

	it("limits template operations without auditing a request that never started", async () => {
		const host = harness();
		await expect(host.dispatch("bots.templates.status", { requestId: "nope" })).rejects.toMatchObject({
			code: "invalid_request",
			message: "Invalid Bot template or import choices",
		});
		expect(host.slots()).toBe(0);
		expect(host.calls).toEqual([]);
		const gates = Array.from({ length: TEMPLATE_LIMITS.operations }, () => deferred());
		let started = 0;
		const running = harness(async () => {
			const gate = gates[started++];
			await gate?.promise;
			return { requestId: "00000000-0000-4000-8000-000000000000" };
		});
		const pending = gates.map(() => running.dispatch("bots.templates.status", { requestId: "00000000-0000-4000-8000-000000000000" }));
		expect(running.slots()).toBe(TEMPLATE_LIMITS.operations);
		await expect(running.dispatch("templates.file.read", { path: "/tmp/bot.json" })).rejects.toMatchObject({
			message: "Too many template operations; try again",
		});
		expect(running.slots()).toBe(TEMPLATE_LIMITS.operations);
		gates[0]?.resolve();
		await pending[0];
		expect(running.slots()).toBe(TEMPLATE_LIMITS.operations - 1);
		await expect(running.dispatch("bots.templates.status", { requestId: "00000000-0000-4000-8000-000000000000" })).resolves.toEqual({
			requestId: "00000000-0000-4000-8000-000000000000",
		});
		for (const gate of gates.slice(1)) gate.resolve();
		await Promise.all(pending.slice(1));
		expect(running.slots()).toBe(0);
	});

	it("releases a template slot and audits a failure when the result exceeds the IPC limit", async () => {
		const host = harness(async () => "x".repeat(TEMPLATE_LIMITS.ipcBytes));
		await expect(host.dispatch("templates.file.read", { path: "/tmp/bot.json" })).rejects.toMatchObject({
			code: "invalid_request",
			message: "Bot template exceeds the IPC limit",
		});
		expect(host.slots()).toBe(0);
		expect(host.calls.at(-1)).toBe("audit:templates.file.read:failed:30");
	});
});
