/** Keep slow desktop suites visible in each shard's GitHub job summary. */
import { readFile, appendFile } from "node:fs/promises";
import { basename } from "node:path";
const [path, label = "Desktop tests"] = process.argv.slice(2);
const report = JSON.parse(await readFile(path, "utf8"));
const suites = [...report.testResults].sort((a, b) => (b.endTime - b.startTime) - (a.endTime - a.startTime));
const lines = [
	`## ${label}`,
	"",
	`${report.numPassedTests} passed · ${report.numFailedTests} failed · ${report.numPendingTests} skipped · ${report.numTotalTests} total`,
	"",
	"Reported suite durations (setup and build are separate job steps):",
	"",
	"| Suite | Seconds | Result |",
	"| --- | ---: | --- |",
	...suites.slice(0, 10).map(s => `| ${basename(s.name)} | ${Math.max(0, (s.endTime - s.startTime) / 1000).toFixed(1)} | ${s.status} |`),
	"",
];
const summary = lines.join("\n");
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
