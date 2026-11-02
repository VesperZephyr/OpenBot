import { statSync } from "node:fs";
import { join } from "node:path";

export function runtimeEnvironment(
	mode: string,
	directory: string,
	overrides: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
	if (mode === "source") return {};
	if (mode !== "bundled") throw Error("OPENBOT_E2E_RUNTIME must be source or bundled");
	const selected: Record<string, string> = {};
	const required: string[] = [];
	if (overrides.OPENBOT_HOST_ENTRY === undefined) {
		selected.OPENBOT_HOST_ENTRY = join(directory, "host.mjs");
		required.push("host.mjs", "history-worker.mjs", "codemode-worker.mjs", "quickjs.wasm");
	}
	if (overrides.OPENBOT_EXECUTOR_ENTRY === undefined) {
		selected.OPENBOT_EXECUTOR_ENTRY = join(directory, "executor.mjs");
		required.push("executor.mjs");
	}
	for (const file of required) {
		if (!statSync(join(directory, file), { throwIfNoEntry: false })?.isFile()) {
			throw Error(`Missing E2E runtime ${file}; run pnpm run build:e2e-runtime before E2E tests`);
		}
	}
	return selected;
}
