/**
 * Composes Tool Router for the Host: the policy port over the user's command policy and folder grants, the approval
 * book, the executor process, and Host tools. The executor re-checks every path against the grants it receives.
 */
import { APP_TOOL_DEFINITIONS, APP_MANAGEMENT_TOOL_DEFINITIONS, type ExecutionTarget, TOOL_CATALOG } from "@openbot/protocol";
import type { MemoryEdit, PolicyStore } from "@openbot/agent-runtime";
import {
	type ApprovalBook,
	type HostService,
	canonicalPath,
	createWebFetch,
	createWebSearch,
	decide,
	isWithin,
	loadPolicy,
	memoryUpdate,
	type SecretStore,
} from "@openbot/server-core";
import { ToolRouter } from "@openbot/tool-router";
import type { ExecutorProcess } from "./executor.ts";

export function createToolRouter(options: {
	readonly target: ExecutionTarget;
	readonly service: () => HostService;
	readonly workspace: string;
	readonly approvals: ApprovalBook;
	readonly executor: ExecutorProcess;
	readonly secrets: SecretStore;
	/** Tavily endpoint override (`OPENBOT_TAVILY_BASE_URL`), for tests against a local fake. */
	readonly tavilyBaseUrl: string | undefined;
	/** `BotRuntime.editMemory`; called only once tool calls flow, after the runtime opened. */
	readonly editMemory: (botId: string, edit: MemoryEdit, invocationId: string) => Promise<number>;
	/** `BotRuntime.policy`; like `editMemory`, read only once tool calls flow. */
	readonly policy: () => PolicyStore;
	/** `<data>/artifacts`, where the executor saves cut output; `local_read` may read it without asking. */
	readonly artifactsDirectory: string;
}): ToolRouter {
	const { workspace } = options;
	const artifacts = canonicalPath(options.artifactsDirectory, workspace);
	/** The current policy; `local_read` alone also reads spilled output in the artifacts folder. */
	const policyFor = async (tool: string) => {
		const policy = await loadPolicy(options.policy(), workspace);
		if (tool !== "local_read") return policy;
		const read = [...policy.grants.read, artifacts];
		return {
			...policy,
			grants: { readwrite: policy.grants.readwrite, read },
			isGranted: (path: string, access: "read" | "readwrite") =>
				policy.isGranted(path, access) || (access === "read" && isWithin(path, artifacts)),
		};
	};
	return new ToolRouter({
		assertCallAllowed:call=>options.service().background.assertExecution(call),
		trackCommand:{prepare:(call,digest)=>options.service().background.prepare(call,digest),settle:(call,outcome)=>options.service().background.settle(call,outcome)},
  assertExecutionAllowed:()=>options.service().lifecycle.assertAllowed(),
		target: options.target,
		closeAppManagement: (call) => options.service().closeAppManagement(call),
		approvals: options.approvals,
		executor: options.executor,
		hostTools: {
 skill_load:(_args,_signal,call)=>options.service().skills.invoke(call),
 skill_save:(_args,_signal,call)=>options.service().skills.invoke(call),
			...Object.fromEntries(
				APP_TOOL_DEFINITIONS.map((d) => [
					d.name,
					((_args, _signal, call) => options.service().capabilities.invokeTool(call)) as import("@openbot/tool-router").HostToolHandler,
				]),
			),
			...Object.fromEntries(
				APP_MANAGEMENT_TOOL_DEFINITIONS.map((d) => [
					d.name,
					((_args, _signal, call) =>
						d.capability === "bot.management"
							? options.service().manageBots(call)
							: options.service().manageGroups(call)) as import("@openbot/tool-router").HostToolHandler,
				]),
			),
			bot_delegate: (_args, _signal, call) => options.service().groups.collaborate(call),
			bot_handoff: (_args, _signal, call) => options.service().groups.collaborate(call),
			group_inspect: (_args, _signal, call) => options.service().manageGroups(call),
			group_create: (_args, _signal, call) => options.service().manageGroups(call),
			group_update: (_args, _signal, call) => options.service().manageGroups(call),
			group_dissolve: (_args, _signal, call) => options.service().manageGroups(call),
			bot_inspect: (_args, _signal, call) => options.service().manageBots(call),
			bot_create: (_args, _signal, call) => options.service().manageBots(call),
			bot_update: (_args, _signal, call) => options.service().manageBots(call),
			bot_delete: (_args, _signal, call) => options.service().manageBots(call),
			web_fetch: createWebFetch(),
			web_search: createWebSearch({
				secrets: options.secrets,
				...(options.tavilyBaseUrl === undefined ? {} : { tavilyBaseUrl: options.tavilyBaseUrl }),
			}),
			memory_update: memoryUpdate(options.editMemory),
		},
		policy: {
   binding:(call,argsDigest)=>options.service().authority.binding(call,argsDigest),
   dispatch:(call,approved,binding,invoke)=>options.service().authority.dispatch(call,approved,binding,invoke),
			// Policy is read fresh for every call, so a rule or grant change applies to the next call (Section 5.3).
			decide: async (call, definition) =>
				(await options.service().groups.executionGate(call)) ??
				(definition.capability === "skills" ? options.service().skills.prepare(call) : definition.capability === "app.read" || definition.capability === "app.orchestrate"
					? options.service().capabilities.authorize(call)
					: definition.capability === "collaboration"
						? options.service().groups.prepareCollaboration(call)
						: definition.capability === "group.management"
							? options.service().groups.prepare(call)
							: definition.capability === "bot.management"
								? options.service().management.prepare(call)
								: decide(call, definition, await policyFor(call.tool))),
			// The current grants; an approved call outside them may touch exactly the path the user saw on the card.
			grants: async (call, approvedOnce) => {
				const { grants } = await policyFor(call.tool);
				const path = typeof call.args.path === "string" ? call.args.path : undefined;
				if (!approvedOnce || path === undefined) return grants;
				const approved = canonicalPath(path, workspace);
				return call.tool === "local_write" || call.tool === "local_edit"
					? { readwrite: [...grants.readwrite, approved], read: grants.read }
					: { readwrite: grants.readwrite, read: [...grants.read, approved] };
			},
		},
	});
}

export const TOOL_DEFINITIONS = TOOL_CATALOG;
