import { defineConfig } from "vitest/config";

// End-to-end suite: drives the built Electron app. Run with `pnpm run e2e`, which builds the desktop app first.
export default defineConfig({
	test: {
		env: { OPENBOT_E2E_RUNTIME: process.env.OPENBOT_E2E_RUNTIME ?? "bundled" },
		globalSetup: ["./e2e/runtime-evidence-setup.ts"],
		include: ["e2e/**/*.e2e.ts"],
		testTimeout: 60_000,
		hookTimeout: 90_000,
		// Each file owns its data directory, ephemeral ports and Keychain service.
		// Cases within a file share state and remain sequential.
		fileParallelism: process.env.OPENBOT_E2E_HEADED !== "1",
		maxWorkers: process.env.OPENBOT_E2E_HEADED === "1" ? 1 : 2,
		reporters: ["default", "json", "./scripts/e2e-timing-reporter.ts"],
		outputFile: { json: "e2e/.run/results.json" },
	},
});
