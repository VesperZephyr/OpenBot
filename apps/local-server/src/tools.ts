/**
 * Composes Tool Router for the Host: the policy port over the workspace grant, the approval book, the executor
 * process, and Host tools. The executor re-checks every path against the grants it receives.
 */
import { realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { type ExecutionTarget, TOOL_CATALOG } from "@openbot/protocol";
import type { MemoryEdit } from "@openbot/agent-runtime";
import { type ApprovalBook, decide, memoryUpdate, webFetch } from "@openbot/server-core";
import { ToolRouter } from "@openbot/tool-router";
import type { ExecutorProcess } from "./executor.ts";

export function createToolRouter(options: {
	readonly target: ExecutionTarget;
	readonly workspace: string;
	readonly approvals: ApprovalBook;
	readonly executor: ExecutorProcess;
	/** `BotRuntime.editMemory`; called only once tool calls flow, after the runtime opened. */
	readonly editMemory: (botId: string, edit: MemoryEdit) => Promise<string>;
}): ToolRouter {
	const { workspace } = options;
	const granted = (path: string): boolean => isWithin(canonical(absolute(path, workspace)), workspace);
	return new ToolRouter({
		target: options.target,
		approvals: options.approvals,
		executor: options.executor,
		hostTools: { web_fetch: webFetch, memory_update: memoryUpdate(options.editMemory) },
		policy: {
			decide: async (call, definition) => decide(call, definition, granted),
			// An approved call outside the workspace may touch exactly the path the user saw on the card.
			grants: async (call, approvedOnce) => {
				const path = typeof call.args.path === "string" ? call.args.path : undefined;
				if (!approvedOnce || path === undefined) return [workspace];
				return [workspace, canonical(absolute(path, workspace))];
			},
		},
	});
}

export const TOOL_DEFINITIONS = TOOL_CATALOG;

function absolute(path: string, base: string): string {
	const expanded = path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
	return isAbsolute(expanded) ? resolve(expanded) : resolve(base, expanded);
}

/** Resolve symbolic links of the longest existing ancestor, keeping the missing remainder. */
function canonical(path: string): string {
	let existing = path;
	let missing = "";
	for (;;) {
		try {
			const real = realpathSync(existing);
			return missing === "" ? real : join(real, missing);
		} catch {
			const parent = dirname(existing);
			if (parent === existing) return path;
			missing = missing === "" ? relative(parent, existing) : join(relative(parent, existing), missing);
			existing = parent;
		}
	}
}

function isWithin(path: string, root: string): boolean {
	const rel = relative(root, path);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
