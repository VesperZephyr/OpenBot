import { readerNotices } from "./scripts/reader-notices.mjs";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
	main: {
		// `@openbot/protocol` is TypeScript source, so bundle it instead of leaving it external.
		plugins: [externalizeDepsPlugin({ exclude: ["@openbot/protocol"] })],
		build: { rollupOptions: { input: resolve(__dirname, "src/main/index.ts") } },
	},
	preload: {
		plugins: [externalizeDepsPlugin({ exclude: ["@openbot/protocol"] })],
		build: {
			rollupOptions: {
				input: resolve(__dirname, "src/preload/index.ts"),
				// Sandboxed preloads must be a single CommonJS file.
				output: { format: "cjs", entryFileNames: "[name].cjs" },
			},
		},
	},
	renderer: {
		root: resolve(__dirname, "src/renderer"),
		plugins: [
			react(),
			viteStaticCopy({
				targets: [
                    ...readerNotices(resolve(__dirname,"node_modules")),
					...["cmaps", "standard_fonts", "wasm", "iccs"].map((directory) => ({
						src: resolve(__dirname, `node_modules/pdfjs-dist/${directory}/*`),
						dest: `pdfjs/${directory}`,
						rename: { stripBase: true as const },
					})),
					{ src: resolve(__dirname, "node_modules/pdfjs-dist/LICENSE"), dest: "pdfjs", rename: { stripBase: true } },
				],
			}),
		],
		build: { rollupOptions: { input: resolve(__dirname, "src/renderer/index.html") } },
	},
});
