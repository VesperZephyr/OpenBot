import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { BotRuntime, type StoredRun } from "@openbot/agent-runtime";
import { scriptedModels, SCRIPTED_MODEL } from "@openbot/agent-runtime/testing";
import { ProtocolError, type RoutineFields } from "@openbot/protocol";
import { Routines } from "../src/routines.ts";
import type { RunScheduler } from "../src/runs.ts";
import type { ApprovalBook } from "../src/approvals.ts";
let root: string,
	runtime: BotRuntime,
	service: Routines,
	now: number,
	canRun: boolean,
	loseAdmission: boolean,
	resolveSkills: ReturnType<typeof vi.fn<(refs: readonly import("@openbot/protocol").SkillRef[]) => Promise<unknown>>>;
let submit: ReturnType<typeof vi.fn>, changed: ReturnType<typeof vi.fn<() => void>>;
const fields: RoutineFields = {
	name: "Morning report",
	instructions: "Read the supplied source and report missing data.",
	schedule: { kind: "interval", minutes: 5 },
	catchUpHours: 24,
	skills: [],
};
const open = async () => {
	runtime = await BotRuntime.open({ databasePath: join(root, "db.sqlite"), models: scriptedModels().models });
};
function createService() {
	service = new Routines({
		runtime,
		runs: {
			submit,
			cancel: async (id: string) => {
				const r = await runtime.runsStore().get(id);
				await runtime.runsStore().put({ ...r!, state: "cancelled" });
			},
		} as unknown as RunScheduler,
		approvals: { forBot: () => [] } as unknown as ApprovalBook,
		targetId: "local",
		canRun: () => canRun,
		now: () => now,
		changed,
		resolveSkills,
		changeAuthority: (fn) => fn(),
		settled: () => {},
	});
}
const create = (id = "create", patch: Partial<RoutineFields> = {}) =>
	service.change({ action: "create", botId: "bot", requestId: id, fields: { ...fields, ...patch } });
const history = async (id: string) => (await service.detail(id)).history;
const finish = async (state: StoredRun["state"] = "completed") => {
	for (const r of await runtime.runsStore().list()) if (r.state === "queued") await runtime.runsStore().put({ ...r, state, endedAt: now });
	await service.sweep();
};
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "openbot-routines-"));
	now = Date.parse("2026-10-20T00:00:00Z");
	canRun = true;
	loseAdmission = false;
	changed = vi.fn();
	resolveSkills = vi.fn(async () => []);
	await open();
	await runtime.createBot({ botId: "bot", name: "Analyst", model: SCRIPTED_MODEL, createdAt: now });
	submit = vi.fn(async (botId: string, requestId: string, text: string, options: any) => {
		await resolveSkills(options.skills);
		let run = (await runtime.runsStore().list()).find((r) => r.requestIds.includes(requestId));
		if (!run) {
			run = {
				runId: `run_${requestId}`,
				botId,
				origin: options.origin,
				channelId: options.channelId,
				state: "queued",
				createdAt: now,
				requestIds: [requestId],
				messages: [{ requestId, text }],
				inputs: [],
			};
			await runtime.runsStore().put(run);
		}
		if (loseAdmission) {
			loseAdmission = false;
			throw Error("Lost admission");
		}
		return { runId: run.runId, state: run.state, steered: false };
	});
	createService();
	await service.prepare();
});
afterEach(async () => {
	await service.close();
	await runtime.close();
	await rm(root, { recursive: true, force: true });
});
it("deduplicates confirmed changes and tests, rejects revision and request conflicts across restart", async () => {
	const r = await create();
	expect(await create()).toEqual(r);
	expect(submit).not.toHaveBeenCalled();
	await expect(create("create", { name: "Different" })).rejects.toThrow("request ID");
	await expect(service.change({ action: "pause", routineId: r.routineId, expectedRevision: 2, requestId: "stale" })).rejects.toThrow(
		"changed",
	);
	const test = await service.test(r.routineId, 1, "test");
	expect(await service.test(r.routineId, 1, "test")).toEqual(test);
	await expect(create("test")).rejects.toThrow("request ID");
	await finish();
	await service.close();
	await runtime.close();
	await open();
	createService();
	expect(await service.test(r.routineId, 1, "test")).toEqual(test);
	await service.sweep();
	expect(submit).toHaveBeenCalledTimes(1);
	expect((await runtime.snapshot("bot")).items.filter((i) => i.kind === "assistant" && i.routine)).toHaveLength(1);
});
it("coalesces missed times, skips overlap and preserves the cursor across reopen", async () => {
	const r = await create();
	now += 3600000;
	await service.sweep();
	let h = await history(r.routineId);
	expect(h).toHaveLength(2);
	expect(h.find((o) => o.state === "skipped")?.skippedFrom).toBe(r.nextAt);
	expect(h.find((o) => o.state === "pending")?.scheduledAt).toBe(now);
	expect(submit).toHaveBeenCalledTimes(1);
	now += 300000;
	await service.sweep();
	expect((await history(r.routineId)).find((o) => o.scheduledAt === now)?.state).toBe("skipped");
	await service.close();
	await runtime.close();
	await open();
	createService();
	await service.sweep();
	expect(submit).toHaveBeenCalledTimes(1);
	await finish();
	now += 300000;
	await service.sweep();
	expect(submit).toHaveBeenCalledTimes(2);
});
it("does not catch up outside the window or while explicitly paused", async () => {
	let r = await create("zero", { catchUpHours: 0 });
	now += 420000;
	await service.sweep();
	expect(submit).not.toHaveBeenCalled();
	expect((await history(r.routineId))[0]?.state).toBe("skipped");
	r = await service.change({ action: "pause", routineId: r.routineId, expectedRevision: r.revision, requestId: "pause" });
	now += 3600000;
	await service.sweep();
	expect(submit).not.toHaveBeenCalled();
	r = await service.change({ action: "resume", routineId: r.routineId, expectedRevision: r.revision, requestId: "resume" });
	expect(r.nextAt).toBeGreaterThan(now);
	await service.sweep();
	expect(submit).not.toHaveBeenCalled();
	now = r.nextAt;
	await service.sweep();
	expect(submit).toHaveBeenCalledTimes(1);
});
it("persists absence protection, ignores polling and resumes only from now", async () => {
	const r = await create();
	const active = (await service.list()).lastActiveAt;
	now += 8 * 86400000;
	await service.sweep();
	expect((await service.list()).absencePaused).toBe(true);
	expect(submit).not.toHaveBeenCalled();
	expect((await service.list()).lastActiveAt).toBe(active);
	changed.mockClear();
	await service.sweep();
	expect(changed).not.toHaveBeenCalled();
	await service.activity();
	await service.sweep();
	expect((await service.list()).absencePaused).toBe(true);
	await service.presence(7, true);
	expect((await service.detail(r.routineId)).routine.nextAt).toBeGreaterThan(now);
	await service.sweep();
	expect(submit).not.toHaveBeenCalled();
});
it("reconciles persisted admission and report publication after lost responses", async () => {
	const r = await create();
	loseAdmission = true;
	await service.test(r.routineId, 1, "test");
	expect(submit).toHaveBeenCalledTimes(1);
	const publish = runtime.publishRoutineReport.bind(runtime);
	let lost = true;
	vi.spyOn(runtime, "publishRoutineReport").mockImplementation(async (...args) => {
		await publish(...args);
		if (lost) {
			lost = false;
			throw Error("Lost publication");
		}
	});
	await expect(finish()).rejects.toThrow("Lost publication");
	expect((await history(r.routineId))[0]?.published).not.toBe(true);
	await service.close();
	await runtime.close();
	await open();
	createService();
	await service.sweep();
	expect(submit).toHaveBeenCalledTimes(1);
	expect((await runtime.snapshot("bot")).items.filter((i) => i.kind === "assistant" && i.routine)).toHaveLength(1);
	expect((await history(r.routineId))[0]?.published).toBe(true);
});
it("invalidates authority before cancel, refuses deleted Bot work and keeps completed outcomes", async () => {
	let r = await create();
	const o = await service.test(r.routineId, 1, "test");
	let run = (await runtime.runsStore().list())[0]!;
	expect(await service.admissible(run)).toBe(true);
	run = { ...run, state: "running" };
	await runtime.runsStore().put(run);
	await expect(
		service.assertExecution({ botId: "bot", conversationId: await runtime.conversationKey("bot", o.channelId) }),
	).rejects.toThrow("authorized");
	await service.assertExecution({ botId: "bot", runId: run.runId, conversationId: await runtime.conversationKey("bot", o.channelId) });
	await expect(
		service.assertExecution({ botId: "bot", runId: run.runId, conversationId: await runtime.conversationKey("bot") }),
	).rejects.toThrow("authorized");
	r = await service.change({ action: "pause", routineId: r.routineId, expectedRevision: 1, requestId: "pause" });
	expect(JSON.parse(JSON.stringify(r)).schedule).toEqual(fields.schedule);
	expect(await service.admissible(run)).toBe(false);
	expect((await history(r.routineId))[0]?.state).toBe("cancelled");
	await service.test(r.routineId, r.revision, "again");
	run = (await runtime.runsStore().list()).at(-1)!;
	await runtime.runsStore().put({ ...run, state: "completed" });
	r = await service.change({ action: "delete", routineId: r.routineId, expectedRevision: r.revision, requestId: "delete" });
	expect((await history(r.routineId)).find((o) => o.occurrenceId.includes("again"))?.state).toBe("completed");
	const other = await create("other");
	await runtime.updateBot("bot", { status: "deleted" });
	now = other.nextAt;
	await service.sweep();
	expect(submit).toHaveBeenCalledTimes(2);
});
it("freezes skill references, exposes missing versions and retains only twenty outcomes without replay", async () => {
	const ref = { name: "report", revision: 1, sha256: "a".repeat(64) };
	const r = await create("skills", { skills: [ref] });
	resolveSkills.mockRejectedValueOnce(new ProtocolError("not_found", "Skill revision is unavailable"));
	await service.test(r.routineId, 1, "missing");
	expect((await history(r.routineId))[0]?.reason).toContain("Skill revision");
	for (let i = 0; i < 23; i++) {
		now += 300000;
		await service.sweep();
		await finish();
	}
	expect(await history(r.routineId)).toHaveLength(20);
	expect((await runtime.runsStore().list()).filter((r) => r.origin === "routine")).toHaveLength(20);
	const count = submit.mock.calls.length;
	await service.test(r.routineId, 1, "missing");
	await service.sweep();
	expect(submit).toHaveBeenCalledTimes(count);
	expect(submit.mock.calls.at(-1)?.[3].skills).toEqual([ref]);
});
it("enforces capacity and joins concurrent sweeps instead of queuing polling work", async () => {
	const r = await create();
	await runtime.routines().change((s) => {
		for (let i = 0; i < 49; i++) s.routines[`extra${i}`] = { ...r, routineId: `extra${i}` };
	});
	await expect(create("over")).rejects.toThrow("capacity");
	const gate = Promise.withResolvers<any>();
	resolveSkills.mockImplementation(() => gate.promise);
	now = r.nextAt;
	const a = service.sweep();
	expect(service.sweep()).toBe(a);
	expect(service.sweep()).toBe(a);
	gate.resolve([]);
	await a;
});
it("respects lifecycle gates and keeps uncertainty visible without a new occurrence", async () => {
	const r = await create();
	canRun = false;
	now = r.nextAt;
	await service.sweep();
	expect(submit).not.toHaveBeenCalled();
	await expect(service.test(r.routineId, 1, "blocked")).rejects.toThrow("Resume");
	canRun = true;
	await service.sweep();
	await finish("needs_attention");
	await service.sweep();
	expect(submit).toHaveBeenCalledTimes(1);
	expect((await history(r.routineId))[0]?.state).toBe("needs_attention");
});
it("bounds UTF-8 reports and retains confirmed artifacts on a later failure", async () => {
	const r = await create();
	await service.test(r.routineId, 1, "partial");
	const run = (await runtime.runsStore().list())[0]!;
	const snapshot = runtime.snapshot.bind(runtime);
	const artifact = {
		artifactId: "artifact_report",
		name: "partial.md",
		mediaType: "text/markdown",
		bytes: 7,
		sha256: "a".repeat(64),
		source: "result" as const,
		availability: "available" as const,
		createdAt: now,
	};
	vi.spyOn(runtime, "snapshot").mockImplementation(async (...args) => ({
		...(await snapshot(...args)),
		items: [{ kind: "tool", id: "published", tool: "artifact_publish", args: { path: "partial.md" }, status: "succeeded", artifact }],
	}));
	vi.spyOn(runtime, "submissionAnswer").mockResolvedValue("数据".repeat(9000));
	await runtime
		.runsStore()
		.put({ ...run, state: "failed", inputs: [{ requestId: run.requestIds[0]!, text: "input", submissionId: "input" }] });
	await service.sweep();
	const o = (await history(r.routineId))[0]!;
	expect(o.state).toBe("failed");
	expect(Buffer.byteLength(o.report!)).toBeLessThanOrEqual(16384);
	expect(o.report).not.toContain("�");
	expect(o.artifacts).toEqual([artifact]);
});

it("preserves an interval anchor on workflow edits and resets it only when the schedule changes", async () => {
	const r = await create();
	now += 120000;
	const edited = await service.change({
		action: "update",
		requestId: "edit",
		routineId: r.routineId,
		expectedRevision: 1,
		fields: { ...fields, name: "Revised name" },
	});
	expect(JSON.parse(JSON.stringify(edited)).schedule).toEqual(fields.schedule);
	expect(edited.anchor).toBe(r.anchor);
	expect(edited.nextAt).toBe(r.nextAt);
	const rescheduled = await service.change({
		action: "update",
		requestId: "reschedule",
		routineId: r.routineId,
		expectedRevision: 2,
		fields: { ...fields, schedule: { kind: "interval", minutes: 10 } },
	});
	expect(rescheduled.anchor).toBe(now);
	expect(rescheduled.nextAt).toBe(now + 600000);
});

async function radar() {
	await runtime.createBot({ botId: "peer", name: "International Hunter", model: SCRIPTED_MODEL, createdAt: now });
	return runtime.groups().change({ action: "create", requestId: "radar", groupId: "group_radar", expectedRevision: 0,
		fields: { name: "Competitor radar", objective: "Verify Agent changelogs", memberIds: ["bot", "peer"], leadBotId: "bot" } }, now);
}
const reportTo = { groupId: "group_radar", groupRevision: 1 };
it("requires an exact active group and member for destination confirmation", async () => {
	await expect(create("unknown", { reportTo })).rejects.toThrow("Report destination changed");
	await radar();
	await expect(create("stale-destination", { reportTo: { ...reportTo, groupRevision: 2 } })).rejects.toThrow("Report destination changed");
	await runtime.createBot({ botId: "outsider", name: "Outsider", model: SCRIPTED_MODEL, createdAt: now });
	await expect(service.change({ action: "create", botId: "outsider", requestId: "outsider", fields: { ...fields, reportTo } })).rejects.toThrow("Report destination changed");
	const r = await create("valid", { reportTo });
	expect(r.reportTo).toEqual(reportTo);
});
it("atomically publishes attributed scheduled reports once without waking peers or writing private chats", async () => {
	await radar();
	const r = await create("group-report", { reportTo });
	now = r.nextAt;
	await service.sweep();
	const o = (await history(r.routineId)).find((o) => o.state === "pending")!;
	await finish();
	await runtime.groups().publishRoutine(o.occurrenceId);
	const posts = await runtime.groups().posts(reportTo.groupId);
	expect(posts).toHaveLength(1);
	expect(posts[0]).toMatchObject({ senderId: "bot", recipientIds: [], routine: { occurrenceId: o.occurrenceId, test: false, state: "completed" } });
	expect(await runtime.groups().deliveries()).toHaveLength(0);
	expect(await runtime.groups().roots()).toHaveLength(0);
	expect((await runtime.snapshot("bot")).items.filter((i) => i.kind === "assistant" && i.routine)).toHaveLength(0);
	await service.close(); await runtime.close(); await open(); createService();
	await service.sweep();
	await runtime.groups().publishRoutine(o.occurrenceId);
	expect(await runtime.groups().posts(reportTo.groupId)).toEqual(posts);
	expect((await history(r.routineId))[0]?.published).toBe(true);
});
it("group edits withdraw pending authority atomically and re-adding a member cannot revive it", async () => {
	await radar();
	const r = await create("revocable", { reportTo });
	const o = await service.test(r.routineId, 1, "pending-group");
	const run = (await runtime.runsStore().list())[0]!;
	expect(await service.admissible(run)).toBe(true);
	await runtime.createBot({ botId: "replacement", name: "Replacement", model: SCRIPTED_MODEL, createdAt: now });
	await runtime.groups().change({ action: "update", requestId: "remove", groupId: reportTo.groupId, expectedRevision: 1,
		fields: { name: "Radar", objective: "Changed team", memberIds: ["peer", "replacement"], leadBotId: "peer" } }, now);
	expect(await service.admissible(run)).toBe(false);
	expect((await service.detail(r.routineId)).routine).toMatchObject({ enabled: false, destinationBlocked: true, revision: 2 });
	await runtime.groups().change({ action: "update", requestId: "readd", groupId: reportTo.groupId, expectedRevision: 2,
		fields: { name: "Radar", objective: "Restored team", memberIds: ["bot", "peer"], leadBotId: "bot" } }, now);
	await service.sweep();
	expect(await runtime.groups().posts(reportTo.groupId)).toHaveLength(0);
	expect((await history(r.routineId)).find((x) => x.occurrenceId === o.occurrenceId)).toMatchObject({ state: "cancelled", destinationBlocked: true, published: true });
	await expect(service.change({ action: "resume", routineId: r.routineId, requestId: "unsafe-resume", expectedRevision: 2 })).rejects.toThrow("Report destination changed");
	await service.change({ action: "update", routineId: r.routineId, requestId: "reconfirm", expectedRevision: 2,
		fields: { ...fields, reportTo: { ...reportTo, groupRevision: 3 } } });
	await service.test(r.routineId, 3, "confirmed-group");
	await finish();
	expect(await runtime.groups().posts(reportTo.groupId)).toHaveLength(1);
});
it("destination changes never redirect an old occurrence and omission restores private delivery", async () => {
	await radar();
	const r = await create("redirect", { reportTo });
	await service.test(r.routineId, 1, "old");
	const privateRoutine = await service.change({ action: "update", routineId: r.routineId, requestId: "make-private", expectedRevision: 1, fields });
	expect(privateRoutine.reportTo).toBeUndefined();
	expect(await runtime.groups().posts(reportTo.groupId)).toHaveLength(0);
	expect((await history(r.routineId))[0]?.destinationBlocked).toBe(true);
	await service.test(r.routineId, 2, "private");
	await finish();
	expect((await runtime.snapshot("bot")).items.filter((i) => i.kind === "assistant" && i.routine)).toHaveLength(1);
	expect(await runtime.groups().posts(reportTo.groupId)).toHaveLength(0);
});
it("a settled report cannot cross a concurrent group edit; earlier published reports remain", async () => {
	await radar();
	const r = await create("atomic", { reportTo });
	await service.test(r.routineId, 1, "first");
	await finish();
	const o = await service.test(r.routineId, 1, "late");
	await runtime.routines().change((s) => { s.occurrences[o.occurrenceId] = { ...s.occurrences[o.occurrenceId]!, state: "completed", report: "MUST_NOT_SHARE" }; });
	await runtime.groups().change({ action: "dissolve", requestId: "dissolve", groupId: reportTo.groupId, expectedRevision: 1 }, now);
	await runtime.groups().publishRoutine(o.occurrenceId);
	expect(await runtime.groups().posts(reportTo.groupId)).toHaveLength(1);
	expect(JSON.stringify(await runtime.groups().posts(reportTo.groupId))).not.toContain("MUST_NOT_SHARE");
	expect((await history(r.routineId)).find((x) => x.occurrenceId === o.occurrenceId)?.destinationBlocked).toBe(true);
});
it("retains twenty finished group occurrences without losing published history", async () => {
	await radar();
	const r = await create("retention-group", { reportTo });
	for (let i = 0; i < 22; i++) { now += 1000; await service.test(r.routineId, 1, `history-${i}`); await finish(); }
	expect(await history(r.routineId)).toHaveLength(20);
	expect(await runtime.groups().posts(reportTo.groupId)).toHaveLength(22);
	await service.sweep();
	expect(await runtime.groups().posts(reportTo.groupId)).toHaveLength(22);
});
