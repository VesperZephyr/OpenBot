import { spawnSync } from "node:child_process";
import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { EMBEDDED_UPDATE_PUBLIC_KEY } from "../src/main/update-public-key";
import { acceptUpdateArtifact, hashFile, signManifest, verifyInboxUpdate, type UpdateManifest } from "../src/main/update-artifact";

const roots: string[] = [];
const version = "1.2.3";
const artifact = `OpenBot-${version}-arm64.dmg`;
const manifestName = `OpenBot-${version}-arm64-update.json`;
const repoRoot = join(import.meta.dirname, "../../..");

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function keyPair() {
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	return {
		publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
		privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
	};
}

async function directory(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "openbot-update-"));
	roots.push(root);
	return root;
}

async function writeBundle(dir: string, bytes: Buffer, signature: string | undefined): Promise<UpdateManifest> {
	await writeFile(join(dir, artifact), bytes);
	const hashed = await hashFile(join(dir, artifact));
	const manifest: UpdateManifest = {
		schema: 1,
		product: "OpenBot",
		version,
		platform: "darwin",
		arch: "arm64",
		artifact,
		sha256: hashed.sha256,
		size: hashed.size,
	};
	const body = signature === undefined ? { manifest } : { manifest, signature };
	await writeFile(join(dir, manifestName), JSON.stringify(body));
	return manifest;
}

async function decision(dir: string, stage: string, publicKeyPem: string) {
	return acceptUpdateArtifact({ directory: dir, manifestFile: manifestName, stageDirectory: stage, publicKeyPem });
}

it("accepts a valid signature and stages the artifact without replacing an install", async () => {
	const keys = keyPair();
	const dir = await directory();
	const stage = join(dir, "stage");
	const bytes = Buffer.from("openbot-update-bytes");
	const manifest = await writeBundle(dir, bytes, "placeholder");
	await writeFile(join(dir, manifestName), JSON.stringify({ manifest, signature: signManifest(manifest, keys.privatePem) }));
	const result = await decision(dir, stage, keys.publicPem);
	expect(result).toEqual({ accepted: true, stagedPath: join(stage, artifact), version });
	expect(await readFile(join(stage, artifact))).toEqual(bytes);
	expect(JSON.parse(await readFile(join(stage, "receipt.json"), "utf8"))).toMatchObject({
		accepted: true,
		applied: false,
		sha256: manifest.sha256,
		version,
	});
	expect(await readFile(join(dir, artifact))).toEqual(bytes);
});

it("rejects a tampered artifact and leaves the staged copy untouched", async () => {
	const keys = keyPair();
	const dir = await directory();
	const stage = join(dir, "stage");
	await mkdir(stage);
	await writeFile(join(stage, "keep.txt"), "kept");
	const manifest = await writeBundle(dir, Buffer.from("intact"), "placeholder");
	await writeFile(join(dir, manifestName), JSON.stringify({ manifest, signature: signManifest(manifest, keys.privatePem) }));
	const bytes = await readFile(join(dir, artifact));
	bytes[0] = bytes[0] === 0 ? 1 : 0;
	await writeFile(join(dir, artifact), bytes);
	expect(await decision(dir, stage, keys.publicPem)).toEqual({ accepted: false, reason: "tampered-artifact" });
	expect(await readFile(join(stage, "keep.txt"), "utf8")).toBe("kept");
	expect(existsSync(join(stage, artifact))).toBe(false);
});

it("rejects a signature from the wrong key", async () => {
	const signer = keyPair();
	const other = keyPair();
	const dir = await directory();
	const manifest = await writeBundle(dir, Buffer.from("artifact"), "placeholder");
	await writeFile(join(dir, manifestName), JSON.stringify({ manifest, signature: signManifest(manifest, signer.privatePem) }));
	expect(await decision(dir, join(dir, "stage"), other.publicPem)).toEqual({ accepted: false, reason: "invalid-signature" });
	expect(existsSync(join(dir, "stage"))).toBe(false);
});

it("rejects a missing signature", async () => {
	const keys = keyPair();
	const dir = await directory();
	await writeBundle(dir, Buffer.from("artifact"), undefined);
	expect(await decision(dir, join(dir, "stage"), keys.publicPem)).toEqual({ accepted: false, reason: "missing-signature" });
	await writeFile(join(dir, manifestName), JSON.stringify({ manifest: { schema: 1 }, signature: "   " }));
	expect(await decision(dir, join(dir, "stage"), keys.publicPem)).toEqual({ accepted: false, reason: "missing-signature" });
	expect(existsSync(join(dir, "stage"))).toBe(false);
});

it("uses the embedded public key when the caller does not supply one", async () => {
	const keys = keyPair();
	const dir = await directory();
	const manifest = await writeBundle(dir, Buffer.from("artifact"), "placeholder");
	await writeFile(join(dir, manifestName), JSON.stringify({ manifest, signature: signManifest(manifest, keys.privatePem) }));
	expect(createPublicKey(EMBEDDED_UPDATE_PUBLIC_KEY).asymmetricKeyType).toBe("ed25519");
	expect(await acceptUpdateArtifact({ directory: dir, manifestFile: manifestName, stageDirectory: join(dir, "stage") })).toEqual({
		accepted: false,
		reason: "invalid-signature",
	});
});

it("refuses an inbox update without creating a stage directory", async () => {
	const keys = keyPair();
	const data = await directory();
	const inbox = join(data, "update-inbox");
	await mkdir(inbox);
	const manifest = await writeBundle(inbox, Buffer.from("artifact"), undefined);
	await writeFile(join(inbox, manifestName), JSON.stringify({ manifest, signature: signManifest(manifest, keys.privatePem), publicKey: keys.publicPem }));
	const messages: string[] = [];
	expect(await verifyInboxUpdate(data, (message) => messages.push(message))).toEqual({ accepted: false, reason: "malformed" });
	expect(messages).toEqual(["update refused (malformed); the installed app was not changed"]);
	expect(existsSync(join(data, "update-staging"))).toBe(false);
	const empty = await directory();
	expect(await verifyInboxUpdate(empty)).toEqual({ accepted: false, reason: "empty" });
	expect(existsSync(join(empty, "update-inbox"))).toBe(false);
});

it("signs through the CLI only when OPENBOT_UPDATE_SIGNING_KEY is set", async () => {
	const keys = keyPair();
	const dir = await directory();
	const dmg = join(dir, artifact);
	await writeFile(dmg, Buffer.from("cli-artifact"));
	const cli = join(repoRoot, "apps/desktop/src/main/sign-update-cli.ts");
	const args = ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", cli, dmg];
	const missing = { ...process.env };
	delete missing.OPENBOT_UPDATE_SIGNING_KEY;
	const refused = spawnSync(process.execPath, args, { encoding: "utf8", env: { ...missing, OPENBOT_VERSION: version } });
	expect(refused.status).toBe(2);
	expect(refused.stderr).toContain("OPENBOT_UPDATE_SIGNING_KEY is not set");
	expect(existsSync(join(dir, manifestName))).toBe(false);
	const signed = spawnSync(process.execPath, args, {
		encoding: "utf8",
		env: { ...missing, OPENBOT_VERSION: version, OPENBOT_UPDATE_SIGNING_KEY: keys.privatePem },
	});
	expect(signed.status, signed.stderr).toBe(0);
	expect(signed.stdout).not.toContain("PRIVATE KEY");
	const result = await decision(dir, join(dir, "stage"), keys.publicPem);
	expect(result.accepted).toBe(true);
});

it("refuses to write an update signing private key inside the repository", () => {
	const script = join(repoRoot, "scripts/generate-update-signing-key.mjs");
	const printed = spawnSync(process.execPath, [script], { encoding: "utf8" });
	expect(printed.status).toBe(0);
	expect(printed.stdout).toContain("BEGIN PUBLIC KEY");
	expect(printed.stdout).not.toContain("PRIVATE KEY");
	expect(printed.stderr).toContain("OPENBOT_UPDATE_SIGNING_KEY");
	const target = join(repoRoot, "update-signing-private.pem");
	const refused = spawnSync(process.execPath, [script, "--private-out", target], { encoding: "utf8" });
	expect(refused.status).toBe(1);
	expect(refused.stderr).toContain("inside the repository");
	expect(existsSync(target)).toBe(false);
});
