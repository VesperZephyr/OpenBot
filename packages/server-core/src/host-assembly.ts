import { randomUUID } from "node:crypto";
import type { BotId } from "@openbot/protocol";
import { ProtocolError } from "@openbot/protocol";
import { AppCapabilities } from "./app-capabilities.ts";
import { AuthorityCoordinator } from "./authority.ts";
import { BackgroundTasks } from "./background.ts";
import { BotManagement } from "./bot-management.ts";
import { Connectors } from "./connectors.ts";
import { ConversationFeed } from "./conversation-feed.ts";
import { Groups } from "./groups.ts";
import { hydrateMessageAttachments, resolveMessageAttachments, type AttachmentHost } from "./host-attachments.ts";
import type { EventSink, HostServiceOptions, OperationAudit } from "./host-ports.ts";
import { LifecycleController } from "./lifecycle.ts";
import { LocalTasks } from "./local-tasks.ts";
import { BotMessages } from "./messages.ts";
import type { Observation } from "./observation.ts";
import { PolicyService } from "./policy-service.ts";
import { Routines } from "./routines.ts";
import { DEFAULT_MAX_ACTIVE_RUNS, RunScheduler } from "./runs.ts";
import { Skills } from "./skills.ts";

export type HostAssembly = {
	management: BotManagement;
	runs: RunScheduler;
	groups: Groups;
	lifecycle: LifecycleController;
	background: BackgroundTasks;
	capabilities: AppCapabilities;
	authority: AuthorityCoordinator;
	policy: PolicyService;
	feed: ConversationFeed;
	connectors: Connectors;
	skills: Skills;
	routines: Routines;
	tasks: LocalTasks;
	messages: BotMessages;
};

export type HostAssemblyInput = {
	readonly options: HostServiceOptions;
	readonly observation: Observation;
	readonly emit: EventSink;
	readonly now: () => number;
	readonly audit: (event: OperationAudit) => void;
	readonly attachments: AttachmentHost;
	readonly toolSettled: (botId: BotId, callId: string, conversationId?: string) => void;
	readonly conversationStopped: (botId: BotId, channelId?: string, runId?: string) => void;
	republish(botId: BotId): void;
};

/** Build the collaborators HostService owns. Callbacks close over `host` and run only after every field is assigned. */
export function assembleHost(input: HostAssemblyInput): HostAssembly {
	const { options, observation, emit, now, audit, attachments, toolSettled, conversationStopped, republish } = input;
	const runtime = options.runtime;
	const host = {} as HostAssembly;
	host.management = new BotManagement(runtime, options.status.targetId, now);
	host.runs = new RunScheduler({
		resolveSkills: (refs) => host.skills.attachments(refs),
		resolveAttachments: (botId, ids) => resolveMessageAttachments(attachments, botId, ids),
		hydrateAttachments: (botId, refs) => hydrateMessageAttachments(attachments, botId, refs),
		runtime,
		canAdmit: () => !host.lifecycle.state.blocked,
		maxActiveRuns: options.maxActiveRuns ?? DEFAULT_MAX_ACTIVE_RUNS,
		changed: (botId) => republish(botId),
		taskChanged: () => {
			observation.changed(1);
			void host.tasks?.changed();
		},
		taskPreparing: (runId, work) => host.tasks.preparing(runId, work),
		taskInput: (run, submit) =>
			host.authority.change(async () => {
				host.lifecycle.assertAllowed();
				await runtime.tasks().assertRun(run.runId);
				return submit();
			}),
		now,
		stopping: (botId, channelId, runId) => conversationStopped(botId, channelId, runId),
		admissible: async (run) =>
			(await host.tasks.admissible(run)) &&
			(await host.groups.admissible(run)) &&
			(await host.background.admissible(run)) &&
			(await host.routines.admissible(run)),
	});
	host.groups = new Groups({
		canRun: () => !host.lifecycle.state.blocked,
		runtime,
		authority: host.management,
		runs: host.runs,
		approvals: options.approvals,
		changed: () => {
			emit({ type: "groups.changed", payload: {} });
			observation.changed(8);
		},
		settled: toolSettled,
		stopping: (botId, channelId, runId) => conversationStopped(botId, channelId, runId),
	});
	host.lifecycle = new LifecycleController({
		hasWork: async () => host.runs.hasWork() || (await runtime.groups().deliveries()).some((delivery) => delivery.state === "pending"),
		store: runtime.lifecycle(),
		targetId: options.status.targetId,
		...(options.nativeLifecycleRequired ? { nativeRequired: true } : {}),
		changed: (state) => emit({ type: "lifecycle.changed", payload: state }),
		suspend: async (reason) => {
			await host.runs.interruptAll(reason, options.quiesce);
			await host.groups.interruptActive();
		},
		resume: async () => {
			await host.runs.resume();
			await host.groups.sweep();
			if (!host.lifecycle.state.blocked) runtime.resume();
		},
	});
	host.background = new BackgroundTasks({
		audit: (event) =>
			audit({
				operationId: randomUUID(),
				operation: "background.delivery",
				at: Date.now(),
				durationMs: event.durationMs,
				outcome: event.state === "attention" ? "failed" : "succeeded",
				background: event,
			}),
		runtime,
		runs: host.runs,
		...(options.background ? { port: options.background } : {}),
		targetId: options.status.targetId,
		canRun: () => !host.lifecycle.state.blocked,
		groupAdmissible: (run) => host.groups.admissible(run),
		changed: (botId) => {
			republish(botId);
			emit({ type: "groups.changed", payload: {} });
		},
	});
	host.capabilities = new AppCapabilities(runtime, options.status.targetId, (run) => host.groups.admissible(run));
	host.management.appGuard = (call) => host.capabilities.authorizeManagement(call);
	host.authority = new AuthorityCoordinator({
		resolveTool: (name) => host.connectors.resolve(name),
		assertCall: async (call) => {
			await host.tasks.assertExecution(call);
			await host.connectors.assertExecution(call);
			await host.routines.assertExecution(call);
		},
		dataDirectory: options.dataDirectory,
		runtime,
		workspace: options.workspace,
		targetId: options.status.targetId,
		approvals: options.approvals,
		executor: options.authorityExecutor ?? { synchronize: async () => {}, revoke: async () => {} },
		interrupt: async (ids, stop) => {
			await host.runs.interruptSelected(ids, stop);
			await host.groups.interruptActive();
		},
	});
	host.policy = new PolicyService({
		resolveTool: (name) => host.connectors.resolve(name),
		runtime,
		approvals: options.approvals,
		workspace: options.workspace,
		now,
		change: (fn) => host.authority.change(fn),
		reconcile: () => host.authority.reconcile(),
	});
	host.feed = new ConversationFeed({
		deliver: (snapshot) => emit({ type: "conversation.updated", payload: snapshot }),
		...(options.coalesce?.windowMs === undefined ? {} : { windowMs: options.coalesce.windowMs }),
		...(options.coalesce?.timers === undefined ? {} : { timers: options.coalesce.timers }),
	});
	host.connectors = new Connectors({
		runtime,
		targetId: options.status.targetId,
		...(options.connectors ? { port: options.connectors } : {}),
		secrets: options.secrets,
		approvals: options.approvals,
		assertAllowed: () => host.lifecycle.assertAllowed(),
		change: (fn) => host.authority.change(fn),
		publish: (definitions, available) => runtime.refreshConnectorTools(definitions, available),
		changed: () => observation.changed(8),
	});
	host.skills = new Skills({
		runtime,
		...(options.skills ? { port: options.skills } : {}),
		targetId: options.status.targetId,
		assertAllowed: () => host.lifecycle.assertAllowed(),
		changed: () => observation.changed(8),
	});
	host.routines = new Routines({
		runtime,
		runs: host.runs,
		approvals: options.approvals,
		targetId: options.status.targetId,
		canRun: () => !host.lifecycle.state.blocked,
		now,
		changed: () => observation.changed(11),
		resolveSkills: (refs) => host.skills.attachments(refs),
		changeAuthority: (fn) => host.authority.change(fn),
		settled: toolSettled,
	});
	host.tasks = new LocalTasks({
		runtime,
		runs: host.runs,
		authority: host.authority,
		...(options.authorityExecutor ? { executor: options.authorityExecutor } : {}),
		approvals: options.approvals,
		workspace: options.workspace,
		targetId: options.status.targetId,
		cap: options.maxActiveRuns ?? DEFAULT_MAX_ACTIVE_RUNS,
		now,
		paused: () => host.lifecycle.state.blocked,
		changed: () => observation.changed(1),
		resolveAttachments: (botId, ids) => resolveMessageAttachments(attachments, botId, ids),
		resolveSkills: (refs) => host.skills.attachments(refs),
	});
	host.messages = new BotMessages({
		runtime,
		targetId: options.status.targetId,
		assertAllowed: () => host.lifecycle.assertAllowed(),
		assertContext: async (call) => {
			await host.tasks.assertExecution(call);
			await host.background.assertExecution(call);
			const gate = await host.groups.executionGate(call);
			if (gate?.kind === "deny") throw new ProtocolError("invalid_request", gate.reason);
		},
	});
	return host;
}
