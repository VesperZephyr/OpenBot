import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cpus, totalmem, loadavg } from "node:os";
import { launchApp, repo, type AppHarness } from "./harness.ts";
import { seedHistory } from "../packages/agent-runtime/test/history-fixture.ts";
let h: AppHarness;
const metrics: Record<string, unknown> = { node: process.version, cpu: cpus()[0]?.model, memory: totalmem(), load: loadavg() };
const poll = (fn: () => Promise<any>) => expect.poll(fn, { timeout: 60000 });
const row = (name: string) =>
	h
		.page()
		.locator(".bot-row")
		.filter({ has: h.page().getByText(name, { exact: true }) });
const p95 = (values: number[]) => values.sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]!;
beforeAll(async () => {
	const started = performance.now();
	h = await launchApp("history-scaling", {
		...(process.env.OPENBOT_HISTORY_DEBUG ? { debugPort: 9342 } : {}),
		prepare: async (run) => {
			await mkdir(join(run, "data"), { recursive: true });
			await seedHistory(join(run, "data", "openbot.sqlite"));
			metrics.seedMs = performance.now() - started;
			return { OPENBOT_HOST_ENTRY: join(repo, "e2e/fixtures/history-host.mts"), OPENBOT_HISTORY_METRICS: join(run, "worker-metrics.json") };
		},
	});
	for (let i = 0; i < 600 && (await h.api("conversations.indexStatus")).state !== "ready"; i++)
		await new Promise((resolve) => setTimeout(resolve, 100));
	expect((await h.api("conversations.indexStatus")).state).toBe("ready");
	metrics.coldRebuildAndLaunchMs = performance.now() - started - Number(metrics.seedMs);
	expect(metrics.coldRebuildAndLaunchMs).toBeLessThan(60000);
	metrics.electron = await h.app().evaluate(() => process.versions.electron);
	await h.api("settings.update", { defaultModel: { provider: "scripted", modelId: "scripted" } });
}, 120000);
afterEach(async ({ task }) => {
	if (task.result?.state === "fail") {
		await h.shot("failure");
		if (process.env.OPENBOT_HISTORY_DEBUG) await new Promise(resolve => setTimeout(resolve, 45000));
	}
});
afterAll(async () => {
	await h?.close();
	if (h) {
		metrics.worker = JSON.parse(await readFile(join(h.run, "worker-metrics.json"), "utf8").catch(() => "{}"));
		await writeFile(join(h.run, "performance.json"), JSON.stringify(metrics, null, 2));
	}
});
it("bounds windows and mounted rows while measuring warm switching and corpus searches", async () => {
	const direct = await h.api("conversations.window", { conversationKey: "bot:history_0", position: { kind: "latest" } });
	expect(direct.status).toBe("ready");
	expect(direct.window.rows.length).toBeLessThanOrEqual(100);
	expect(Buffer.byteLength(JSON.stringify(direct))).toBeLessThanOrEqual(512 * 1024);
	expect((await h.api("conversations.snapshot", { botId: "history_0", history: "omit" })).items).toEqual([]);
	const sizes = [];
	for (const name of ["History 1", "History 0"]) {
		await row(name).click();
		await h.nextFrame();
		const cache = JSON.parse((await h.page().locator("[data-history-cache]").first().getAttribute("data-history-cache"))!);
		const mounted = await h.page().locator("[data-history-row]").count();
		expect(cache.rows).toBeLessThanOrEqual(300);
		expect(mounted).toBeLessThanOrEqual(80);
		sizes.push({ name, mounted, cache });
	}
	metrics.retainedSizeComparison = sizes;
	const switchTimes: number[] = [],
		searchTimes: number[] = [];
	for (let i = 0; i < 35; i++) {
		const start = performance.now();
		await row(i % 2 ? "History 0" : "History group").click();
		await h.page().locator("[data-history-row]").first().waitFor();
		await h.nextFrame();
		if (i >= 5) switchTimes.push(performance.now() - start);
		expect(await h.page().locator("[data-history-row]").count()).toBeLessThanOrEqual(80);
		const at = performance.now();
		const result = await h.api("conversations.search", { query: i % 2 ? "NO_MATCH_LONG_HISTORY" : "星图" });
		if (i >= 5) searchTimes.push(performance.now() - at);
		if (i % 2) expect(result.items).toEqual([]);
	}
	const cache = JSON.parse((await h.page().locator("[data-history-cache]").first().getAttribute("data-history-cache"))!);
	metrics.cache = cache;
	expect(cache.conversations).toBeLessThanOrEqual(3);
	expect(cache.windows).toBeLessThanOrEqual(3);
	expect(cache.rows).toBeLessThanOrEqual(300);
	expect(cache.bytes).toBeLessThanOrEqual(8 * 1024 * 1024);
	metrics.renderer = await h
		.page()
		.evaluate(() => ({ heap: (performance as any).memory?.usedJSHeapSize, dom: document.querySelectorAll("*").length }));
	metrics.rendererProcesses = await h.app().evaluate(({ app }) =>
		app
			.getAppMetrics()
			.filter((process) => process.type === "Tab")
			.map((process) => ({
				workingSetBytes: process.memory.workingSetSize * 1024,
				peakWorkingSetBytes: process.memory.peakWorkingSetSize * 1024,
			})),
	);
	const operation = JSON.parse(await readFile(join(h.run, "worker-metrics.json"), "utf8"));
	expect(operation.maxPiBatch).toBeLessThanOrEqual(256);
	expect(operation.maxBatchBytes).toBeLessThanOrEqual(512 * 1024);
	expect(operation.maxBatchRecords).toBeLessThanOrEqual(256);
	expect(operation.maxInFlightWrites).toBeLessThanOrEqual(2);
	expect(new Set(operation.windowEntryReads.slice(-30)).size).toBe(1);
	metrics.switchP95 = p95(switchTimes);
	metrics.searchP95 = p95(searchTimes);
	expect(metrics.switchP95).toBeLessThanOrEqual(500);
	expect(metrics.searchP95).toBeLessThanOrEqual(1000);
	await h.shot("01-long-history-group");
}, 120000);
it("loads older pages, preserves an anchor through resize/theme, and jumps exactly without losing the draft", async () => {
	await row("History 0").click();
	await h.page().locator(".compose-area textarea").fill("Keep this draft 星图");
	await h.page().keyboard.press("Meta+k");
	await h.page().getByRole("searchbox").fill("Record 517:");
	await poll(() => h.page().locator(".search-result").count()).toBe(30);
	await h.page().locator(".search-result").filter({ hasText: "History 0" }).first().click();
	await h.page().locator(".search-target").waitFor();
	await h.nextFrame();
	const target = await h.page().locator(".search-target").getAttribute("data-history-row");
	expect(target).toBeTruthy();
	const offset = () =>
		h
			.page()
			.locator(".search-target")
			.evaluate((e) => e.getBoundingClientRect().top - e.closest(".timeline-scroll")!.getBoundingClientRect().top);
	const before = await offset();
	await h.page().setViewportSize({ width: 1050, height: 760 });
	await h.page().evaluate(() => {
		document.documentElement.dataset.theme = "dark";
	});
	await h.nextFrame();
	expect(Math.abs((await offset()) - before)).toBeLessThanOrEqual(4);
	await h.shot("02-historical-anchor-dark");
	await h.page().getByRole("button", { name: "Load earlier messages", exact: true }).click();
	await h.nextFrame();
	expect(await h.page().locator("[data-history-row]").count()).toBeLessThanOrEqual(80);
	for (let i = 0; i < 3; i++) {
		const earlier = h.page().getByRole("button", { name: "Load earlier messages", exact: true });
		if (!(await earlier.count())) break;
		await earlier.click();
		await h.nextFrame();
		const cache = JSON.parse((await h.page().locator("[data-history-cache]").first().getAttribute("data-history-cache"))!);
		expect(cache.windows).toBeLessThanOrEqual(3);
		expect(cache.rows).toBeLessThanOrEqual(300);
		expect(await h.page().locator("[data-history-row]").count()).toBeLessThanOrEqual(80);
	}
	await h
		.page()
		.getByRole("button", { name: /Jump to latest/ })
		.click();
	await h.nextFrame();
	expect(await h.page().locator(".compose-area textarea").inputValue()).toBe("Keep this draft 星图");
	await h.page().getByRole("searchbox").fill("");
	await h.page().evaluate(() => {
		document.documentElement.dataset.theme = "light";
	});
});
it("streams bounded detail parts from a two MiB Unicode row and keeps controls live during rebuild", async () => {
	const matches = await h.api("conversations.search", { query: "LARGE_END_NEEDLE" });
	const hit = matches.items.find((m: any) => m.conversationKey === "bot:history_0");
	expect(hit).toBeTruthy();
	const found = await h.api("conversations.window", {
		conversationKey: hit.conversationKey,
		position: { kind: "around", rowId: hit.messageId },
	});
	const large = found.window.rows.find((r: any) => r.id === hit.messageId);
	expect(large.content.kind).toBe("large");
	expect(Buffer.byteLength(large.content.preview)).toBeLessThanOrEqual(8192);
	let part = 0,
		bytes = 0,
		tail = "";
	while (part !== undefined) {
		const detail = await h.api("conversations.detail", { conversationKey: hit.conversationKey, detail: large.content.detail, part });
		expect(Buffer.byteLength(detail.text)).toBeLessThanOrEqual(32768);
		expect(detail.text).not.toMatch(/[\uD800-\uDBFF]$/);
		bytes += Buffer.byteLength(detail.text);
		tail = (tail + detail.text).slice(-300);
		part = detail.nextPart;
	}
	expect(bytes).toBeGreaterThan(2 * 1024 * 1024);
	expect(tail).toContain("LARGE_END_NEEDLE");
	await h.page().keyboard.press("Meta+k");
	await h.page().getByRole("searchbox").fill("LARGE_END_NEEDLE");
	await h.page().locator(".search-result").first().click();
	const reader = h.page().locator(".large-history");
	await reader.getByRole("button", { name: "Read full message", exact: true }).click();
	for (let i = 0; i < 4; i++) {
		const next = reader.getByRole("button", { name: "Next part", exact: true });
		await expect.poll(() => next.isEnabled()).toBe(true);
		await next.click();
		await expect.poll(() => next.isEnabled()).toBe(true);
	}
	expect(Buffer.byteLength((await reader.locator("pre").textContent())!)).toBeLessThanOrEqual(3 * 32768);
	await reader.getByRole("button", { name: "Previous part", exact: true }).click();
	await reader.getByRole("button", { name: "Copy displayed parts", exact: true }).click();
	await h.shot("03-large-message-parts");
	await h
		.page()
		.getByRole("button", { name: /Jump to latest/ })
		.click();
	await h.page().getByRole("searchbox").fill("");

	await h.api("conversations.indexRetry");
	const controls: number[] = [];
	for (let i = 0; i < 35; i++) {
		const start = performance.now();
		await h.api("conversations.snapshot", { botId: "history_0", history: "omit" });
		if (i >= 5) controls.push(performance.now() - start);
	}
	metrics.controlsP95 = p95(controls);
	expect(metrics.controlsP95).toBeLessThanOrEqual(250);
	h.model.script({ text: "Controls remained available during indexing." });
	await h.send("Reply during the rebuild");
	await poll(async () => (await h.api("bots.list")).find((b: any) => b.botId === "history_0").lastRun?.state).toBe("completed");
	await poll(async () => (await h.api("conversations.indexStatus")).state).toBe("ready");
	const jump = h.page().getByRole("button", { name: /Jump to latest/ });
	if (await jump.count()) await jump.click();
	await h.page().getByText("Controls remained available during indexing.", { exact: true }).waitFor();
	await h.shot("03-rebuilt-latest");
}, 120000);

it("keeps the latest response visible after search jumps and width changes", async () => {
	const timeline = h.page().locator(".timeline-scroll");
	for (const width of [1050, 900, 1200, 900, 1050, 1200]) {
		await h.page().setViewportSize({ width, height: 760 });
		await h.page().getByRole("searchbox").fill("Record 517:");
		await h.page().locator(".search-result").filter({ hasText: "History 0" }).first().click();
		await h.page().locator(".search-target").waitFor();
		await h.page().getByRole("button", { name: /Jump to latest/ }).click();
		await h.page().getByText("Controls remained available during indexing.", { exact: true }).waitFor({ timeout: 5000 });
		await expect.poll(() => timeline.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop), { timeout: 5000 }).toBeLessThan(3);
	}
	await h.shot("04-latest-after-resize");
	if (process.env.OPENBOT_HISTORY_DEBUG) await new Promise(resolve => setTimeout(resolve, 45000));
});
