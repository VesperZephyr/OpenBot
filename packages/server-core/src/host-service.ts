import { randomUUID } from "node:crypto";
import type { ModelConfigStatus } from "@openbot/agent-runtime";
import {
	type ArtifactOperation,
	type ArtifactOperationResult,
	type BotId,
	type BotProfile,
	type HostMethod,
	type HostParams,
	type HostResult,
	type ToolInvocation,
} from "@openbot/protocol";
import type { AppCapabilities } from "./app-capabilities.ts";
import type { ApprovalBook } from "./approvals.ts";
import type { AuthorityCoordinator } from "./authority.ts";
import type { BackgroundTasks } from "./background.ts";
import type { BotManagement, ManagementCall } from "./bot-management.ts";
import type { Connectors } from "./connectors.ts";
import type { ConversationFeed } from "./conversation-feed.ts";
import type { Groups } from "./groups.ts";
import { assembleHost } from "./host-assembly.ts";
import { requestArtifact, type AttachmentHost } from "./host-attachments.ts";
import { liveHostBot, manageHostBots } from "./host-bots.ts";
import { observeBot, republishConversation, type ObserverState } from "./host-conversations.ts";
import { dispatchHostRequest, type HostHandlers } from "./host-dispatch.ts";
import { createHostHandlers, type HandlerHost } from "./host-handlers.ts";
import { startHostSession, stopHostSession, type HostSession } from "./host-lifecycle.ts";
import type { ArtifactPort, EventSink, HostServiceOptions, ModelConfigFile, OperationAudit, SecretStore } from "./host-ports.ts";
import { reloadModelConfig } from "./host-settings.ts";
import type { LifecycleController } from "./lifecycle.ts";
import type { LocalTasks } from "./local-tasks.ts";
import type { BotMessages } from "./messages.ts";
import { Observation } from "./observation.ts";
import type { PolicyService } from "./policy-service.ts";
import type { Routines } from "./routines.ts";
import type { RunScheduler } from "./runs.ts";
import type { Skills } from "./skills.ts";
import { admitHostTask } from "./host-task-admission.ts";

export class HostService {
	readonly tasks: LocalTasks;
	readonly messages: BotMessages;
	readonly routines: Routines;
	readonly connectors: Connectors;
	readonly skills: Skills;
	readonly authority: AuthorityCoordinator;
	readonly lifecycle: LifecycleController;
	readonly capabilities: AppCapabilities;
	readonly management: BotManagement;
	readonly background: BackgroundTasks;
	readonly groups: Groups;
	readonly #artifacts: ArtifactPort | undefined;
	readonly #audit: (event: OperationAudit) => void;
	readonly #runtime: HostServiceOptions["runtime"];
	readonly #secrets: SecretStore;
	readonly #status: HostServiceOptions["status"];
	readonly #dataDirectory: string;
	readonly #modelConfig: ModelConfigFile;
	readonly #approvals: ApprovalBook;
	readonly #toolSettled: (botId: BotId, callId: string, conversationId?: string) => void;
	readonly #conversationStopped: (botId: BotId, channelId?: string, runId?: string) => void;
	readonly #workspace: string;
	readonly #emit: EventSink;
	readonly #now: () => number;
	/** Per-Bot observation of its Pi conversation; drives sidebar activity and conversation events. */
	readonly #observers = new Map<BotId, ObserverState>();
	readonly #runs: RunScheduler;
	/** Which Bot's conversation updates reach Desktop, coalesced. */
	readonly #feed: ConversationFeed;
	readonly #handlers: HostHandlers;
	readonly #policy: PolicyService;
	readonly #observation = new Observation();
	#botChanges: Promise<unknown> = Promise.resolve();
	#stopHistory: (() => void) | undefined;
	#configWrites: Promise<unknown> = Promise.resolve();
	#configStatus: ModelConfigStatus = { providers: [], errors: [] };
	#templateOperations = 0;

	constructor(options: HostServiceOptions) {
		this.#artifacts = options.artifacts;
		this.#audit = options.audit ?? (() => {});
		this.#runtime = options.runtime;
		this.#secrets = options.secrets;
		this.#status = options.status;
		this.#dataDirectory = options.dataDirectory;
		this.#modelConfig = options.modelConfig;
		this.#approvals = options.approvals;
		this.#toolSettled = options.toolSettled ?? (() => {});
		this.#conversationStopped = options.conversationStopped ?? (() => {});
		this.#workspace = options.workspace;
		this.#emit = (event) => {
			const topic = event.type === "bots.changed" ? 1 : event.type === "groups.changed" ? 2 : event.type === "lifecycle.changed" ? 8 : 4;
			this.#observation.changed(topic);
			options.emit(event);
		};
		this.#now = options.now ?? Date.now;
		const assembled = assembleHost({
			options,
			observation: this.#observation,
			emit: this.#emit,
			now: this.#now,
			audit: this.#audit,
			attachments: this.#attachmentHost(),
			toolSettled: this.#toolSettled,
			conversationStopped: this.#conversationStopped,
			republish: (botId) => this.#republish(botId),
		});
		this.management = assembled.management;
		this.#runs = assembled.runs;
		this.groups = assembled.groups;
		this.lifecycle = assembled.lifecycle;
		this.background = assembled.background;
		this.capabilities = assembled.capabilities;
		this.authority = assembled.authority;
		this.#policy = assembled.policy;
		this.#feed = assembled.feed;
		this.connectors = assembled.connectors;
		this.skills = assembled.skills;
		this.routines = assembled.routines;
		this.tasks = assembled.tasks;
		this.messages = assembled.messages;
		this.#handlers = createHostHandlers(this.#handlerHost());
	}

	observeExecution(
		call: { runId?: string; conversationId: string; callId: string; tool: string; args: Readonly<Record<string, unknown>> },
		phase: "preparing" | "dispatching" | "settled",
	) {
		if (call.runId && this.#runs.isRunning(call.runId)) this.#runtime.execution.dispatch(call, phase);
		else if (call.runId) this.#runtime.execution.clear(call.runId);
	}

	/**
	 * Load the model configuration and pending approvals, attach observers to every existing Bot, then sweep Runs left
	 * by the last shutdown. Call once after the runtime opened and before it resumes, so approvals from before a
	 * restart show before Pi reruns.
	 */
	async start(): Promise<void> {
		await startHostSession(this.#session());
	}

	/** Call before the runtime closes: the shutdown aborts waiting calls, and their approvals must stay pending. */
	async stop(): Promise<void> {
		await stopHostSession(this.#session());
	}

	/** Dispatch one validated request. Unknown methods and handler failures surface as `ProtocolError`. */
	async handle<M extends HostMethod>(method: M, params: HostParams<M>): Promise<HostResult<M>> {
		return dispatchHostRequest(
			{
				handlers: this.#handlers,
				now: () => this.#now(),
				audit: this.#audit,
				noteMutation: () => this.#observation.changed(8),
				serialize: (work) => this.#serializeBots(work),
				templateOperations: () => this.#templateOperations,
				setTemplateOperations: (count) => {
					this.#templateOperations = count;
				},
			},
			method,
			params,
		);
	}

	async closeAppManagement(call: ManagementCall) {
		await this.#runtime.closeAppManagement({ ...call, onProgress: () => {} });
	}

	async manageGroups(call: ManagementCall) {
		return this.#serializeBots(() => this.groups.manage(call));
	}

	async manageBots(call: ManagementCall): Promise<{ status: "succeeded" | "failed"; output: string }> {
		return manageHostBots(this.#actions(), call);
	}

	async admitTaskDispatch(invocation: ToolInvocation, signal: AbortSignal, send: () => void): Promise<void> {
		await admitHostTask(
			{
				runtime: this.#runtime,
				status: this.#status,
				authority: this.authority,
				lifecycle: this.lifecycle,
				approvals: this.#approvals,
				tasks: this.tasks,
			},
			invocation,
			signal,
			send,
		);
	}

	/** Republish a Bot's conversation after its pending approvals changed. Wire to the `ApprovalBook` callback. */
	approvalsChanged(botId: BotId): void {
		this.#republish(botId);
	}

	#artifact(requestId: string, operation: ArtifactOperation): Promise<ArtifactOperationResult> {
		return requestArtifact(this.#artifacts, requestId, operation);
	}

	#attachmentHost(): AttachmentHost {
		return {
			request: (requestId, operation) => this.#artifact(requestId, operation),
			liveBot: (botId) => this.#liveBot(botId),
			runtime: this.#runtime,
		};
	}

	#serializeBots<T>(work: () => Promise<T>): Promise<T> {
		const result = this.#botChanges.then(work);
		this.#botChanges = result.catch(() => {});
		return result;
	}

	/** A Bot the user can still see; a deleted one is unknown to every method that acts on it. */
	async #liveBot(botId: BotId): Promise<BotProfile> {
		return liveHostBot(this.#runtime, botId);
	}

	/** Re-read the model configuration so edits apply without restarting; cheap enough to run on every settings read. */
	async #reloadModelConfig(): Promise<void> {
		return reloadModelConfig(this.#actions());
	}

	#republish(botId: BotId): void {
		republishConversation(this.#actions(), botId);
	}

	async #observe(botId: BotId): Promise<void> {
		return observeBot(this.#actions(), botId);
	}

	#session(): HostSession {
		return {
			runtime: this.#runtime,
			observation: this.#observation,
			tasks: this.tasks,
			lifecycle: this.lifecycle,
			reloadModelConfig: () => this.#reloadModelConfig(),
			now: () => this.#now(),
			audit: this.#audit,
			targetId: this.#status.targetId,
			approvals: this.#approvals,
			connectors: this.connectors,
			observe: (botId) => this.#observe(botId),
			authority: this.authority,
			routines: this.routines,
			runs: this.#runs,
			groups: this.groups,
			background: this.background,
			feed: this.#feed,
			observers: this.#observers,
			stopHistory: () => this.#stopHistory,
			setStopHistory: (stop) => {
				this.#stopHistory = stop;
			},
		};
	}

	#handlerHost(): HandlerHost {
		return {
			tasks: this.tasks,
			routines: this.routines,
			background: this.background,
			connectors: this.connectors,
			skills: this.skills,
			observation: this.#observation,
			lifecycle: this.lifecycle,
			runs: this.#runs,
			groups: this.groups,
			runtime: this.#runtime,
			capabilities: this.capabilities,
			management: this.management,
			authority: this.authority,
			approvals: this.#approvals,
			policy: this.#policy,
			status: this.#status,
			workspace: this.#workspace,
			artifact: (requestId, operation) => this.#artifact(requestId, operation),
			liveBot: (botId) => this.#liveBot(botId),
			actions: () => this.#actions(),
			now: () => this.#now(),
			emit: this.#emit,
			observe: (botId) => this.#observe(botId),
		};
	}

	#actions() {
		return {
			runtime: this.#runtime,
			secrets: this.#secrets,
			modelConfig: this.#modelConfig,
			dataDirectory: this.#dataDirectory,
			workspace: this.#workspace,
			configStatus: () => this.#configStatus,
			setConfigStatus: (status: ModelConfigStatus) => {
				this.#configStatus = status;
			},
			configWrites: () => this.#configWrites,
			setConfigWrites: (writes: Promise<unknown>) => {
				this.#configWrites = writes;
			},
			now: () => this.#now(),
			emit: this.#emit,
			skills: this.skills,
			artifact: (requestId: string, operation: ArtifactOperation) => this.#artifact(requestId, operation),
			liveBot: (botId: BotId) => this.#liveBot(botId),
			observe: (botId: BotId) => this.#observe(botId),
			runs: this.#runs,
			approvals: this.#approvals,
			observers: this.#observers,
			feed: this.#feed,
			conversationStopped: this.#conversationStopped,
			management: this.management,
			serialize: <T>(work: () => Promise<T>) => this.#serializeBots(work),
			background: this.background,
			groups: this.groups,
			toolSettled: this.#toolSettled,
		};
	}
}

export const newRequestId = (): string => randomUUID();
