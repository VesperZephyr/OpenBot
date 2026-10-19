import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, copyFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const headers = dirname(require.resolve("node-api-headers/package.json"));
const output = join(desktop, "out/native");
mkdirSync(output, { recursive: true });
execFileSync(
	"xcrun",
	[
		"clang++",
		"-std=c++17",
		"-shared",
		"-fPIC",
		"-fvisibility=hidden",
		"-undefined",
		"dynamic_lookup",
		"-DNAPI_VERSION=8",
		"-DNODE_GYP_MODULE_NAME=openbot_keychain",
		"-mmacosx-version-min=13.0",
		"-Wno-deprecated-declarations",
		"-I",
		join(headers, "include"),
		"-framework",
		"Security",
		"-framework",
		"CoreFoundation",
		join(desktop, "native/keychain.cc"),
		"-o",
		join(output, "keychain.node"),
	],
	{ stdio: "inherit" },
);
copyFileSync(join(headers, "LICENSE"), join(output, "node-api-headers-LICENSE"));
