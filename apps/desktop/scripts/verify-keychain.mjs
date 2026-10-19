// Packaged native acceptance uses a separate, sealed probe application and synthetic service only.
// This validates Security.framework identity behavior, not Developer ID continuity across product updates.
import { build, Platform, Arch } from "electron-builder";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = await mkdtemp(join(tmpdir(), "openbot-keychain-native-"));
const project = join(root, "project"),
	evidence = join(root, "evidence.json"),
	service = `ai.openbot.native-probe.${process.pid}`;
await mkdir(project);
await writeFile(join(project, "package.json"), JSON.stringify({ name: "openbot-credential-probe", version: "0.0.0", main: "probe.cjs" }));
// The secret is generated within main and never crosses stdout, argv, environment, or a file.
await writeFile(
	join(project, "probe.cjs"),
	`
const {app}=require("electron"); const fs=require("node:fs/promises"); const path=require("node:path");
app.setActivationPolicy("prohibited"); app.dock?.hide();app.setPath("userData",${JSON.stringify(join(root, "profile"))});
const native=require(path.join(process.resourcesPath,"native/keychain.node"));
const service=${JSON.stringify(service)}, resultPath=${JSON.stringify(evidence)};
app.whenReady().then(async()=>{
 let result;
 try {
  const previous=await fs.readFile(resultPath,"utf8").then(JSON.parse).catch(()=>null);
  if(!previous){
   const secret=require("node:crypto").randomBytes(32).toString("hex");
   await native.access("set",service,"synthetic",secret);
   const matches=(await native.access("get",service,"synthetic"))===secret;
   result={writeRead:matches,phase:1};
  }else{
   const value=await native.access("get",service,"synthetic");
   await native.access("delete",service,"synthetic");
   const missing=(await native.access("get",service,"synthetic"))===null;
   result={...previous,relaunchRead:typeof value==="string"&&value.length===64,cleanup:missing,phase:2};
  }
  await fs.writeFile(resultPath,JSON.stringify(result),{mode:0o600});app.exit(0);
 }catch{ await fs.writeFile(resultPath,JSON.stringify({nativeUnavailable:true}),{mode:0o600});app.exit(1); }
});
`,
);
process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
await build({
	projectDir: project,
	targets: Platform.MAC.createTarget(["dir"], Arch.arm64),
	publish: "never",
	config: {
		appId: "ai.openbot.credential-probe",
		productName: "OpenBot Credential Probe",
		electronVersion: "44.7.2",
		asar: true,
		directories: { output: join(root, "dist") },
		files: ["probe.cjs", "package.json"],
		extraResources: [{ from: join(desktop, "out/native"), to: "native" }],
		electronFuses: {
			runAsNode: false,
			enableNodeOptionsEnvironmentVariable: false,
			enableNodeCliInspectArguments: false,
			enableEmbeddedAsarIntegrityValidation: true,
			onlyLoadAppFromAsar: true,
			enableCookieEncryption: true,
		},
		mac: {
			identity: "-",
			notarize: false,
			hardenedRuntime: true,
			entitlements: join(desktop, "build/entitlements.adhoc.plist"),
			entitlementsInherit: join(desktop, "build/entitlements.adhoc.plist"),
		},
	},
});
const appPath = join(root, "dist/mac-arm64/OpenBot Credential Probe.app");
const executable = join(appPath, "Contents/MacOS/OpenBot Credential Probe");
const run = promisify(execFile);
await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath]);
async function launch() {
	await run(executable, [], { timeout: 30000, env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR } });
}
let denial = false;
try {
	await launch();
	const first = JSON.parse(await readFile(evidence, "utf8"));
	assert.equal(first.writeRead, true);
	// Ordinary Node is not the trusted application. No value may be printed, even on an unexpected success.
	const child = await run(
		process.execPath,
		[
			"-e",
			`const n=require(${JSON.stringify(join(desktop, "out/native/keychain.node"))});n.access('get',${JSON.stringify(service)},'synthetic').then(v=>{process.stdout.write(v===null?'missing':'accessible');},e=>{process.stdout.write(e.message==='denied'?'denied':'unavailable');});`,
		],
		{ timeout: 15000 },
	);
	denial = child.stdout === "denied";
	await launch();
	const final = JSON.parse(await readFile(evidence, "utf8"));
	const result = {
		...final,
		ordinaryNodeDenied: denial,
		adHocSignatureVerified: true,
		identity: "separate sealed probe application",
		developerIdVerified: false,
	};
	await writeFile(evidence, JSON.stringify(result, null, 2));
	console.log(JSON.stringify({ evidence, ...result }));
	assert.equal(final.relaunchRead, true);
	assert.equal(final.cleanup, true);
	assert.equal(denial, true);
} finally {
	const latest = JSON.parse(await readFile(evidence, "utf8").catch(() => "{}"));
	if (latest.phase === 1) await launch().catch(() => {});
}
