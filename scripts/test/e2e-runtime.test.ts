import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runtimeEnvironment } from "../../e2e/runtime.ts";

let directory: string;
const assets = ["host.mjs", "executor.mjs", "history-worker.mjs", "codemode-worker.mjs", "quickjs.wasm"];
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "openbot-runtime-selection-")); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

it("source mode works without a generated runtime and leaves explicit entries unchanged", () => {
	expect(runtimeEnvironment("source", join(directory, "absent"), {})).toEqual({});
});
it("rejects unknown modes instead of silently changing the test path", () => {
	expect(() => runtimeEnvironment("bundeld", directory, {})).toThrow("source or bundled");
});
it("selects built entries only when their dependent workers and WASM exist", () => {
	for (const file of assets) writeFileSync(join(directory, file), "fixture");
	expect(runtimeEnvironment("bundled", directory, {})).toEqual({
		OPENBOT_HOST_ENTRY: join(directory, "host.mjs"),
		OPENBOT_EXECUTOR_ENTRY: join(directory, "executor.mjs"),
	});
});
it.each(assets)("fails closed when %s is missing", (missing) => {
	for (const file of assets.filter((file) => file !== missing)) writeFileSync(join(directory, file), "fixture");
	expect(() => runtimeEnvironment("bundled", directory, {})).toThrow(`Missing E2E runtime ${missing}; run pnpm run build:e2e-runtime`);
});
it("preserves a patched Host fixture without requiring or selecting an unrelated Host bundle", () => {
	writeFileSync(join(directory, "executor.mjs"), "fixture");
	const overrides = { OPENBOT_HOST_ENTRY: "fixtures/history-host.mts" };
	expect({ ...overrides, ...runtimeEnvironment("bundled", directory, overrides) }).toEqual({
		...overrides, OPENBOT_EXECUTOR_ENTRY: join(directory, "executor.mjs"),
	});
});
it("preserves explicit Host and Executor entries without needing default artifacts", () => {
	const overrides = { OPENBOT_HOST_ENTRY: "custom-host.mts", OPENBOT_EXECUTOR_ENTRY: "custom-executor.mts" };
	expect(runtimeEnvironment("bundled", directory, overrides)).toEqual({});
});
