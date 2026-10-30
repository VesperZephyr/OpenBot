/**
 * Duration-aware e2e shards. `vitest --shard` splits by file, which clustered the slowest suites into one CI shard;
 * this assigns files longest-first to the least-loaded shard using `e2e/durations.json`.
 *
 *   node scripts/e2e-shard.ts 2/3 [--exclude e2e/a.e2e.ts ...]   print shard 2's files, one per line
 *   node scripts/e2e-shard.ts --record e2e/.run/results.json ...  refresh durations from Vitest JSON reports
 *
 * Files without a recorded duration count as the median, so new suites are spread out until they are recorded.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Durations = Readonly<Record<string, number>>;

export function assignShards(files: readonly string[], durations: Durations, total: number): string[][] {
	if (!Number.isInteger(total) || total < 1) throw new Error(`Shard total must be a positive integer, got ${total}`);
	const known = Object.values(durations).sort((a, b) => a - b);
	const fallback = known.length ? known[Math.floor(known.length / 2)]! : 1;
	const cost = (file: string) => durations[basename(file)] ?? fallback;
	const ordered = [...files].sort((a, b) => cost(b) - cost(a) || a.localeCompare(b));
	const shards = Array.from({ length: total }, () => ({ files: [] as string[], load: 0 }));
	for (const file of ordered) {
		const lightest = shards.reduce((best, shard) => (shard.load < best.load ? shard : best));
		lightest.files.push(file);
		lightest.load += cost(file);
	}
	return shards.map((shard) => shard.files.sort());
}

type VitestReport = { testResults: { name: string; startTime: number; endTime: number }[] };

/** Merge measured suite durations, rounded to 100 ms, keeping only suites that still exist. */
export function recordDurations(previous: Durations, reports: readonly VitestReport[], existing: readonly string[]): Record<string, number> {
	const next: Record<string, number> = {};
	const names = new Set(existing.map((file) => basename(file)));
	for (const [name, ms] of Object.entries(previous)) if (names.has(name)) next[name] = ms;
	for (const report of reports)
		for (const suite of report.testResults) {
			const name = basename(suite.name);
			if (names.has(name)) next[name] = Math.max(100, Math.round((suite.endTime - suite.startTime) / 100) * 100);
		}
	return Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
}

function main(args: string[]): void {
	const repo = resolve(import.meta.dirname, "..");
	const e2e = join(repo, "e2e");
	const durationsFile = join(e2e, "durations.json");
	const files = readdirSync(e2e, { recursive: true, encoding: "utf8" })
		.filter((file) => file.endsWith(".e2e.ts") && !file.split(/[\\/]/).includes(".run"))
		.map((file) => relative(repo, join(e2e, file)).split("\\").join("/"));
	const durations: Durations = JSON.parse(readFileSync(durationsFile, "utf8"));

	if (args[0] === "--record") {
		const reports = args.slice(1).map((path) => JSON.parse(readFileSync(path, "utf8")) as VitestReport);
		if (!reports.length) throw new Error("Pass at least one Vitest JSON report");
		writeFileSync(durationsFile, `${JSON.stringify(recordDurations(durations, reports, files), null, "\t")}\n`);
		return;
	}
	const match = /^(\d+)\/(\d+)$/.exec(args[0] ?? "");
	if (!match) throw new Error("Usage: node scripts/e2e-shard.ts <index>/<total> [--exclude <file> ...]");
	const [index, total] = [Number(match[1]), Number(match[2])];
	if (index < 1 || index > total) throw new Error(`Shard ${index} is outside 1..${total}`);
	const excluded = new Set<string>();
	for (let i = 1; i < args.length; i++) {
		if (args[i] !== "--exclude" || !args[i + 1]) throw new Error(`Unexpected argument ${args[i]}`);
		excluded.add(args[++i]!);
	}
	const shard = assignShards(files.filter((file) => !excluded.has(file)), durations, total)[index - 1]!;
	if (!shard.length) throw new Error(`Shard ${index}/${total} has no files`);
	console.log(shard.join("\n"));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
