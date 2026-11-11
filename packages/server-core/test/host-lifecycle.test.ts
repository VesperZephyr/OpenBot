import type { OperationAudit } from "../src/host-ports.ts";
import { describe, expect, it } from "vitest";
import { startHostSession, stopHostSession, type HostSession } from "../src/host-lifecycle.ts";

function session(options?: { needsResume?: boolean; autoResume?: boolean; blocked?: boolean; fail?: "start" | "audit" | "pause" }) {
	const log: string[] = [];
	const audits: OperationAudit[] = [];
	const times = [10, 40];
	let history: (() => void) | undefined;
	let activity: (() => void) | undefined;
	let stopper: (() => void) | undefined;
	const observers = new Map<string, { stop: () => void }>([["live", { stop: () => log.push("observer.stop") }]]);
	const state = { needsResume: options?.needsResume ?? false, autoResume: options?.autoResume, blocked: options?.blocked ?? false };
	const host = {
		runtime: {
			onHistoryChanged: (listener: () => void) => {
				history = listener;
				return () => log.push("historyStop");
			},
			execution: {
				changes: {
					add: (listener: () => void) => {
						activity = listener;
					},
					delete: (listener: () => void) => {
						if (listener === activity) log.push("activityStop");
					},
				},
			},
			ensureCoreBot: async () => log.push("ensureCoreBot"),
			policy: () => ({ bind: async (targetId: string) => log.push(`policy.bind:${targetId}`) }),
			approvals: () => "store",
			listBots: async () => [
				{ status: "deleted", botId: "gone" },
				{ status: "active", botId: "live" },
			],
			resume: () => log.push("runtime.resume"),
		},
		observation: {
			changed: (mask?: number) => log.push(`observation:${mask}`),
			close: () => log.push("observation.close"),
		},
		tasks: { changed: async () => log.push("tasks.changed"), close: async () => log.push("tasks.close") },
		lifecycle: {
			start: async () => {
				if (options?.fail === "start") throw new Error("lifecycle down");
				log.push("lifecycle.start");
			},
			get state() {
				return state;
			},
			pause: async (reason: string) => {
				log.push(`lifecycle.pause:${reason}`);
				if (options?.fail === "pause") throw new Error("pause down");
			},
		},
		reloadModelConfig: async () => log.push("reloadModelConfig"),
		now: () => times.shift() ?? 0,
		audit: (event: OperationAudit) => {
			audits.push(event);
			log.push(`audit:${event.operation}:${event.outcome}`);
			if (options?.fail === "audit") throw new Error("audit down");
		},
		targetId: "mac",
		approvals: { start: async () => log.push("approvals.start"), close: () => log.push("approvals.close") },
		connectors: { start: async () => log.push("connectors.start"), close: async () => log.push("connectors.close") },
		observe: async (botId: string) => log.push(`observe:${botId}`),
		authority: { reconcile: async () => log.push("authority.reconcile") },
		routines: {
			prepare: async () => log.push("routines.prepare"),
			start: async () => log.push("routines.start"),
			close: async () => log.push("routines.close"),
		},
		runs: { start: async () => log.push("runs.start"), stop: () => log.push("runs.stop") },
		groups: { start: async () => log.push("groups.start"), stop: async () => log.push("groups.stop") },
		background: { start: async () => log.push("background.start"), close: async () => log.push("background.close") },
		feed: { stop: () => log.push("feed.stop") },
		observers,
		stopHistory: () => stopper,
		setStopHistory: (stop: () => void) => {
			stopper = stop;
			log.push("watch");
		},
	};
	return {
		host: host as unknown as HostSession,
		log,
		audits,
		history: () => history,
		activity: () => activity,
		stopper: () => stopper,
		observers,
	};
}

const OPEN = [
	"watch",
	"lifecycle.start",
	"reloadModelConfig",
	"ensureCoreBot",
	"audit:core.ensure:succeeded",
	"policy.bind:mac",
	"approvals.start",
	"connectors.start",
	"observe:live",
	"authority.reconcile",
	"routines.prepare",
	"runs.start",
	"tasks.changed",
	"groups.start",
	"background.start",
	"routines.start",
	"runtime.resume",
];

describe("host startup and shutdown", () => {
	it("attaches approvals and observers before resuming, and skips deleted Bots", async () => {
		const started = session();
		await startHostSession(started.host);
		expect(started.log).toEqual(OPEN);
		expect(started.audits[0]).toMatchObject({ operation: "core.ensure", outcome: "succeeded", at: 10, durationMs: 30 });
		started.history()?.();
		expect(started.log.slice(-2)).toEqual(["observation:7", "tasks.changed"]);
		started.activity()?.();
		expect(started.log.at(-1)).toBe("observation:1");
	});

	it("installs the history watcher before a startup failure, and keeps going when diagnostics fail", async () => {
		const failed = session({ fail: "start" });
		await expect(startHostSession(failed.host)).rejects.toThrow("lifecycle down");
		expect(failed.stopper()).toBeTypeOf("function");
		expect(failed.log).toEqual(["watch"]);
		const audited = session({ fail: "audit" });
		await startHostSession(audited.host);
		expect(audited.log).toContain("policy.bind:mac");
		expect(audited.log.at(-1)).toBe("runtime.resume");
	});

	it("pauses recovery unless auto-resume is set, and resumes only while work is allowed", async () => {
		const recovery = session({ needsResume: true, blocked: true });
		await startHostSession(recovery.host);
		expect(recovery.log).toContain("lifecycle.pause:recovery");
		expect(recovery.log).not.toContain("runtime.resume");
		const automatic = session({ needsResume: true, autoResume: true, blocked: true });
		await startHostSession(automatic.host);
		expect(automatic.log).not.toContain("lifecycle.pause:recovery");
		const paused = session({ needsResume: true, fail: "pause" });
		await startHostSession(paused.host);
		expect(paused.log).toContain("groups.start");
		const open = session({ blocked: false });
		await startHostSession(open.host);
		expect(open.log.at(-1)).toBe("runtime.resume");
	});

	it("stops in shutdown order and clears observers even when start never ran", async () => {
		const started = session();
		await startHostSession(started.host);
		started.log.length = 0;
		await stopHostSession(started.host);
		expect(started.log).toEqual([
			"historyStop",
			"activityStop",
			"tasks.close",
			"routines.close",
			"background.close",
			"connectors.close",
			"observation.close",
			"groups.stop",
			"approvals.close",
			"runs.stop",
			"feed.stop",
			"observer.stop",
		]);
		expect(started.observers.size).toBe(0);
		const cold = session();
		cold.log.length = 0;
		await stopHostSession(cold.host);
		expect(cold.log[0]).toBe("tasks.close");
		expect(cold.observers.size).toBe(0);
	});
});
