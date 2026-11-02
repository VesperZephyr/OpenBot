import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { TimingReport } from "../test-timings.ts";
import { describe, expect, it } from "vitest";
import { assignShards, recordDurations, selectShard } from "../e2e-shard.ts";

describe("assignShards", () => {
	it("keeps the slowest suites apart and covers every file exactly once", () => {
		const durations = { "a.e2e.ts": 60, "b.e2e.ts": 50, "c.e2e.ts": 40, "d.e2e.ts": 30, "e.e2e.ts": 20, "f.e2e.ts": 10 };
		const files = Object.keys(durations).map((name) => `e2e/${name}`);
		const shards = assignShards(files, durations, 3);
		const loads = shards.map((shard) => shard.reduce((sum, file) => sum + durations[file.slice(4) as keyof typeof durations], 0));
		expect(loads).toEqual([70, 70, 70]);
		expect(shards.flat().sort()).toEqual(files);
	});

	it("is deterministic and counts unrecorded suites as the median", () => {
		const durations = { "slow.e2e.ts": 100, "mid.e2e.ts": 20, "fast.e2e.ts": 10 };
		const files = ["e2e/slow.e2e.ts", "e2e/mid.e2e.ts", "e2e/fast.e2e.ts", "e2e/new-a.e2e.ts", "e2e/new-b.e2e.ts"];
		const shards = assignShards(files, durations, 2);
		expect(shards).toEqual(assignShards([...files].reverse(), durations, 2));
		expect(shards[0]).toEqual(["e2e/slow.e2e.ts"]);
		expect(shards[1]).toEqual(["e2e/fast.e2e.ts", "e2e/mid.e2e.ts", "e2e/new-a.e2e.ts", "e2e/new-b.e2e.ts"]);
	});

	it("rejects an invalid shard total", () => {
		expect(() => assignShards([], {}, 0)).toThrow("positive integer");
	});
});

const sample = (file: string, executionMs: number): TimingReport => ({
	version: 1, environment: { source: "ci", platform: "darwin", arch: "arm64" }, success: true,
	suites: [{ file, state: "passed", executionMs, collectionMs: 100, setupMs: 20, environmentMs: 30, prepareMs: 50 }],
});

describe("recordDurations", () => {
	it("takes the order-independent median of full costs, keeps missing suites and removes stale ones", () => {
		const reports = [sample("e2e/b.e2e.ts", 1000), sample("e2e/b.e2e.ts", 9000), sample("e2e/b.e2e.ts", 2000)];
		const previous = { "a.e2e.ts": 5000, "b.e2e.ts": 10000, "gone.e2e.ts": 1000 };
		const files = ["e2e/a.e2e.ts", "e2e/b.e2e.ts"];
		expect(recordDurations(previous, reports, files)).toEqual({ "a.e2e.ts": 5000, "b.e2e.ts": 2200 });
		expect(recordDurations(previous, [...reports].reverse(), files)).toEqual(recordDurations(previous, reports, files));
	});

	it("learns new suites and rejects failed, empty, legacy or incompatible samples", () => {
		const report = sample("e2e/a.e2e.ts", 1000);
		expect(recordDurations({}, [report], ["e2e/a.e2e.ts"])).toEqual({ "a.e2e.ts": 1200 });
		for (const bad of [{ ...report, success: false }, { ...report, suites: [] }, { testResults: [] }, { ...report, version: 2 }])
			expect(() => recordDurations({}, [bad], ["e2e/a.e2e.ts"])).toThrow();
		for (const change of [{ source: "local" }, { platform: "linux" }, { arch: "x64" }])
			expect(() => recordDurations({}, [report, { ...report, environment: { ...report.environment, ...change } }], ["e2e/a.e2e.ts"])).toThrow("environments");
		expect(() => recordDurations({}, [], [])).toThrow();
	});

	it("rejects duplicate, malformed and nonfinite suite data", () => {
		const report = sample("e2e/a.e2e.ts", 1000);
		for (const change of [{ executionMs: -1 }, { collectionMs: NaN }, { setupMs: Infinity }, { file: "../escape.ts" }, { file: "/absolute.ts" }, { file: "e2e//a.ts" }, { state: "failed" }])
			expect(() => recordDurations({}, [{ ...report, suites: [{ ...report.suites[0], ...change }] }], ["e2e/a.e2e.ts"])).toThrow();
		expect(() => recordDurations({}, [{ ...report, suites: [...report.suites, ...report.suites] }], ["e2e/a.e2e.ts"])).toThrow("Duplicate");
	});
});

it("selects every actual eligible suite exactly once, including unrecorded files", () => {
	const files = readdirSync(resolve(import.meta.dirname, "../../e2e")).filter(file => file.endsWith(".e2e.ts")).map(file => `e2e/${file}`);
	const exclude = ["e2e/history-scaling.e2e.ts"];
	const shards = [1, 2, 3].map(index => selectShard(files, {}, index, 3, exclude));
	expect(shards.flat().sort()).toEqual(files.filter(file => !exclude.includes(file)).sort());
	expect(new Set(shards.flat()).size).toBe(shards.flat().length);
	for (const bad of [0, 4, 1.5]) expect(() => selectShard(files, {}, bad, 3)).toThrow();
	expect(() => selectShard(files, {}, 1, 3, ["e2e/missing.e2e.ts"])).toThrow("exclusion");
	expect(() => selectShard([], {}, 1, 3)).toThrow("no files");
	for (const cost of [0, -1, NaN, Infinity]) expect(() => assignShards(files, { "a.e2e.ts": cost }, 3)).toThrow("weight");
	expect(() => assignShards(["e2e/a.e2e.ts", "e2e/a.e2e.ts"], {}, 3)).toThrow("Duplicate");
});

it("does not dispatch Vitest when --run selection fails", () => {
	const root = mkdtempSync(join(tmpdir(), "openbot-shard-"));
	try {
		const marker = join(root, "called");
		writeFileSync(join(root, "pnpm"), '#!/bin/sh\ntouch "$SHARD_MARKER"\n', { mode: 0o755 });
		const result = spawnSync(process.execPath, [resolve(import.meta.dirname, "../e2e-shard.ts"), "--run", "1/3", "--exclude", "e2e/missing.e2e.ts"], { env: { ...process.env, PATH: `${root}:${process.env.PATH}`, SHARD_MARKER: marker }, encoding: "utf8" });
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("Unknown or duplicate shard exclusion");
		expect(existsSync(marker)).toBe(false);
	} finally { rmSync(root, { recursive: true, force: true }); }
});
