import { readFile, appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTimings, suiteCost, type TimingReport } from "./test-timings.ts";

type Counts = { numPassedTests: number; numFailedTests: number; numPendingTests: number; numTotalTests: number };
export function formatSummary(report: Counts, timings: TimingReport, label: string): string {
	const suites = [...timings.suites].sort((a, b) => suiteCost(b) - suiteCost(a));
	return [
		`## ${label}`, "",
		`${report.numPassedTests} passed · ${report.numFailedTests} failed · ${report.numPendingTests} skipped · ${report.numTotalTests} total`, "",
		`Timing sample: ${timings.success ? "successful" : "unsuccessful; not eligible for shard weights"}.`, "",
		"Complete file costs include tests, file hooks, collection and worker setup. Parallel costs do not add up to job wall time; CI installation and build are separate steps.", "",
		"| Suite | Total seconds | Tests + hooks | Collection | Worker setup | Result |",
		"| --- | ---: | ---: | ---: | ---: | --- |",
		...suites.slice(0, 10).map(s => `| ${s.file} | ${(suiteCost(s) / 1000).toFixed(1)} | ${(s.executionMs / 1000).toFixed(1)} | ${(s.collectionMs / 1000).toFixed(1)} | ${((s.setupMs + s.environmentMs + s.prepareMs) / 1000).toFixed(1)} | ${s.state} |`), "",
	].join("\n");
}

async function main(): Promise<void> {
	const [resultsPath, timingsPath, label = "Desktop tests"] = process.argv.slice(2);
	if (!resultsPath || !timingsPath) throw new Error("Pass results.json and timings.json");
	let summary: string;
	try {
		const results = JSON.parse(await readFile(resultsPath, "utf8")) as Counts;
		const timings = parseTimings(JSON.parse(await readFile(timingsPath, "utf8")));
		summary = formatSummary(results, timings, label);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		summary = `## ${label}\n\nTest reports are unavailable; setup or execution did not finish reporting. No timing sample is inferred.\n`;
	}
	console.log(summary);
	if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
