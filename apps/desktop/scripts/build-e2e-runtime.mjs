import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bundleRuntime } from "./runtime-bundle.mjs";

const mode = process.env.OPENBOT_E2E_RUNTIME ?? "bundled";
if (mode !== "source" && mode !== "bundled") throw Error("OPENBOT_E2E_RUNTIME must be source or bundled");
if (mode === "source") {
	console.log("E2E uses source runtime entries; no runtime bundle required.");
} else {
	const outdir = fileURLToPath(new URL("../out/e2e-runtime/", import.meta.url));
	rmSync(outdir, { recursive: true, force: true });
	mkdirSync(outdir, { recursive: true });
	const started = performance.now();
	await bundleRuntime({ outdir, target: `node${process.versions.node.split(".")[0]}` });
	console.log(`E2E runtime built in ${Math.round(performance.now() - started)} ms for Node ${process.versions.node}`);
}
