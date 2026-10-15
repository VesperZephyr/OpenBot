import { defineConfig } from "vitest/config";

// Product tests only. Vendored Pi packages keep their own Vitest configs and run
// from their package directories.
export default defineConfig({
	test: {
		environment: "node",
		include: ["apps/*/test/**/*.test.ts", "packages/*/test/**/*.test.ts"],
	},
});
