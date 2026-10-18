/**
 * The policy snapshot `decide` and the executor grants are computed from: the `openbot.policy` and `openbot.grants`
 * documents read once, plus the workspace as an implicit `readwrite` grant. Paths are compared canonically (symbolic
 * links of the longest existing ancestor resolved), the same identity the executor checks again before acting.
 */
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { PolicyStore } from "@openbot/agent-runtime";
import type { FolderGrant } from "@openbot/protocol";
import type { PolicySnapshot } from "./approvals.ts";

/** Folders file tools may use, split by access; `readwrite` always includes the workspace. */
export type GrantLists = { readonly readwrite: readonly string[]; readonly read: readonly string[] };

export async function loadPolicy(store: PolicyStore, workspace: string): Promise<PolicySnapshot & { readonly grants: GrantLists }> {
	const { settings, grants } = await store.snapshot();
	const lists = grantLists(grants, workspace);
	return {
		...settings,
		workspace,
		grants: lists,
		resolve: canonicalPath,
		isGranted: (path, access) =>
			lists.readwrite.some((root) => isWithin(path, root)) || (access === "read" && lists.read.some((root) => isWithin(path, root))),
	};
}

export function grantLists(grants: readonly FolderGrant[], workspace: string): GrantLists {
	return {
		readwrite: [workspace, ...grants.filter((grant) => grant.access === "readwrite").map((grant) => grant.path)],
		read: grants.filter((grant) => grant.access === "read").map((grant) => grant.path),
	};
}

/** Canonical absolute form: `~` expanded, relative to `base`, symbolic links of the longest existing ancestor resolved. */
export function canonicalPath(path: string, base: string): string {
	const expanded = path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
	let existing = isAbsolute(expanded) ? resolve(expanded) : resolve(base, expanded);
	let missing = "";
	for (;;) {
		try {
			const real = realpathSync(existing);
			return missing === "" ? real : join(real, missing);
		} catch {
			const parent = dirname(existing);
			if (parent === existing) return existing;
			missing = missing === "" ? relative(parent, existing) : join(relative(parent, existing), missing);
			existing = parent;
		}
	}
}

export function isWithin(path: string, root: string): boolean {
	const rel = relative(root, path);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
