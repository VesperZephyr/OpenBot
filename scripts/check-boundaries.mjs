#!/usr/bin/env node
// Enforces the package dependency rules in docs/architecture.md Section 4.2 for
// workspace manifests and source imports under apps/ and packages/.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;

// Allowed @openbot/* and Pi dependencies per product package. Packages that do
// not exist yet are listed so their rules apply as soon as they are added.
const PI = "@earendil-works/";
const allowed = {
	"@openbot/protocol": [],
	"@openbot/agent-runtime": ["@openbot/protocol", PI],
	"@openbot/tool-router": ["@openbot/protocol"],
	"@openbot/server-core": ["@openbot/protocol", "@openbot/agent-runtime"],
	"@openbot/local-executor": ["@openbot/protocol", "@openbot/browser", "@openbot/computer-use"],
	"@openbot/browser": ["@openbot/protocol"],
	"@openbot/computer-use": ["@openbot/protocol"],
	"@openbot/local-server": [
		"@openbot/protocol",
		"@openbot/server-core",
		"@openbot/agent-runtime",
		"@openbot/tool-router",
	],
	"@openbot/local-executor-app": ["@openbot/protocol", "@openbot/local-executor"],
	"@openbot/desktop": ["@openbot/protocol"],
};

const isGuarded = (name) => name.startsWith("@openbot/") || name.startsWith(PI);
const permits = (rules, dep) => rules.some((rule) => (rule.endsWith("/") ? dep.startsWith(rule) : dep === rule));

function packageDirs() {
	const dirs = [];
	for (const group of ["apps", "packages"]) {
		const base = join(root, group);
		if (!existsSync(base)) continue;
		for (const name of readdirSync(base)) {
			const dir = join(base, name);
			if (existsSync(join(dir, "package.json"))) dirs.push(dir);
		}
	}
	return dirs;
}

function sourceFiles(dir) {
	const files = [];
	for (const name of readdirSync(dir)) {
		if (name === "node_modules" || name === "dist" || name === "out") continue;
		const path = join(dir, name);
		if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
		else if (/\.(c|m)?(t|j)sx?$/.test(name)) files.push(path);
	}
	return files;
}

const importPattern = /(?:^|[^\w.])(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
const specifierPackage = (spec) => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);

const errors = [];
for (const dir of packageDirs()) {
	const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
	const rules = allowed[manifest.name];
	const where = relative(root, dir);
	if (rules === undefined) {
		errors.push(`${where}: ${manifest.name} has no dependency rule in scripts/check-boundaries.mjs`);
		continue;
	}
	const deps = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies };
	for (const dep of Object.keys(deps)) {
		if (isGuarded(dep) && !permits(rules, dep)) errors.push(`${where}/package.json: ${manifest.name} must not depend on ${dep}`);
	}
	for (const file of sourceFiles(dir)) {
		const text = readFileSync(file, "utf8");
		for (const match of text.matchAll(importPattern)) {
			const spec = match[1] ?? match[2];
			if (spec.startsWith(".")) {
				if (spec.includes("third_party/")) errors.push(`${relative(root, file)}: relative import into third_party: ${spec}`);
				continue;
			}
			const dep = specifierPackage(spec);
			if (isGuarded(dep) && !permits(rules, dep)) errors.push(`${relative(root, file)}: ${manifest.name} must not import ${spec}`);
		}
	}
}

if (errors.length > 0) {
	for (const error of errors) console.error(error);
	process.exit(1);
}
console.log("Package boundaries OK");
