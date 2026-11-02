/**
 * Duration-aware e2e shards. `vitest --shard` splits by file, which clustered the slowest suites into one CI shard;
 * this assigns files longest-first to the least-loaded shard using `e2e/durations.json`.
 *
 *   node scripts/e2e-shard.ts 2/3 [--exclude e2e/a.e2e.ts ...]   print shard 2's files, one per line
 *   node scripts/e2e-shard.ts --record e2e/.run/timings.json ...  refresh durations from complete timing reports
 *
 * Files without a recorded duration count as the median, so new suites are spread out until they are recorded.
 */
import { spawnSync } from "node:child_process";
import { median, parseTimings, suiteCost } from "./test-timings.ts";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Durations = Readonly<Record<string, number>>;

export function assignShards(files: readonly string[], durations: Durations, total: number): string[][] {
	if (!Number.isInteger(total) || total < 1) throw new Error(`Shard total must be a positive integer, got ${total}`);
	if (new Set(files).size !== files.length || new Set(files.map(file => basename(file))).size !== files.length) throw new Error("Duplicate suite path or basename");
	for (const [file, cost] of Object.entries(durations))
		if (!Number.isFinite(cost) || cost <= 0) throw new Error(`Invalid shard weight: ${file}`);
	const known = Object.values(durations);
	const fallback = known.length ? median(known) : 1;
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

export function recordDurations(previous: Durations, inputs: readonly unknown[], existing: readonly string[]): Record<string, number> {
	if (!inputs.length) throw new Error("Pass at least one complete timing report");
	assignShards(existing, previous, 1);
	const reports = inputs.map(parseTimings);
	const identity = (report: typeof reports[number]) => [report.environment.source, report.environment.platform, report.environment.arch].join("/");
	if (reports.some(report => identity(report) !== identity(reports[0]!))) throw new Error("Cannot mix timing environments");
	const next: Record<string, number> = {};
	const paths = new Set(existing);
	const names = new Set(existing.map(file => basename(file)));
	for (const [name, ms] of Object.entries(previous)) if (names.has(name)) next[name] = ms;
	const samples = new Map<string, number[]>();
	for (const report of reports) {
		if (!report.success || !report.suites.length || report.suites.some(suite => suite.state !== "passed")) throw new Error("Only complete successful runs can train shard weights");
		for (const suite of report.suites) {
			if (!paths.has(suite.file)) continue;
			const name = basename(suite.file);
			const costs = samples.get(name) ?? [];
			costs.push(suiteCost(suite));
			samples.set(name, costs);
		}
	}
	if (!samples.size) throw new Error("Timing reports contain no existing e2e suites");
	for (const [name, costs] of samples) next[name] = Math.max(100, Math.round(median(costs) / 100) * 100);
	return Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
}

export function selectShard(files: readonly string[], durations: Durations, index: number, total: number, excluded: readonly string[] = []): string[] {
	if (!Number.isInteger(index) || index < 1 || index > total) throw new Error(`Shard ${index} is outside 1..${total}`);
	if (new Set(excluded).size !== excluded.length || excluded.some(file => !files.includes(file))) throw new Error("Unknown or duplicate shard exclusion");
	const shard = assignShards(files.filter(file => !excluded.includes(file)), durations, total)[index - 1]!;
	if (!shard.length) throw new Error(`Shard ${index}/${total} has no files`);
	return shard;
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
		const reports = args.slice(1).map((path) => JSON.parse(readFileSync(path, "utf8")));
		if (!reports.length) throw new Error("Pass at least one complete timing report");
		writeFileSync(durationsFile, `${JSON.stringify(recordDurations(durations, reports, files), null, "\t")}\n`);
		return;
	}
	const run = args[0] === "--run";
	if (run) args = args.slice(1);
	const match = /^(\d+)\/(\d+)$/.exec(args[0] ?? "");
	if (!match) throw new Error("Usage: node scripts/e2e-shard.ts [--run] <index>/<total> [--exclude <file> ...]");
	const [index, total] = [Number(match[1]), Number(match[2])];
	if (index < 1 || index > total) throw new Error(`Shard ${index} is outside 1..${total}`);
	const excluded: string[] = [];
	for (let i = 1; i < args.length; i++) {
		if (args[i] !== "--exclude" || !args[i + 1]) throw new Error(`Unexpected argument ${args[i]}`);
		excluded.push(args[++i]!);
	}
	const shard = selectShard(files, durations, index, total, excluded);
	if (run) {
		const result = spawnSync("pnpm", ["exec", "vitest", "run", "--config", "e2e/vitest.config.ts", ...shard], { cwd: repo, stdio: "inherit" });
		if (result.error) throw result.error;
		process.exitCode = result.status ?? 1;
	} else console.log(shard.join("\n"));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
