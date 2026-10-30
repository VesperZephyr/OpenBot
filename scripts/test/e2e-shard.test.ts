import { describe, expect, it } from "vitest";
import { assignShards, recordDurations } from "../e2e-shard.ts";

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

describe("recordDurations", () => {
	it("updates measured suites, keeps the rest and drops deleted ones", () => {
		const report = { testResults: [{ name: "/repo/e2e/b.e2e.ts", startTime: 1_000, endTime: 13_449 }] };
		expect(recordDurations({ "a.e2e.ts": 5_000, "b.e2e.ts": 9_000, "gone.e2e.ts": 1_000 }, [report], ["e2e/a.e2e.ts", "e2e/b.e2e.ts"])).toEqual({
			"a.e2e.ts": 5_000,
			"b.e2e.ts": 12_400,
		});
	});
});
