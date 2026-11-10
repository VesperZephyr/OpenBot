#!/usr/bin/env node
// Enforces the package dependency rules in docs/architecture.md Section 4.2 for
// workspace manifests and source imports under apps/ and packages/.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
		"@openbot/local-executor",
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

export function packageBoundaryErrors() {
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
	return errors;
}

const uiPackages = new Set(["react", "react-dom", "react-aria-components", "tailwind-merge"]);
const iconPackages = new Set(["react", "react-dom", "lucide-react"]);
const sourceExtensions = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs"];
const importPatterns = [
	/(?:^|[^\w.])(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']/g,
	/(?:^|[^\w.])import\s*["']([^"']+)["']/g,
	/import\(\s*["']([^"']+)["']\s*\)/g,
];

function inside(parent, file) {
	const rel = relative(parent, file);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function resolveRelative(fromFile, spec) {
	const base = resolve(dirname(fromFile), spec);
	const candidates = [base, ...sourceExtensions.map((ext) => base + ext), ...sourceExtensions.flatMap((ext) => [join(base, `index${ext}`)])];
	return candidates.find((candidate) => existsSync(candidate)) ?? base;
}

function specifiers(text) {
	const found = [];
	for (const pattern of importPatterns) {
		for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags))) if (match[1]) found.push(match[1]);
	}
	return found;
}

function packageName(spec) {
	return spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
}

function allowedPackage(spec, allowed) {
	if (spec.startsWith(".") || spec.startsWith("node:") || spec === "electron") return false;
	return allowed.has(packageName(spec));
}

export function checkRendererUi(uiDir, iconFile) {
	const errors = [];
	const remedy = "pass state and actions as props";
	if (!existsSync(uiDir)) return [`${uiDir}: renderer ui directory is missing`];
	const icon = iconFile ? resolve(iconFile) : "";
	for (const file of sourceFiles(uiDir)) {
		for (const spec of specifiers(readFileSync(file, "utf8"))) {
			if (spec.startsWith(".")) {
				const resolved = resolve(resolveRelative(file, spec));
				if (icon !== "" && resolved === icon) continue;
				if (!inside(uiDir, resolved))
					errors.push(`${relative(root, file)}: ${spec} leaves the renderer UI boundary (${relative(root, resolved) || resolved}). ${remedy}`);
				continue;
			}
			if (!allowedPackage(spec, uiPackages))
				errors.push(`${relative(root, file)}: cannot import ${spec} from the renderer UI boundary. ${remedy}`);
		}
	}
	if (iconFile && existsSync(iconFile)) {
		for (const spec of specifiers(readFileSync(iconFile, "utf8"))) {
			if (!allowedPackage(spec, iconPackages))
				errors.push(`${relative(root, iconFile)}: InterfaceIcon may only import React and lucide-react, not ${spec}`);
		}
	}
	return errors;
}

const rendererUiPackages = ["react-aria-components", "tailwind-merge", "tailwindcss", "@tailwindcss/vite"];

export function checkProcessUiImports(desktopSrc) {
	const errors = [];
	for (const area of ["main", "preload"]) {
		const dir = join(desktopSrc, area);
		if (!existsSync(dir)) continue;
		for (const file of sourceFiles(dir)) {
			for (const spec of specifiers(readFileSync(file, "utf8"))) {
				if (rendererUiPackages.some((name) => spec === name || spec.startsWith(`${name}/`)))
					errors.push(`${relative(root, file)}: main and preload must not import ${spec}`);
			}
		}
	}
	return errors;
}

const approvalFeatureModules = new Set(["Skills", "BotManagement", "GroupPreview"]);

function isApprovalFeatureModule(resolved) {
	const parts = resolved.split(/[\\/]/).filter((part) => part !== "");
	const last = parts[parts.length - 1] ?? "";
	const stem = last.replace(/\.(tsx|ts|jsx|js|mjs|cjs)$/, "");
	if (approvalFeatureModules.has(stem)) return true;
	const parent = parts[parts.length - 2];
	return stem === "index" && parent !== undefined && approvalFeatureModules.has(parent);
}

export function checkApprovalUiImports(rendererSrc) {
	const errors = [];
	const remedy = "move the shared preview into a neutral module or pass it from the caller";
	const entry = join(rendererSrc, "ApprovalCard.tsx");
	if (!existsSync(entry)) return [`${relative(root, rendererSrc) || rendererSrc}: ApprovalCard.tsx is missing`];
	const files = [entry, join(rendererSrc, "AlwaysAllow.tsx"), join(rendererSrc, "approval-records.ts"), join(rendererSrc, "composer-approval.ts")].filter((file) =>
		existsSync(file),
	);
	// Include neutral previews so a re-export cannot restore the feature import under the card.
	const previews = join(rendererSrc, "previews");
	if (existsSync(previews) && statSync(previews).isDirectory()) files.push(...sourceFiles(previews));
	for (const file of files) {
		for (const spec of specifiers(readFileSync(file, "utf8"))) {
			if (!spec.startsWith(".")) continue;
			const resolved = resolve(resolveRelative(file, spec));
			if (!isApprovalFeatureModule(resolved)) continue;
			errors.push(
				`${relative(root, file)}: ${spec} imports a feature module (${relative(root, resolved) || resolved}). Approval UI cannot import Skills, BotManagement, or GroupPreview. ${remedy}`,
			);
		}
	}
	return errors;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
	const errors = [
		...packageBoundaryErrors(),
		...checkRendererUi(join(root, "apps/desktop/src/renderer/src/ui"), join(root, "apps/desktop/src/renderer/src/InterfaceIcon.tsx")),
		...checkProcessUiImports(join(root, "apps/desktop/src")),
		...checkApprovalUiImports(join(root, "apps/desktop/src/renderer/src")),
	];
	if (errors.length > 0) {
		for (const error of errors) console.error(error);
		process.exit(1);
	}
	console.log("Package boundaries OK");
}
