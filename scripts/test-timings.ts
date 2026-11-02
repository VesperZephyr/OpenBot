export const timingComponents = ["executionMs", "collectionMs", "setupMs", "environmentMs", "prepareMs"] as const;
export type SuiteTiming = Record<(typeof timingComponents)[number], number> & {
	file: string;
	state: string;
};
export type TimingReport = {
	version: 1;
	environment: { source: "ci" | "local"; platform: string; arch: string };
	success: boolean;
	suites: SuiteTiming[];
};

function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a timing report object");
	return value as Record<string, unknown>;
}

export function parseTimings(value: unknown): TimingReport {
	const report = object(value);
	if (report.version !== 1) throw new Error("Expected timing format version 1; use timings.json, not Vitest results.json");
	const environment = object(report.environment);
	if (typeof environment.source !== "string" || !["ci", "local"].includes(environment.source) || typeof environment.platform !== "string" || !environment.platform || typeof environment.arch !== "string" || !environment.arch)
		throw new Error("Invalid timing environment");
	if (typeof report.success !== "boolean" || !Array.isArray(report.suites)) throw new Error("Invalid timing report result");
	const seen = new Set<string>();
	for (const value of report.suites) {
		const suite = object(value);
		if (typeof suite.file !== "string" || !suite.file || suite.file.includes("\\") || suite.file.startsWith("/") || suite.file.split("/").some(part => !part || part === "." || part === "..") || /^[A-Za-z]:/.test(suite.file))
			throw new Error("Timing paths must be repository-relative");
		if (seen.has(suite.file)) throw new Error(`Duplicate suite timing: ${suite.file}`);
		seen.add(suite.file);
		if (typeof suite.state !== "string" || !["passed", "failed", "skipped", "pending", "queued"].includes(suite.state)) throw new Error(`Invalid suite state: ${suite.file}`);
		for (const key of timingComponents)
			if (typeof suite[key] !== "number" || !Number.isFinite(suite[key]) || suite[key] < 0) throw new Error(`Invalid ${key}: ${suite.file}`);
		if (!Number.isFinite(timingComponents.reduce((sum, key) => sum + (suite[key] as number), 0))) throw new Error(`Timing cost overflow: ${suite.file}`);
	}
	return value as TimingReport;
}

export function suiteCost(suite: SuiteTiming): number {
	return timingComponents.reduce((sum, key) => sum + suite[key], 0);
}

export function median(values: readonly number[]): number {
	if (!values.length) throw new Error("Cannot take the median of no samples");
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
