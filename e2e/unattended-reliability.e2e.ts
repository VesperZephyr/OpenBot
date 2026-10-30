/** Real desktop/Host/Executor admission; offline fixtures never touch owner data. */
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { BotRuntime } from "../packages/agent-runtime/src/index.ts";
import { scriptedModels } from "../packages/agent-runtime/src/testing.ts";
import { launchApp, type AppHarness } from "./harness.ts";
let h: AppHarness;
beforeAll(async () => {
	h = await launchApp("unattended-reliability", { env: { OPENBOT_MAX_ACTIVE_RUNS: "1" } });
});
afterAll(async () => {
	await h?.close();
});
it("publishes the renamed daily chain despite an invalid peer schedule, exposes health and recovers without duplicates", async () => {
	await h.api("settings.update", { defaultModel: { provider: "scripted", modelId: "scripted" } });
	const core = (await h.api("bots.list")).find((b: any) => b.kind === "core");
	const peer = await h.api("bots.create", { requestId: "researcher", name: "Researcher" });
	const groupFields = { name: "Radar", objective: "Daily source reports", memberIds: [core.botId, peer.botId], leadBotId: core.botId };
	const group = await h.api("groups.change", {
		action: "create",
		requestId: "group",
		groupId: "group_reliable",
		expectedRevision: 0,
		fields: groupFields,
	});
	const fields = {
		name: "Domestic",
		instructions: "Report the supplied source.",
		schedule: { kind: "interval", minutes: 60 },
		catchUpHours: 24,
		skills: [],
		reportTo: { groupId: group.groupId, groupRevision: 1 },
	};
	const source = await h.api("routines.change", { action: "create", requestId: "source", botId: core.botId, fields });
	const foreign = await h.api("routines.change", {
		action: "create",
		requestId: "foreign",
		botId: peer.botId,
		fields: { ...fields, name: "International" },
	});
	const summary = await h.api("routines.change", {
		action: "create",
		requestId: "summary",
		botId: core.botId,
		fields: {
			...fields,
			name: "Daily summary",
			reportInputs: { sources: [source, foreign].map((r) => ({ routineId: r.routineId, revision: 1 })), windowHours: 24, waitMinutes: 1 },
		},
	});
	const broken = await h.api("routines.change", {
		action: "create",
		requestId: "broken",
		botId: peer.botId,
		fields: { ...fields, name: "Unavailable schedule" },
	});
	await h.api("groups.change", {
		action: "update",
		requestId: "group-rename",
		groupId: group.groupId,
		expectedRevision: 1,
		fields: { ...groupFields, name: "Radar renamed" },
	});
	await h.page().getByRole("button", { name: "Settings", exact: true }).click();
	await h.page().getByRole("button", { name: "Routines", exact: true }).click();
	await h
		.page()
		.getByRole("button", { name: /Domestic/ })
		.click();
	await h.page().getByRole("button", { name: "Edit routine", exact: true }).click();
	await h.page().getByLabel("Routine name", { exact: true }).fill("Domestic renamed");
	await h.page().getByRole("button", { name: "Review routine", exact: true }).click();
	await h.page().getByRole("button", { name: "Confirm routine change", exact: true }).click();
	await expect.poll(async () => (await h.api("routines.get", { routineId: source.routineId })).routine.revision).toBe(2);
	expect((await h.api("routines.get", { routineId: source.routineId })).routine.executionRevision).toBe(1);
	expect((await h.api("routines.get", { routineId: summary.routineId })).routine.enabled).toBe(true);
	h.model.script(
		{ text: "Domestic source report." },
		{ text: "International source report." },
		{ text: "Daily summary: both source reports received." },
	);
	await h.relaunch(async () => {
		const runtime = await BotRuntime.open({ databasePath: join(h.dataDirectory, "openbot.sqlite"), models: scriptedModels().models });
		try {
			await runtime.routines().change((state) => {
				const due = Date.now() - 1000;
				for (const r of Object.values(state.routines)) state.routines[r.routineId] = { ...r, anchor: due - 3600000, nextAt: due };
				state.routines[broken.routineId] = {
					...state.routines[broken.routineId]!,
					schedule: { kind: "daily", time: "07:00", timezone: "Invalid/Zone" },
				};
			});
		} finally {
			await runtime.close();
		}
	});
	await h.app().evaluate(({ powerMonitor }) => powerMonitor.emit("lock-screen"));
	await expect
		.poll(async () => (await h.api("groups.snapshot", { groupId: group.groupId })).posts.filter((p: any) => p.routine).length, {
			timeout: 30000,
		})
		.toBe(3);
	expect((await h.api("lifecycle.get")).blocked).toBe(false);
	const posts = (await h.api("groups.snapshot", { groupId: group.groupId })).posts;
	expect(posts.every((p: any) => p.routine?.test === false)).toBe(true);
	expect(posts.find((p: any) => p.routine.routineId === summary.routineId).routine.inputs).toEqual({ ready: 2, total: 2 });
	expect(h.model.requests).toHaveLength(3);
	await h.page().getByRole("button", { name: "Settings", exact: true }).click();
	await h.page().getByRole("button", { name: "Routines", exact: true }).click();
	await h
		.page()
		.getByText("Scheduled work needs attention. Other tasks continue; failed tasks retry automatically.", { exact: true })
		.waitFor();
	await h.shot("01-independent-failure");
	await h.api("settings.update", { language: "zh-CN" });
	await h.page().getByText("部分定时任务需要关注。其他任务继续运行，失败任务将自动重试。", { exact: true }).waitFor();
	await h.shot("02-independent-failure-zh");
	await h.app().evaluate(({ powerMonitor }) => powerMonitor.emit("unlock-screen"));
	// Repair via the ordinary version-checked API, then observe fault recovery.
	const current = (await h.api("routines.get", { routineId: broken.routineId })).routine;
	await h.api("routines.change", {
		action: "update",
		requestId: "repair",
		routineId: broken.routineId,
		expectedRevision: current.revision,
		fields: { ...fields, name: "Repaired schedule", schedule: { kind: "interval", minutes: 120 } },
	});
	await expect.poll(async () => (await h.api("routines.list")).scheduler.faults.length, { timeout: 10000 }).toBe(0);
	await h.relaunch();
	expect((await h.api("groups.snapshot", { groupId: group.groupId })).posts).toHaveLength(3);
	expect(h.model.requests).toHaveLength(3);
	expect((await h.api("routines.list")).routines.every((r: any) => r.enabled)).toBe(true);
	await h.shot("03-recovered");
});
