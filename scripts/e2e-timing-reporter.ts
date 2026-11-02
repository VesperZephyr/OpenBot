import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import type { TestModule, Vitest } from "vitest/node";
import type { Reporter } from "vitest/reporters";
import { parseTimings, type TimingReport } from "./test-timings.ts";

export default class TimingReporter implements Reporter {
	private root = process.cwd();
	private outputFile: string;

	constructor(options: { outputFile?: string } = {}) {
		this.outputFile = options.outputFile ?? "e2e/.run/timings.json";
	}

	async onInit(ctx: Vitest): Promise<void> {
		this.root = ctx.config.root;
		const output = resolve(this.root, this.outputFile);
		await mkdir(dirname(output), { recursive: true });
		// A hard process exit must not leave a previous successful sample eligible for reuse.
		await writeFile(output, `${JSON.stringify({ version: 1, environment: { source: process.env.CI ? "ci" : "local", platform: process.platform, arch: process.arch }, success: false, suites: [] })}\n`);
	}

	async onTestRunEnd(modules: ReadonlyArray<TestModule>, errors: readonly unknown[], reason: string): Promise<void> {
		const report: TimingReport = {
			version: 1,
			environment: { source: process.env.CI ? "ci" : "local", platform: process.platform, arch: process.arch },
			success: reason === "passed" && errors.length === 0 && modules.length > 0 && modules.every(module => module.state() === "passed"),
			suites: modules.map(module => {
				const diagnostic = module.diagnostic();
				return {
					file: relative(this.root, module.moduleId).split("\\").join("/"),
					state: module.state(),
					// JSON test-case timestamps omit beforeAll/afterAll; module duration includes both.
					executionMs: diagnostic.duration,
					collectionMs: diagnostic.collectDuration,
					setupMs: diagnostic.setupDuration,
					environmentMs: diagnostic.environmentSetupDuration,
					prepareMs: diagnostic.prepareDuration,
				};
			}).sort((a, b) => a.file.localeCompare(b.file)),
		};
		parseTimings(report);
		const output = resolve(this.root, this.outputFile);
		await mkdir(dirname(output), { recursive: true });
		await writeFile(output, `${JSON.stringify(report, null, "\t")}\n`);
	}
}
