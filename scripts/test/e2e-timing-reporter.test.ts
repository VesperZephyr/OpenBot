import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import type { Vitest } from "vitest/node";
import TimingReporter from "../e2e-timing-reporter.ts";
import { parseTimings, suiteCost } from "../test-timings.ts";
import { recordDurations } from "../e2e-shard.ts";
import { formatSummary } from "../ci-test-summary.ts";

it.each([false, true])("measures both file hooks and marks failed runs ineligible (failure=%s)", async (fail) => {
	const root = resolve(import.meta.dirname, "../..");
	const output = await mkdtemp(join(tmpdir(), "openbot-timings-"));
	try {
		const config = join(output, "vitest.config.mjs");
		const timingPath = join(output, "timings.json");
		const resultsPath = join(output, "results.json");
		await writeFile(config, `export default ${JSON.stringify({
			root,
			test: {
				include: ["scripts/test/fixtures/timing.fixture.ts"], maxWorkers: 1,
				reporters: ["json", [resolve(root, "scripts/e2e-timing-reporter.ts"), { outputFile: timingPath }]],
				outputFile: { json: resultsPath },
			},
		})}`);
		let succeeded = true;
		try {
			await promisify(execFile)(process.execPath, [resolve(root, "node_modules/vitest/vitest.mjs"), "run", "--config", config], {
				cwd: root, env: { ...process.env, OPENBOT_TIMING_FIXTURE_FAIL: fail ? "1" : "0" }, timeout: 30_000,
			});
		} catch { succeeded = false; }
		expect(succeeded).toBe(!fail);
		const timings = parseTimings(JSON.parse(await readFile(timingPath, "utf8")));
		const results = JSON.parse(await readFile(resultsPath, "utf8"));
		const suite = timings.suites[0]!;
		expect(timings.success).toBe(!fail);
		expect(suite.executionMs).toBeGreaterThanOrEqual(220);
		expect(suite.executionMs - (results.testResults[0].endTime - results.testResults[0].startTime)).toBeGreaterThanOrEqual(200);
		expect(suiteCost(suite)).toBeGreaterThanOrEqual(suite.executionMs);
		expect(formatSummary(results, timings, "Fixture")).toContain("Tests + hooks");
		if (fail) expect(() => recordDurations({}, [timings], [suite.file])).toThrow("successful");
		else expect(recordDurations({}, [timings], [suite.file])["timing.fixture.ts"]).toBeGreaterThanOrEqual(200);
	} finally { await rm(output, { recursive: true, force: true }); }
}, 40_000);

it("invalidates a previous successful report before execution can be interrupted", async () => {
	const root = await mkdtemp(join(tmpdir(), "openbot-timing-interruption-"));
	try {
		const output = join(root, "timings.json");
		await writeFile(output, JSON.stringify({ success: true }));
		await new TimingReporter({ outputFile: output }).onInit({ config: { root } } as Vitest);
		const report = parseTimings(JSON.parse(await readFile(output, "utf8")));
		expect(report.success).toBe(false);
		expect(() => recordDurations({}, [report], ["e2e/a.e2e.ts"])).toThrow("successful");
	} finally { await rm(root, { recursive: true, force: true }); }
});
