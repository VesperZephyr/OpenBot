#!/usr/bin/env node
// Stages what the packaged app runs outside app.asar (architecture §3) into out/runtime/, which electron-builder copies
// to Contents/Resources:
//   node           pinned official Node binary, checksum-verified (cached under .cache/node/)
//   node-LICENSE   its license
//   host/host.mjs, host/executor.mjs   the Host Runtime and local executor, each bundled into one ESM file
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const NODE_VERSION = "24.22.0";
const NODE_ARCH = "darwin-arm64";
// From https://nodejs.org/dist/v24.22.0/SHASUMS256.txt
const NODE_SHA256 = "6a9724d9b50a5f22b4816cded441b5a8d9ddae546191a5e5b7efa5a5e2ee26d5";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "..");
const apps = join(desktop, "..");
const stage = join(desktop, "out", "runtime");

async function bundleRuntime() {
	await build({
		entryPoints: {
			host: join(apps, "local-server", "src", "main.ts"),
			executor: join(apps, "local-executor", "src", "main.ts"),
		},
		outdir: join(stage, "host"),
		outExtension: { ".js": ".mjs" },
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node24",
		// Bundled CommonJS dependencies call require() for Node built-ins, which an ES module does not define.
		banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
		// Optional native peers, each loaded inside try/catch with a pure-JS fallback: linkedom's `canvas`, ws's
		// `bufferutil` and `utf-8-validate`. The bundle must never load a native module.
		external: ["canvas", "bufferutil", "utf-8-validate"],
		plugins: [bedrockStaticImport],
		legalComments: "linked",
		logLevel: "warning",
	});
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
			if (!source.includes(opaque)) throw new Error(`${args.path} no longer contains ${opaque}; update stage-runtime.mjs`);
			return { contents: source.replace(opaque, 'import("./bedrock-converse-stream.js")'), loader: "js" };
		});
	},
};

function stageNode() {
	const name = `node-v${NODE_VERSION}-${NODE_ARCH}`;
	const cache = join(desktop, ".cache", "node", name);
	if (!existsSync(join(cache, "node"))) {
		const archive = execFileSync("curl", ["-fsSL", `https://nodejs.org/dist/v${NODE_VERSION}/${name}.tar.gz`], {
			maxBuffer: 256 * 1024 * 1024,
		});
		const digest = createHash("sha256").update(archive).digest("hex");
		if (digest !== NODE_SHA256) throw new Error(`${name}.tar.gz has SHA-256 ${digest}, expected ${NODE_SHA256}`);
		const partial = `${cache}.partial`;
		rmSync(partial, { recursive: true, force: true });
		mkdirSync(partial, { recursive: true });
		writeFileSync(join(partial, "archive.tar.gz"), archive);
		execFileSync("tar", ["-xzf", "archive.tar.gz", "--strip-components", "1", `${name}/bin/node`, `${name}/LICENSE`], { cwd: partial });
		renameSync(join(partial, "bin", "node"), join(partial, "node"));
		rmSync(join(partial, "archive.tar.gz"));
		rmSync(join(partial, "bin"), { recursive: true });
		rmSync(cache, { recursive: true, force: true });
		renameSync(partial, cache);
	}
	copyFileSync(join(cache, "node"), join(stage, "node"));
	chmodSync(join(stage, "node"), 0o755);
	copyFileSync(join(cache, "LICENSE"), join(stage, "node-LICENSE"));
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, "host"), { recursive: true });
await bundleRuntime();
stageNode();
