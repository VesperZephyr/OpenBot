#!/usr/bin/env node
// Prints a new ed25519 public key and, only with --private-out, writes the private key outside this repository.
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
let privateOut;
for (let index = 0; index < args.length; index += 1) {
	const arg = args[index];
	if (arg === "--private-out") {
		const next = args[index + 1];
		if (next === undefined || next.startsWith("--")) {
			console.error("Usage: node scripts/generate-update-signing-key.mjs [--private-out <path-outside-this-repo>]");
			process.exit(1);
		}
		privateOut = next;
		index += 1;
		continue;
	}
	console.error("Usage: node scripts/generate-update-signing-key.mjs [--private-out <path-outside-this-repo>]");
	process.exit(1);
}

if (privateOut !== undefined) {
	const target = resolve(privateOut);
	const rel = relative(root, target);
	if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
		console.error("Refusing to write a private key inside the repository.");
		process.exit(1);
	}
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
process.stdout.write(publicKey.export({ type: "spki", format: "pem" }));
if (privateOut === undefined) {
	console.error("No private key was written. Re-run with --private-out <path-outside-this-repo>.");
	console.error("Store that file as the GitHub Actions secret OPENBOT_UPDATE_SIGNING_KEY and do not commit it.");
} else {
	writeFileSync(privateOut, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
	console.error(`Wrote the private key to ${resolve(privateOut)}.`);
	console.error("Store it as the GitHub Actions secret OPENBOT_UPDATE_SIGNING_KEY and do not commit it.");
	console.error("Replace EMBEDDED_UPDATE_PUBLIC_KEY with the public key printed above.");
}
