/** Ed25519 integrity check for an OpenBot DMG. Verification uses the embedded public key.
 * A failed check does not copy the artifact into the staging directory and does not replace the app.
 */
import { createHash, createPrivateKey, createPublicKey, randomBytes, sign, verify, type KeyObject } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { EMBEDDED_UPDATE_PUBLIC_KEY } from "./update-public-key.ts";

const MANIFEST_LIMIT_BYTES = 64 * 1024;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256 = /^[0-9a-f]{64}$/;

export type UpdateManifest = {
	readonly schema: 1;
	readonly product: "OpenBot";
	readonly version: string;
	readonly platform: "darwin";
	readonly arch: "arm64";
	readonly artifact: string;
	readonly sha256: string;
	readonly size: number;
};

export type UpdateRejectReason = "missing-signature" | "invalid-signature" | "tampered-artifact" | "malformed" | "ambiguous" | "empty";

export type UpdateDecision =
	| { readonly accepted: true; readonly stagedPath: string; readonly version: string }
	| { readonly accepted: false; readonly reason: UpdateRejectReason };

type UpdateBundle = { readonly manifest: UpdateManifest; readonly signature: string };

export function canonicalManifestBytes(manifest: UpdateManifest): Buffer {
	return Buffer.from(
		JSON.stringify({
			arch: manifest.arch,
			artifact: manifest.artifact,
			platform: manifest.platform,
			product: manifest.product,
			schema: manifest.schema,
			sha256: manifest.sha256,
			size: manifest.size,
			version: manifest.version,
		}),
		"utf8",
	);
}

export function signManifest(manifest: UpdateManifest, privateKeyPem: string): string {
	const key = createPrivateKey(normalizePem(privateKeyPem));
	if (key.asymmetricKeyType !== "ed25519") throw new Error("Update signing key must be ed25519");
	return sign(null, canonicalManifestBytes(manifest), key).toString("base64");
}

export function normalizePem(value: string): string {
	const trimmed = value.trim();
	const decoded = trimmed.includes("-----BEGIN ") ? trimmed : Buffer.from(trimmed, "base64").toString("utf8");
	const pem = decoded.includes("\\n") ? decoded.replaceAll("\\n", "\n") : decoded;
	if (!pem.includes("-----BEGIN ")) throw new Error("Update signing key must be a PEM");
	return pem.endsWith("\n") ? pem : `${pem}\n`;
}

export async function hashFile(path: string): Promise<{ sha256: string; size: number }> {
	const hash = createHash("sha256");
	let size = 0;
	const stream = createReadStream(path);
	try {
		for await (const chunk of stream) {
			const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			hash.update(bytes);
			size += bytes.length;
		}
	} finally {
		stream.destroy();
	}
	return { sha256: hash.digest("hex"), size };
}

export async function acceptUpdateArtifact(options: {
	readonly directory: string;
	readonly manifestFile: string;
	readonly stageDirectory: string;
	readonly publicKeyPem?: string;
}): Promise<UpdateDecision> {
	const parsed = await readBundle(options.directory, options.manifestFile);
	if (!parsed.ok) return { accepted: false, reason: parsed.reason };
	const publicKey = options.publicKeyPem ?? EMBEDDED_UPDATE_PUBLIC_KEY;
	if (!signatureMatches(parsed.bundle, publicKey)) return { accepted: false, reason: "invalid-signature" };
	const artifactPath = pathInside(options.directory, parsed.bundle.manifest.artifact);
	if (artifactPath === undefined) return { accepted: false, reason: "malformed" };
	const artifact = await regularFile(artifactPath);
	if (!artifact) return { accepted: false, reason: "malformed" };
	if (artifact.size !== parsed.bundle.manifest.size) return { accepted: false, reason: "tampered-artifact" };
	const hashed = await hashFile(artifactPath);
	if (hashed.sha256 !== parsed.bundle.manifest.sha256 || hashed.size !== parsed.bundle.manifest.size)
		return { accepted: false, reason: "tampered-artifact" };
	const stagedPath = await stageArtifact(artifactPath, options.stageDirectory, parsed.bundle);
	return { accepted: true, stagedPath, version: parsed.bundle.manifest.version };
}

export async function verifyInboxUpdate(
	dataDirectory: string,
	log: (message: string) => void = () => {},
): Promise<UpdateDecision> {
	const decision = await consumeUpdateInbox(join(dataDirectory, "update-inbox"), join(dataDirectory, "update-staging"));
	if (!decision.accepted && decision.reason !== "empty")
		log(`update refused (${decision.reason}); the installed app was not changed`);
	else if (decision.accepted) log(`update ${decision.version} staged at ${decision.stagedPath}; the running app was not replaced`);
	return decision;
}

export async function consumeUpdateInbox(inbox: string, stageDirectory: string, publicKeyPem?: string): Promise<UpdateDecision> {
	let names: string[];
	try {
		const info = await lstat(inbox);
		if (!info.isDirectory()) return { accepted: false, reason: "malformed" };
		names = await readdir(inbox);
	} catch (error) {
		if (isEnoent(error)) return { accepted: false, reason: "empty" };
		throw error;
	}
	const manifests = names.filter((name) => name.endsWith("-update.json") && basename(name) === name && !name.startsWith("."));
	if (manifests.length === 0) return { accepted: false, reason: "empty" };
	if (manifests.length > 1) return { accepted: false, reason: "ambiguous" };
	const manifestFile = manifests[0];
	if (manifestFile === undefined) return { accepted: false, reason: "empty" };
	return acceptUpdateArtifact({
		directory: inbox,
		manifestFile,
		stageDirectory,
		...(publicKeyPem === undefined ? {} : { publicKeyPem }),
	});
}

async function readBundle(
	directory: string,
	manifestFile: string,
): Promise<{ ok: true; bundle: UpdateBundle } | { ok: false; reason: UpdateRejectReason }> {
	const manifestPath = pathInside(directory, manifestFile);
	if (manifestPath === undefined) return { ok: false, reason: "malformed" };
	const file = await regularFile(manifestPath);
	if (!file || file.size > MANIFEST_LIMIT_BYTES) return { ok: false, reason: "malformed" };
	let parsed: unknown;
	try {
		parsed = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
	} catch {
		return { ok: false, reason: "malformed" };
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { ok: false, reason: "malformed" };
	const record = parsed as Record<string, unknown>;
	const keys = Object.keys(record);
	if (keys.some((key) => key !== "manifest" && key !== "signature")) return { ok: false, reason: "malformed" };
	if (!("signature" in record) || record.signature === null || (typeof record.signature === "string" && record.signature.trim() === ""))
		return { ok: false, reason: "missing-signature" };
	if (typeof record.signature !== "string") return { ok: false, reason: "malformed" };
	const manifest = parseManifest(record.manifest);
	if (manifest === undefined) return { ok: false, reason: "malformed" };
	return { ok: true, bundle: { manifest, signature: record.signature.trim() } };
}

function parseManifest(value: unknown): UpdateManifest | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record);
	const expected = ["arch", "artifact", "platform", "product", "schema", "sha256", "size", "version"];
	if (keys.length !== expected.length || expected.some((key) => !keys.includes(key))) return undefined;
	if (record.schema !== 1 || record.product !== "OpenBot" || record.platform !== "darwin" || record.arch !== "arm64") return undefined;
	if (typeof record.version !== "string" || !VERSION.test(record.version)) return undefined;
	if (typeof record.sha256 !== "string" || !SHA256.test(record.sha256)) return undefined;
	if (typeof record.size !== "number" || !Number.isSafeInteger(record.size) || record.size < 0) return undefined;
	if (record.artifact !== `OpenBot-${record.version}-arm64.dmg`) return undefined;
	return {
		schema: 1,
		product: "OpenBot",
		version: record.version,
		platform: "darwin",
		arch: "arm64",
		artifact: record.artifact,
		sha256: record.sha256,
		size: record.size,
	};
}

function signatureMatches(bundle: UpdateBundle, publicKeyPem: string): boolean {
	let key: KeyObject;
	try {
		key = createPublicKey(normalizePem(publicKeyPem));
	} catch {
		return false;
	}
	if (key.asymmetricKeyType !== "ed25519") return false;
	const signature = decodeSignature(bundle.signature);
	if (signature === undefined) return false;
	try {
		return verify(null, canonicalManifestBytes(bundle.manifest), key, signature);
	} catch {
		return false;
	}
}

function decodeSignature(value: string): Buffer | undefined {
	if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return undefined;
	const bytes = Buffer.from(value, "base64");
	if (bytes.length !== 64 || bytes.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")) return undefined;
	return bytes;
}

function pathInside(directory: string, name: string): string | undefined {
	if (name !== basename(name) || name === "" || name === "." || name === "..") return undefined;
	const root = resolve(directory);
	const path = resolve(root, name);
	const rel = relative(root, path);
	if (rel === "" || rel.startsWith("..") || rel.includes(`..${sep}`) || rel.startsWith(sep)) return undefined;
	return path;
}

async function regularFile(path: string): Promise<{ size: number } | undefined> {
	try {
		const info = await lstat(path);
		if (!info.isFile()) return undefined;
		return { size: info.size };
	} catch (error) {
		if (isEnoent(error)) return undefined;
		throw error;
	}
}

async function stageArtifact(source: string, stageDirectory: string, bundle: UpdateBundle): Promise<string> {
	const parent = dirname(resolve(stageDirectory));
	await mkdir(parent, { recursive: true });
	const temp = join(parent, `.${basename(stageDirectory)}.partial-${process.pid}-${randomBytes(4).toString("hex")}`);
	await mkdir(temp, { mode: 0o700 });
	try {
		const destination = join(temp, bundle.manifest.artifact);
		await copyFile(source, destination, constants.COPYFILE_FICLONE);
		const copied = await hashFile(destination);
		if (copied.sha256 !== bundle.manifest.sha256 || copied.size !== bundle.manifest.size)
			throw new Error("Staged update bytes do not match the signed manifest");
		await writeFile(
			join(temp, "receipt.json"),
			`${JSON.stringify(
				{
					schema: 1,
					accepted: true,
					applied: false,
					version: bundle.manifest.version,
					sha256: bundle.manifest.sha256,
					artifact: bundle.manifest.artifact,
				},
				null,
				"\t",
			)}\n`,
			{ mode: 0o644 },
		);
		await publishDirectory(temp, resolve(stageDirectory));
		return join(resolve(stageDirectory), bundle.manifest.artifact);
	} catch (error) {
		await rm(temp, { recursive: true, force: true });
		throw error;
	}
}

async function publishDirectory(temp: string, stageDirectory: string): Promise<void> {
	const backup = `${stageDirectory}.replacing`;
	await rm(backup, { recursive: true, force: true });
	let moved = false;
	try {
		await lstat(stageDirectory);
		await rename(stageDirectory, backup);
		moved = true;
	} catch (error) {
		if (!isEnoent(error)) throw error;
	}
	try {
		await rename(temp, stageDirectory);
	} catch (error) {
		if (moved) await rename(backup, stageDirectory);
		throw error;
	}
	await rm(backup, { recursive: true, force: true });
}

function isEnoent(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
