/**
 * Which paths Desktop may reveal in Finder: existing files and folders inside one of the given roots (the workspace and
 * granted folders), after symbolic links are resolved, so a link inside a root cannot point Finder elsewhere.
 */
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

/**
 * The canonical path of `path` when it exists inside one of `roots` (canonical, absolute), else `null`. A relative path
 * resolves against `base`, the workspace.
 */
export async function revealablePath(path: string, base: string, roots: readonly string[]): Promise<string | null> {
	const expanded = path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
	let real: string;
	try {
		real = await realpath(isAbsolute(expanded) ? resolve(expanded) : resolve(base, expanded));
	} catch {
		return null;
	}
	const inside = roots.some((root) => {
		const rel = relative(root, real);
		return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
	});
	return inside ? real : null;
}
