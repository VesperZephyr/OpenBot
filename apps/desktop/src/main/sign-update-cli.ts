/** Signs one DMG into an update manifest. The private key is read from OPENBOT_UPDATE_SIGNING_KEY and is never written. */
import { createPrivateKey } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { lstat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hashFile, normalizePem, signManifest, type UpdateManifest } from "./update-artifact.ts";

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export async function signUpdateCli(args: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
	const key = env.OPENBOT_UPDATE_SIGNING_KEY;
	if (key === undefined || key.trim() === "") {
		console.error("OPENBOT_UPDATE_SIGNING_KEY is not set. Refusing to sign an update artifact.");
		return 2;
	}
	const dmgArg = args.length === 1 ? args[0] : undefined;
	if (dmgArg === undefined || dmgArg === "") {
		console.error("Usage: sign-update-cli.ts <OpenBot-version-arm64.dmg>");
		return 1;
	}
	let privatePem: string;
	try {
		privatePem = normalizePem(key);
		const parsed = createPrivateKey(privatePem);
		if (parsed.asymmetricKeyType !== "ed25519") throw new Error("not ed25519");
	} catch {
		console.error("OPENBOT_UPDATE_SIGNING_KEY is not a PKCS#8 ed25519 private key. Refusing to sign.");
		return 1;
	}
	let version: string;
	try {
		version = (env.OPENBOT_VERSION ?? "").trim() || packageVersion();
	} catch {
		console.error("apps/desktop/package.json has no version. Refusing to sign.");
		return 1;
	}
	if (!VERSION.test(version)) {
		console.error("OPENBOT_VERSION must be a semantic version such as 1.2.3. Refusing to sign.");
		return 1;
	}
	const dmgPath = resolve(dmgArg);
	const expectedName = `OpenBot-${version}-arm64.dmg`;
	if (basename(dmgPath) !== expectedName) {
		console.error(`Refusing to sign ${basename(dmgPath)}; expected ${expectedName}.`);
		return 1;
	}
	try {
		const info = await lstat(dmgPath);
		if (!info.isFile()) throw new Error("not a file");
	} catch {
		console.error("Update artifact must be an existing regular file. Refusing to sign.");
		return 1;
	}
	const hashed = await hashFile(dmgPath);
	const manifest: UpdateManifest = {
		schema: 1,
		product: "OpenBot",
		version,
		platform: "darwin",
		arch: "arm64",
		artifact: expectedName,
		sha256: hashed.sha256,
		size: hashed.size,
	};
	const output = join(dirname(dmgPath), `OpenBot-${version}-arm64-update.json`);
	await writeFile(output, `${JSON.stringify({ manifest, signature: signManifest(manifest, privatePem) }, null, "\t")}\n`, { mode: 0o644 });
	console.log(output);
	return 0;
}

function packageVersion(): string {
	const packageJson = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"), "utf8")) as {
		version?: unknown;
	};
	if (typeof packageJson.version !== "string") throw new Error("missing version");
	return packageJson.version;
}

function isDirectRun(): boolean {
	const entry = process.argv[1];
	if (entry === undefined) return false;
	try {
		return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
	} catch {
		return false;
	}
}

if (isDirectRun()) process.exitCode = await signUpdateCli(process.argv.slice(2), process.env);
