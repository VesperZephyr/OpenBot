import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export class AccessDenied extends Error {}

/** Expand `~` and resolve relative paths against `base`. */
export function absolutePath(path: string, base: string): string {
	const expanded = path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
	return isAbsolute(expanded) ? resolve(expanded) : resolve(base, expanded);
}

/**
 * The canonical form of `path`: symbolic links resolved for the longest existing ancestor, the missing remainder
 * appended. This is the identity grants are checked against, so a link inside a granted folder that points outside it
 * does not grant the target.
 */
export async function canonicalPath(path: string): Promise<string> {
	let existing = path;
	const missing: string[] = [];
	for (;;) {
		try {
			const real = await realpath(existing);
			return missing.length === 0 ? real : join(real, ...missing.reverse());
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			const parent = dirname(existing);
			if (parent === existing) return path;
			missing.push(existing.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
			existing = parent;
		}
	}
}

export function isWithin(path: string, root: string): boolean {
	const rel = relative(root, path);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Canonicalize `path` and require it to be inside one of `grants` (already canonical). */
export async function grantedPath(path: string, base: string, grants: readonly string[]): Promise<string> {
	const canonical = await canonicalPath(absolutePath(path, base));
	if (!grants.some((root) => isWithin(canonical, root))) {
		throw new AccessDenied(`${canonical} is outside the folders OpenBot may use (${grants.join(", ")})`);
	}
	return canonical;
}
