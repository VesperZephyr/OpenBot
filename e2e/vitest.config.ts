import { defineConfig } from "vitest/config";

// End-to-end suite: drives the built Electron app. Run with `pnpm run e2e`, which builds the desktop app first.
export default defineConfig({
	test: {
		include: ["e2e/**/*.e2e.ts"],
		testTimeout: 60_000,
		hookTimeout: 90_000,
		fileParallelism: false,
	},
});
