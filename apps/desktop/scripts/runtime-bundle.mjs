import { createRequire } from "node:module";
import { copyFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const apps = join(dirname(fileURLToPath(import.meta.url)), "../..");

export async function bundleRuntime({ outdir, target = "node24" }) {
	await build({
		entryPoints: {
			host: join(apps, "local-server", "src", "main.ts"),
			maintenance: join(apps, "local-server", "src", "maintenance.ts"),
			"backup-check": join(apps, "local-executor", "src", "backup-check.ts"),
			executor: join(apps, "local-executor", "src", "main.ts"),
			"history-worker": join(apps, "..", "packages", "agent-runtime", "src", "history-worker.ts"),
   "codemode-worker": join(apps, "..", "packages", "agent-runtime", "src", "codemode-worker.ts"),
		},
		outdir,
		outExtension: { ".js": ".mjs" },
		bundle: true,
		// The UMD build passes require through a factory; esbuild cannot follow those relative imports.
		alias: {"jsonc-parser":createRequire(join(apps,"..","packages","server-core","package.json")).resolve("jsonc-parser/lib/esm/main.js")},
		platform: "node",
		format: "esm",
		target,
		// Bundled CommonJS dependencies call require() for Node built-ins, which an ES module does not define.
		banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
		// Optional native peers, each loaded inside try/catch with a pure-JS fallback: linkedom's `canvas`, ws's
		// `bufferutil` and `utf-8-validate`. The bundle must never load a native module.
		external: ["canvas", "bufferutil", "utf-8-validate"],
		plugins: [bedrockStaticImport],
		legalComments: "linked",
		logLevel: "warning",
	});
	const piRequire = createRequire(join(apps, "..", "third_party", "pi", "packages", "codemode", "package.json"));
	const wasm = piRequire.resolve("quickjs-wasi/quickjs.wasm");
	copyFileSync(wasm, join(outdir, "quickjs.wasm"));
	copyFileSync(join(dirname(wasm), "LICENSE"), join(outdir, "quickjs-LICENSE"));
}

/**
 * Pi loads the Bedrock implementation through a variable specifier so browser bundles cannot follow it into the AWS
 * SDK. A single-file bundle has no sibling file to import at runtime, so make the import static (and still lazy).
 */
const bedrockStaticImport = {
	name: "pi-bedrock-static-import",
	setup(builder) {
		builder.onLoad({ filter: /pi\/packages\/ai\/dist\/api\/bedrock-converse-stream\.lazy\.js$/ }, (args) => {
			const source = readFileSync(args.path, "utf8");
			const opaque = 'importNodeOnlyApi("./bedrock-converse-stream.ts")';
			if (!source.includes(opaque)) throw new Error(`${args.path} no longer contains ${opaque}; update runtime-bundle.mjs`);
			return { contents: source.replace(opaque, 'import("./bedrock-converse-stream.js")'), loader: "js" };
		});
	},
};

