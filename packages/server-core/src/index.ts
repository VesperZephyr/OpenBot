import { Routines } from "./routines.ts";
import {Connectors,type ConnectorPort} from "./connectors.ts";
import { BackgroundTasks, type BackgroundPort } from "./background.ts";
import { Skills, type SkillPort } from "./skills.ts";
import { Observation } from "./observation.ts";
import { CONNECTOR_CREDENTIAL_PREFIX, ARTIFACT_LIMITS } from "@openbot/protocol";
import type { ArtifactRef, ArtifactContent, ArtifactOperation, ArtifactOperationResult } from "@openbot/protocol";
import { AuthorityCoordinator, type AuthorityExecutor } from "./authority.ts";
import {LifecycleController} from "./lifecycle.ts";
import { legacyManagementName } from "@openbot/protocol";
/**
 * Transport-independent application methods for the Host Runtime. Process composition, credential storage, and IPC
 * live in `apps/local-server`; this package only sees ports.
 */
import { AppCapabilities } from "./app-capabilities.ts";
import { randomUUID } from "node:crypto";
import type { BotRuntime, ConfigEnvironment, ModelConfigStatus } from "@openbot/agent-runtime";
import type { ApprovalBook } from "./approvals.ts";
import { Groups } from "./groups.ts";
import { BotManagement, type ManagementCall } from "./bot-management.ts";
import { PolicyService } from "./policy-service.ts";
import type { Timers } from "./coalescer.ts";
import { ConversationFeed } from "./conversation-feed.ts";
import { mergeProvider } from "./model-providers.ts";
import { revealablePath } from "./reveal.ts";
import { SEARCH_PROVIDER_PREFIX, TAVILY_PROVIDER_ID } from "./web-search.ts";
import { DEFAULT_MAX_ACTIVE_RUNS, RunScheduler } from "./runs.ts";
import {
	type BotActivity,
	type BotId,
	type BotProfile,
	type BotSummary,
	type ConversationSnapshot,
	type HostEvent,
	type HostMethod,
	type HostMethods,
	type HostParams,
	type HostResult,
	type HostStatus,
	ProtocolError,
	type RedactedSettings,
} from "@openbot/protocol";

/** Credential storage port. The Host uses the private Desktop broker; tests use memory. */
export interface SecretStore {
 status?(): Promise<import("@openbot/protocol").CredentialStatus>;
 migrate?(): Promise<import("@openbot/protocol").CredentialMigration>;
	/** Provider IDs that currently have a stored API key. Never returns the keys themselves. */
	configuredProviders(): Promise<ReadonlySet<string>>;
	setApiKey(providerId: string, apiKey: string): Promise<void>;
	deleteApiKey(providerId: string): Promise<void>;
	/** The stored key, for Host tools that call a keyed service (`search:tavily`). Never sent to renderers. */
	getApiKey(providerId: string): Promise<string | undefined>;
}

export type EventSink = (event: HostEvent) => void;

/** The user's model configuration file. The Host implements file access and command execution. */
export interface ModelConfigFile {
	readonly path: string;
	/** Current file text, or `undefined` when the file does not exist. Rejects with a readable message otherwise. */
	read(): Promise<string | undefined>;
	/** Replace the file's text atomically, creating its directory when needed. */
	write(text: string): Promise<void>;
	readonly environment: ConfigEnvironment;
}

export type OperationAudit = {
	readonly operationId: string;
	readonly operation: HostMethod | "core.ensure" | "background.delivery";
	readonly background?: import("./background.ts").BackgroundAudit;
	readonly at: number;
	readonly durationMs: number;
	readonly outcome: "succeeded" | "failed";
};

export interface ArtifactPort {
	request(requestId: string, operation: ArtifactOperation): Promise<ArtifactOperationResult>;
}
export type HostServiceOptions = {
 readonly connectors?:ConnectorPort;
	readonly background?:BackgroundPort;
	readonly artifacts?: ArtifactPort;
 readonly skills?:SkillPort;
 readonly authorityExecutor?:AuthorityExecutor;
 readonly nativeLifecycleRequired?:boolean;
 readonly quiesce?:()=>Promise<void>;
	/** Content-free diagnostics; authoritative action state stays in its own durable store. */
	readonly audit?: (event: OperationAudit) => void;
	readonly runtime: BotRuntime;
	readonly secrets: SecretStore;
	readonly status: HostStatus;
	readonly dataDirectory: string;
	readonly modelConfig: ModelConfigFile;
	/** Pending approvals; the Host passes the same book to Tool Router. `start()` attaches it to the runtime's store. */
	readonly approvals: ApprovalBook;
	/**
	 * Runs once per tool call when the conversation first shows its result, that is after Pi committed it. The Host
	 * acknowledges the executor receipt and consumes the call's approval here. Also runs for results already present
	 * when observation starts.
	 */
	readonly toolSettled?: (botId: BotId, callId: string, conversationId?: string) => void;
	/** Stops background commands for a Run, or the full conversation for lifecycle changes. */
	readonly conversationStopped?: (botId: BotId, channelId?: string, runId?: string) => void;
	/** The shared folder every Bot may use without asking. */
	readonly workspace: string;
	readonly emit: EventSink;
	/** Most Runs that may be running at once, across all Bots; default 3. */
	readonly maxActiveRuns?: number;
	/** Coalescing of `conversation.updated` events; tests pass manual timers. */
	readonly coalesce?: { readonly windowMs?: number; readonly timers?: Timers };
	readonly now?: () => number;
};

type Handlers = { [M in HostMethod]: (params: HostParams<M>) => Promise<HostResult<M>> };

export class HostService {
 readonly routines:Routines;
 readonly connectors:Connectors;
 readonly skills:Skills;
 readonly authority:AuthorityCoordinator;
 readonly lifecycle:LifecycleController;
	readonly capabilities: AppCapabilities;
	readonly #artifacts: ArtifactPort | undefined;
	readonly management: BotManagement;
	readonly background: BackgroundTasks;
	readonly groups: Groups;
	#botChanges: Promise<unknown> = Promise.resolve();
	readonly #observation = new Observation();
	readonly #audit: (event: OperationAudit) => void;
	#configWrites: Promise<unknown> = Promise.resolve();
	readonly #runtime: BotRuntime;
	readonly #secrets: SecretStore;
	readonly #status: HostStatus;
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
	readonly #handlers: Handlers;
	readonly #policy: PolicyService;
	#configStatus: ModelConfigStatus = { providers: [], errors: [] };

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
			this.#observation.changed(event.type === "bots.changed" ? 1 : event.type === "groups.changed" ? 2 : event.type === "lifecycle.changed" ? 8 : 4);
			options.emit(event);
		};
		this.#now = options.now ?? Date.now;
		this.management = new BotManagement(this.#runtime, this.#status.targetId, this.#now);
		this.#runs = new RunScheduler({
			resolveSkills:refs=>this.skills.attachments(refs),
 resolveAttachments: (botId, ids) => this.#resolveAttachments(botId, ids),
			hydrateAttachments: async (botId, refs) => {
				const current = await this.#resolveAttachments(
					botId,
					refs.map((ref) => ref.artifactId),
				);
				if (current.some((ref, i) => ref.sha256 !== refs[i]?.sha256))
					throw new ProtocolError("invalid_request", "Attachment content changed");
				const content: ArtifactContent[] = [];
				for (const ref of refs) {
					const item = (await this.#artifact(randomUUID(), { action: "content", artifactId: ref.artifactId })) as ArtifactContent;
					if (item.artifact.availability !== "available") throw new ProtocolError("invalid_request", "Attachment content is unavailable");
					content.push(item);
				}
				return content;
			},
			runtime: this.#runtime,
			canAdmit: () => !this.lifecycle.state.blocked,
			maxActiveRuns: options.maxActiveRuns ?? DEFAULT_MAX_ACTIVE_RUNS,
			changed: (botId) => this.#republish(botId),
			now: this.#now,
			stopping: (botId, channelId, runId) => this.#conversationStopped(botId, channelId, runId),
			admissible: async (run) => await this.groups.admissible(run) && await this.background.admissible(run) && await this.routines.admissible(run),
		});
		this.groups = new Groups({
			canRun: () => !this.lifecycle.state.blocked,
			runtime: this.#runtime,
			authority: this.management,
			runs: this.#runs,
			approvals: this.#approvals,
			changed: () => this.#emit({ type: "groups.changed", payload: {} }),
			settled: this.#toolSettled,
			stopping: (botId, channelId, runId) => this.#conversationStopped(botId, channelId, runId),
		});
		this.lifecycle = new LifecycleController({
			hasWork: async () => this.#runs.hasWork() || (await this.#runtime.groups().deliveries()).some((delivery) => delivery.state === "pending"),
			store: this.#runtime.lifecycle(),
			targetId: this.#status.targetId,
			...(options.nativeLifecycleRequired ? { nativeRequired: true } : {}),
			changed: (state) => this.#emit({ type: "lifecycle.changed", payload: state }),
			suspend: async (reason) => {
				await this.#runs.interruptAll(reason, options.quiesce);
				await this.groups.interruptActive();
			},
			resume: async () => {
				await this.#runs.resume();
				await this.groups.sweep();
				if (!this.lifecycle.state.blocked) this.#runtime.resume();
			},
		});

		this.background=new BackgroundTasks({audit:event=>this.#audit({operationId:randomUUID(),operation:"background.delivery",at:Date.now(),durationMs:event.durationMs,outcome:event.state==="attention"?"failed":"succeeded",background:event}),runtime:this.#runtime,runs:this.#runs,...(options.background?{port:options.background}:{}),targetId:this.#status.targetId,canRun:()=>!this.lifecycle.state.blocked,groupAdmissible:run=>this.groups.admissible(run),changed:botId=>{this.#republish(botId);this.#emit({type:"groups.changed",payload:{}});}});
		this.capabilities = new AppCapabilities(this.#runtime, this.#status.targetId, (run) => this.groups.admissible(run));
		this.management.appGuard = (call) => this.capabilities.authorizeManagement(call);
		this.authority=new AuthorityCoordinator({resolveTool:name=>this.connectors.resolve(name),assertCall:async call=>{await this.connectors.assertExecution(call);await this.routines.assertExecution(call);},dataDirectory:this.#dataDirectory,runtime:this.#runtime,workspace:this.#workspace,targetId:this.#status.targetId,approvals:this.#approvals,executor:options.authorityExecutor??{synchronize:async()=>{},revoke:async()=>{}},interrupt:async(ids,stop)=>{await this.#runs.interruptSelected(ids,stop);await this.groups.interruptActive();}});
  this.#policy = new PolicyService({resolveTool:name=>this.connectors.resolve(name), runtime: this.#runtime, approvals: this.#approvals, workspace: this.#workspace, now: this.#now,change:fn=>this.authority.change(fn),reconcile:()=>this.authority.reconcile() });
		this.#feed = new ConversationFeed({
			deliver: (snapshot) => this.#emit({ type: "conversation.updated", payload: snapshot }),
			...(options.coalesce?.windowMs === undefined ? {} : { windowMs: options.coalesce.windowMs }),
			...(options.coalesce?.timers === undefined ? {} : { timers: options.coalesce.timers }),
		});
		this.connectors=new Connectors({runtime:this.#runtime,targetId:this.#status.targetId,...(options.connectors?{port:options.connectors}:{}),secrets:this.#secrets,approvals:this.#approvals,assertAllowed:()=>this.lifecycle.assertAllowed(),change:fn=>this.authority.change(fn),publish:(defs,available)=>this.#runtime.refreshConnectorTools(defs,available),changed:()=>this.#observation.changed(8)});
  this.skills=new Skills({runtime:this.#runtime,...(options.skills?{port:options.skills}:{}),targetId:this.#status.targetId,assertAllowed:()=>this.lifecycle.assertAllowed(),changed:()=>this.#observation.changed(8)});
 const skillChange=(requestId:string,change:import("@openbot/protocol").SkillChange)=>this.authority.change(async()=>this.skills.change(`desktop:${requestId}`,change,(await this.#runtime.policy().snapshot()).settings.revision));
 this.routines=new Routines({runtime:this.#runtime,runs:this.#runs,approvals:this.#approvals,targetId:this.#status.targetId,canRun:()=>!this.lifecycle.state.blocked,now:this.#now,changed:()=>this.#observation.changed(9),resolveSkills:refs=>this.skills.attachments(refs),changeAuthority:fn=>this.authority.change(fn),settled:this.#toolSettled});
 this.#handlers = {
   "routines.list":()=>this.routines.list(),
   "routines.get":({routineId,occurrenceId})=>this.routines.detail(routineId,occurrenceId),
   "routines.change":params=>this.routines.change(params),
   "routines.test":({routineId,expectedRevision,requestId})=>this.routines.test(routineId,expectedRevision,requestId),
   "routines.stop":({occurrenceId})=>this.routines.stop(occurrenceId),
   "routines.activity":()=>this.routines.activity(),
   "routines.presence":({absenceDays,resume})=>this.routines.presence(absenceDays,resume),
			"background.stop":({invocationId})=>this.background.stop(invocationId),
 "connectors.list":()=>this.connectors.list(),
 "connectors.install":input=>this.connectors.install(input),
 "connectors.connect":input=>this.connectors.connect(input),
 "connectors.disconnect":input=>this.connectors.disconnect(input),
 "connectors.remove":input=>this.connectors.remove(input),
 "connectors.credential.set":input=>this.connectors.credential(input),
 "connectors.credential.delete":input=>this.connectors.credential(input),
 "skills.list":()=>this.skills.list(),
 "skills.get":({name,revision})=>this.skills.get(name,revision),
 "skills.save":({requestId,...change})=>skillChange(requestId,{action:"save",...change}),
 "skills.delete":({requestId,...change})=>skillChange(requestId,{action:"delete",...change}),
			"observation.wait": ({ cursor, waitMs }) => this.#observation.wait(cursor, waitMs),
			"artifacts.import": ({ requestId, path }) => this.#artifact(requestId, { action: "import", path }) as Promise<ArtifactRef>,
			"artifacts.export": ({ requestId, artifactId, path }) =>
				this.#artifact(requestId, { action: "export", artifactId, path }) as Promise<null>,
			"artifacts.remove": ({ requestId, artifactId }) => this.#artifact(requestId, { action: "remove", artifactId }) as Promise<null>,
			"artifacts.get": ({ artifactId }) => this.#artifact(randomUUID(), { action: "get", artifactId }) as Promise<ArtifactRef>,
			"artifacts.preview": ({ artifactId }) => this.#artifact(randomUUID(), { action: "preview", artifactId }) as Promise<ArtifactContent>,
			"lifecycle.get": async () => this.lifecycle.state,
			"lifecycle.pause": () => this.lifecycle.pause(),
			"lifecycle.resume": () => this.lifecycle.resume(),
			"lifecycle.native": (params) => this.lifecycle.native(params),
			"runs.continue": ({ runId, requestId }) => this.#runs.continue(runId, requestId),
			"collaboration.stop": ({ rootId }) => this.groups.stopTree(rootId),
			"groups.list": () => this.#runtime.groups().list(),
			"groups.snapshot": async ({ groupId }) => ({...await this.groups.snapshot(groupId),backgroundTasks:this.background.view(undefined,undefined,groupId)}),
			"groups.change": (change) => this.groups.change(change),
			"groups.send": ({ groupId, requestId, text, recipientIds }) => this.groups.send(groupId, requestId, text, recipientIds),
			"host.status": async () => this.#status,
			"bots.list": () => this.#listBots(),
			"bots.management.history": () => this.management.history(),
			"bots.create": async (params) => {
				const profile = await this.#runtime.createBot({
					botId: `bot_${params.requestId}`,
					name: params.name,
					...(params.role === undefined ? {} : { role: params.role }),
					...(params.instructions === undefined ? {} : { instructions: params.instructions }),
					...(params.model === undefined ? {} : { model: params.model }),
					createdAt: this.#now(),
				});
				await this.#observe(profile.botId);
				this.#emit({ type: "bots.changed", payload: {} });
				return profile;
			},
			"bots.update": async ({ botId, ...change }) => {
				await this.#liveBot(botId);
				const profile = await this.#runtime.updateBot(botId, change);
				this.#emit({ type: "bots.changed", payload: {} });
				return profile;
			},
			"conversations.snapshot": async ({ botId }) => this.#view(await this.#runtime.snapshot(botId)),
			"conversations.search": (input) => this.capabilities.desktopSearch(input),
			"conversations.list": () => this.capabilities.desktopSummaries(),
			"conversations.markRead": async ({ conversationKey, through }) => {
				if (conversationKey.startsWith("bot:")) await this.#liveBot(conversationKey.slice(4));
				else if (!conversationKey.startsWith("group:") || !(await this.#runtime.groups().get(conversationKey.slice(6))))
					throw new ProtocolError("not_found", "Conversation is unavailable");
				if (await this.#runtime.conversationIndex().markRead(conversationKey, through))
					this.#emit({ type: conversationKey.startsWith("bot:") ? "bots.changed" : "groups.changed", payload: {} });
				return null;
			},
			"messages.submit": async ({ botId, requestId, text, artifactIds, skills }) => {
				if (text.trim() === "" && !artifactIds?.length && !skills?.length) throw new ProtocolError("invalid_request", "Message is empty");
				const bot = await this.#liveBot(botId);
				if (bot.model === undefined && (await this.#runtime.defaultModel()) === undefined) {
					throw new ProtocolError("invalid_request", "Choose a model in Settings before messaging a Bot");
				}
				return this.#runs.submit(botId, requestId, text, {...(artifactIds?{artifactIds}:{}),...(skills?{skills}:{})});
			},
			"runs.cancel": async ({ runId }) => ({ state: await this.#runs.cancel(runId) }),
			"approvals.decide": async ({ approvalId, decision }) => {
				if (!(await this.authority.change(()=>this.#approvals.decide(approvalId, decision)))) {
					throw new ProtocolError("not_found", "This request was already answered or its task ended");
				}
				// The new rule or grant may cover other waiting calls too.
				if (typeof decision !== "string") await this.#policy.reevaluate();
				return null;
			},
			"usage.get": ({botId,limit}) => this.#runtime.usage(botId,limit),
			"settings.get": () => this.#settings(),
			"settings.update": async ({ defaultModel, setupComplete, language }) => {
				if (language !== undefined) await this.#runtime.setLanguage(language);
				if (setupComplete !== undefined) await this.#runtime.setSetupComplete(setupComplete);
				if (defaultModel !== undefined) await this.#runtime.setDefaultModel(defaultModel);
				return this.#settings();
			},
			"models.list": async () => {
				await this.#reloadModelConfig();
				return this.#runtime.listChatModels().filter((model) => !model.provider.startsWith(SEARCH_PROVIDER_PREFIX));
			},
			"credentials.status": () => { if (!this.#secrets.status) throw new ProtocolError("host_unavailable", "Credential storage is unavailable"); return this.#secrets.status(); },
			"credentials.migrate": () => { if (!this.#secrets.migrate) throw new ProtocolError("host_unavailable", "Credential storage is unavailable"); return this.#secrets.migrate(); },
			"credentials.set": async ({ providerId, apiKey }) => {
				if (apiKey.trim() === "") throw new ProtocolError("invalid_request", "API key is empty");
				await this.#secrets.setApiKey(providerId, apiKey.trim());
				return this.#settings();
			},
			"credentials.delete": async ({ providerId }) => {
				await this.#secrets.deleteApiKey(providerId);
				return this.#settings();
			},
			"bots.memory.get": ({ botId }) => this.#runtime.memoryState(botId),
			"memory.shared.get": () => this.#runtime.sharedMemory(),
			"memory.shared.update": ({ content, expectedRevision }) => this.#runtime.setSharedMemory(content, expectedRevision),
			"memory.shared.restore": ({ revision, expectedRevision }) => this.#runtime.restoreSharedMemory(revision, expectedRevision),
			"bots.memory.note": (input) => this.#runtime.changeMemoryNote(input),
			"bots.memory.source": ({ botId, scope, noteId, which }) => this.#runtime.memorySource(botId, scope, noteId, which),
			"bots.memory.update": ({ botId, content, expectedRevision }) => this.#runtime.setMemory(botId, content, expectedRevision),
			"bots.memory.restore": ({ botId, revision, expectedRevision }) => this.#runtime.restoreMemory(botId, revision, expectedRevision),
			"conversations.reset": async ({ botId }) => {
                await this.#runs.cancelMatching(run=>run.botId===botId&&(!run.channelId||run.channelId==="direct"));
                await this.background.stopConversation(botId,await this.#runtime.conversationKey(botId));
				await this.#runtime.reset(botId);
				return null;
			},
			"policy.get": () => this.#policy.get(),
 "policy.ask.create":input=>this.#policy.createAsk(input),
 "policy.ask.delete":input=>this.#policy.deleteAsk(input),
 "policy.reconcile":()=>this.#policy.reconcile(),
			"policy.update": (change) => this.#policy.update(change),
			"policy.rules.delete": ({ id }) => this.#policy.deleteRule(id),
			"grants.list": () => this.#policy.grants(),
			"grants.revoke": ({ id }) => this.#policy.revoke(id),
			"grants.add": ({ path, access }) => this.#policy.add(path, access),
			"models.addProvider": (provider) => {
				const next = this.#configWrites
					.catch(() => {})
					.then(async () => {
						await this.#reloadModelConfig();
						const declared = new Set(this.#configStatus.providers.filter((entry) => !entry.overlay).map((entry) => entry.providerId));
						if (this.#runtime.listProviders().some(({ providerId }) => providerId === provider.id && !declared.has(providerId))) {
							throw new ProtocolError("invalid_request", "This is a built-in provider; choose another ID");
						}
						await this.#modelConfig.write(mergeProvider(await this.#modelConfig.read(), provider));
						return this.#settings();
					});
				this.#configWrites = next;
				return next;
			},
			"models.test": async (model) => {
				await this.#reloadModelConfig();
				return this.#runtime.testModel(model);
			},
			"conversations.subscribe": async ({ botId }) => {
				if (botId !== null) await this.#liveBot(botId);
				this.#feed.subscribe(botId);
				return null;
			},
			"bots.duplicate": async ({ botId, requestId }) => {
				const source = await this.#liveBot(botId);
				const profile = await this.#runtime.createBot({
					botId: `bot_${requestId}`,
					name: `${source.name} (copy)`,
					role: source.role,
					instructions: source.instructions,
					...(source.model === undefined ? {} : { model: source.model }),
					...(source.thinkingLevel === undefined ? {} : { thinkingLevel: source.thinkingLevel }),
					createdAt: this.#now(),
				});
				await this.#observe(profile.botId);
				this.#emit({ type: "bots.changed", payload: {} });
				return profile;
			},
			"bots.delete": async ({ botId }) => {
				const bot = await this.#runtime.getBot(botId);
				if (bot === undefined) throw new ProtocolError("not_found", `Unknown Bot: ${botId}`);
				if (bot.kind === "core") throw new ProtocolError("invalid_request", "The Core Bot cannot be deleted");
				if (bot.status === "deleted") return null;
				// Stop its work first, so no Run keeps going for a Bot the user can no longer see. Background commands
				// outlive the Run that started them, so they are stopped whether or not a Run is active.
				await this.#stopBot(botId);
				await this.#runtime.updateBot(botId, { status: "deleted" });
				this.#observers.get(botId)?.stop();
				this.#observers.delete(botId);
				if (this.#feed.subscribed === botId) this.#feed.subscribe(null);
				this.#emit({ type: "bots.changed", payload: {} });
				return null;
			},
			"files.resolveReveal": async ({ path }) => {
				// Reveal only inside folders Bots may use: the workspace and the folder grants.
				const grants = await this.#policy.grants();
				return revealablePath(path, this.#workspace, [this.#workspace, ...grants.map((grant) => grant.path)]);
			},
		};
	}

	async #resolveAttachments(botId: string, ids: readonly string[]): Promise<ArtifactRef[]> {
		if (ids.length > ARTIFACT_LIMITS.count || new Set(ids).size !== ids.length)
			throw new ProtocolError("invalid_request", "Too many or duplicate attachments");
		const refs: ArtifactRef[] = [];
		for (const artifactId of ids) {
			const ref = (await this.#artifact(randomUUID(), { action: "get", artifactId })) as ArtifactRef;
			if (ref.availability !== "available") throw new ProtocolError("invalid_request", "Attachment content is unavailable");
			refs.push(ref);
		}
		if (
			refs.some((ref) => ref.mediaType === "text/html") ||
			refs.reduce((n, ref) => n + ref.bytes, 0) > ARTIFACT_LIMITS.messageBytes ||
			refs.filter((ref) => ref.mediaType.startsWith("text/")).reduce((n, ref) => n + ref.bytes, 0) > ARTIFACT_LIMITS.textBytes
		)
			throw new ProtocolError("invalid_request", "Attachments exceed the message limits");
		if (refs.some((ref) => ref.mediaType.startsWith("image/"))) {
			const bot = await this.#liveBot(botId),
				model = bot.model ?? (await this.#runtime.defaultModel());
			if (!model || !this.#runtime.listChatModels().find((m) => m.provider === model.provider && m.modelId === model.modelId)?.images)
				throw new ProtocolError("invalid_request", "This model does not support image attachments");
		}
		return refs;
	}

	#artifact(requestId: string, operation: ArtifactOperation): Promise<ArtifactOperationResult> {
		if (!this.#artifacts) throw new ProtocolError("invalid_request", "Artifact storage is unavailable");
		return this.#artifacts.request(requestId, operation);
	}

	/**
	 * Load the model configuration and pending approvals, attach observers to every existing Bot, then sweep Runs left
	 * by the last shutdown. Call once after the runtime opened and before it resumes, so approvals from before a
	 * restart show before Pi reruns.
	 */
	async start(): Promise<void> {
		await this.lifecycle.start();
		await this.#reloadModelConfig();
		const at = this.#now();
		await this.#runtime.ensureCoreBot(at);
		try {
			this.#audit({ operationId: randomUUID(), operation: "core.ensure", at, durationMs: this.#now() - at, outcome: "succeeded" });
		} catch {
			/* Keep diagnostics independent of startup. */
		}
		await this.#runtime.policy().bind(this.#status.targetId);
		await this.#approvals.start(this.#runtime.approvals());
 await this.connectors.start();
		for (const bot of await this.#runtime.listBots()) if (bot.status !== "deleted") await this.#observe(bot.botId);
		await this.authority.reconcile();
  await this.routines.prepare();
  await this.#runs.start();
		if (this.lifecycle.state.needsResume) await this.lifecycle.pause("recovery").catch(() => {});
		await this.groups.start();
		await this.background.start();
  await this.routines.start();
		if (!this.lifecycle.state.blocked) this.#runtime.resume();
	}

	/** Call before the runtime closes: the shutdown aborts waiting calls, and their approvals must stay pending. */
	async stop(): Promise<void> {
  await this.routines.close();
		await this.background.close();
 await this.connectors.close();
		this.#observation.close();
		await this.groups.stop();
		this.#approvals.close();
		this.#runs.stop();
		this.#feed.stop();
		for (const observer of this.#observers.values()) observer.stop();
		this.#observers.clear();
	}

	/** Dispatch one validated request. Unknown methods and handler failures surface as `ProtocolError`. */
	async handle<M extends HostMethod>(method: M, params: HostParams<M>): Promise<HostResult<M>> {
		const handler: Handlers[M] | undefined = this.#handlers[method];
		if (handler === undefined) throw new ProtocolError("unknown_method", `Unknown method: ${method}`);
		const at = this.#now();
		let outcome: "succeeded" | "failed" = "failed";
		try {
			const result = await ([
				"bots.create",
				"bots.update",
				"bots.duplicate",
				"bots.delete",
				"messages.submit",
				"groups.change",
				"groups.send",
			].includes(method)
				? this.#serializeBots(() => handler(params))
				: handler(params));
			outcome = method === "models.test" && (result as { ok?: boolean }).ok === false ? "failed" : "succeeded";
			return result;
		} finally {
			if (
				!method.endsWith(".get") &&
				!method.endsWith(".list") &&
				!method.endsWith(".history") &&
				![
					"observation.wait",
					"artifacts.preview",
					"host.status",
					"groups.snapshot",
					"conversations.snapshot",
					"conversations.subscribe",
					"conversations.markRead",
					"conversations.search",
					"files.resolveReveal",
				].includes(method)
			) {
				try {
					if (outcome === "succeeded") this.#observation.changed(8);
					this.#audit({ operationId: randomUUID(), operation: method, at, durationMs: this.#now() - at, outcome });
				} catch {
					/* Diagnostics must not undo a committed action. */
				}
			}
		}
	}

	#serializeBots<T>(work: () => Promise<T>): Promise<T> {
		const result = this.#botChanges.then(work);
		this.#botChanges = result.catch(() => {});
		return result;
	}

	async closeAppManagement(call: ManagementCall) {
		await this.#runtime.closeAppManagement({ ...call, onProgress: () => {} });
	}

	async manageGroups(call: ManagementCall) {
		return this.#serializeBots(() => this.groups.manage(call));
	}

	async manageBots(call: ManagementCall): Promise<{ status: "succeeded" | "failed"; output: string }> {
		return this.#serializeBots(async () => {
			try {
				if (legacyManagementName(call.tool) === "bot_inspect") {
					const decision = await this.management.prepare(call);
					if (decision.kind === "deny") throw new ProtocolError("invalid_request", decision.reason);
					const bots = (await this.#runtime.listBots()).filter(
						(b) => b.status !== "deleted" && (call.args.botId == null || call.args.botId === b.botId),
					);
					const profiles = call.args.botId == null ? bots.map(({ instructions: _instructions, ...summary }) => summary) : bots;
					return { status: "succeeded", output: JSON.stringify(profiles) };
				}
				const proposal = await this.management.confirmed(call);
				const saved = await this.#runtime.management().get(proposal.invocationId);
				let result = saved?.result;
				if (!result) {
					if (proposal.action === "delete") {
						await this.#stopBot(proposal.botId);
					}
					call.signal.throwIfAborted();
					await this.management.confirmed(call);
					if (proposal.action === "create") {
						const { model, ...fields } = proposal.change;
						result = await this.#runtime.createBot(
							{ ...fields, name: proposal.change.name!, botId: proposal.botId, createdAt: proposal.createdAt, ...(model ? { model } : {}) },
							proposal,
						);
					} else
						result = await this.#runtime.updateBot(
							proposal.botId,
							proposal.action === "delete" ? { status: "deleted" } : proposal.change,
							proposal,
						);
				}
				if (result.status === "deleted") {
					this.#observers.get(result.botId)?.stop();
					this.#observers.delete(result.botId);
					if (this.#feed.subscribed === result.botId) this.#feed.subscribe(null);
				} else await this.#observe(result.botId);
				this.#emit({ type: "bots.changed", payload: {} });
				return { status: "succeeded", output: JSON.stringify({ action: proposal.action, bot: result }) };
			} catch (error) {
				if (call.signal.aborted) throw error;
				return {
					status: "failed",
					output: error instanceof ProtocolError ? error.message : "Bot management failed. Inspect the current state before trying again.",
				};
			}
		});
	}

	async #listBots(): Promise<BotSummary[]> {
		const bots = await this.#runtime.listBots();
		const index = new Map((await this.#runtime.conversationIndex().list()).map((row) => [row.conversationKey, row]));
		return bots
			.filter((bot) => bot.status !== "deleted")
			.map((bot) => {
				const lastRun = this.#runs.latest(bot.botId);
				const activity = this.#observers.get(bot.botId)?.activity ?? "idle";
				return {
					...bot,
					activity: activity === "idle" && (index.get(`bot:${bot.botId}`)?.unreadCount ?? 0) > 0 ? ("unread" as const) : activity,
					pendingApprovals: this.#approvals.forBot(bot.botId).length,
					...(lastRun === undefined
						? {}
						: {
								lastRun: { runId: lastRun.runId, state: lastRun.state, ...(lastRun.error === undefined ? {} : { error: lastRun.error }) },
							}),
				};
			});
	}

	async #stopBot(botId: BotId): Promise<void> {
		await this.#runs.cancelMatching((run) => run.botId === botId);
		this.#conversationStopped(botId);
		for (const channel of await this.#runtime.channels()) if (channel.botId === botId) this.#conversationStopped(botId, channel.channelId);
	}

	/** A Bot the user can still see; a deleted one is unknown to every method that acts on it. */
	async #liveBot(botId: BotId): Promise<BotProfile> {
		const bot = await this.#runtime.getBot(botId);
		if (bot === undefined || bot.status === "deleted") throw new ProtocolError("not_found", `Unknown Bot: ${botId}`);
		return bot;
	}

	async #settings(): Promise<RedactedSettings> {
		await this.#reloadModelConfig();
		const stored = await this.#secrets.configuredProviders();
		const fromConfig = new Map(this.#configStatus.providers.map((provider) => [provider.providerId, provider]));
		const defaultModel = await this.#runtime.defaultModel();
		return {
			setupComplete: await this.#runtime.setupComplete(),
			language: await this.#runtime.language(),
			...(defaultModel === undefined ? {} : { defaultModel }),
			providers: this.#runtime
				.listProviders()
				.filter(({ providerId }) => !providerId.startsWith(SEARCH_PROVIDER_PREFIX) && !providerId.startsWith(CONNECTOR_CREDENTIAL_PREFIX))
				.map(({ providerId, name }) => {
					const configured = fromConfig.get(providerId);
					const keyStored = stored.has(providerId);
					// An overlay without its own `apiKey` still needs a stored key: the Host clears provider variables.
					const keyFromConfig = configured?.keyAvailable === true && !(configured.overlay && !configured.keyConfigured);
					return {
						providerId,
						name,
						source: configured === undefined ? ("builtin" as const) : ("config" as const),
						overlay: configured?.overlay ?? false,
						configured: keyStored || keyFromConfig,
						keyStored,
					};
				}),
			dataDirectory: this.#dataDirectory,
			modelConfig: { path: this.#modelConfig.path, errors: this.#configStatus.errors },
			workspace: this.#workspace,
			webSearch: { provider: "tavily", configured: stored.has(TAVILY_PROVIDER_ID) },
		};
	}

	/** Re-read the model configuration so edits apply without restarting; cheap enough to run on every settings read. */
	async #reloadModelConfig(): Promise<void> {
		let text: string | undefined;
		try {
			text = await this.#modelConfig.read();
		} catch (error) {
			this.#runtime.reloadConfiguredProviders(undefined, this.#modelConfig.environment);
			this.#configStatus = { providers: [], errors: [error instanceof Error ? error.message : String(error)] };
			return;
		}
		this.#configStatus = this.#runtime.reloadConfiguredProviders(text, this.#modelConfig.environment);
	}

	/** Republish a Bot's conversation after its pending approvals changed. Wire to the `ApprovalBook` callback. */
	approvalsChanged(botId: BotId): void {
		this.#republish(botId);
	}

	#republish(botId: BotId): void {
		const state = this.#observers.get(botId);
		if (state?.last !== undefined) this.#publish(botId, state, state.last);
	}

	/** The runtime's snapshot with what the Host adds: pending approvals and the Bot's current Run. */
	#view(snapshot: ConversationSnapshot): ConversationSnapshot {
		return {...this.#withRun(this.#withApprovals(snapshot)),backgroundTasks:this.background.view(snapshot.botId,snapshot.conversationId)};
	}

	#withApprovals(snapshot: ConversationSnapshot): ConversationSnapshot {
		const approvals = this.#approvals.forBot(snapshot.botId, snapshot.conversationId);
		if (approvals.length === 0) return snapshot;
		const live = snapshot.live === undefined ? undefined : { ...snapshot.live, state: "waiting_approval" as const };
		return { ...snapshot, approvals, ...(live === undefined ? {} : { live }) };
	}

	/** A queued Run's messages are not in Pi yet; they show as pending until the Run starts. */
	#withRun(snapshot: ConversationSnapshot): ConversationSnapshot {
		const stored = this.#runs.active(snapshot.botId, snapshot.channelId) ?? this.#runs.attention(snapshot.botId, snapshot.channelId);
		if (stored === undefined) return snapshot;
		const { messages, inputs: _inputs, ...run } = stored;
		if (run.state !== "queued") return { ...snapshot, run };
		const queued = messages.map(({ requestId, text, attachments, skills }) => ({
			id: requestId,
            ...(stored.origin==="background"?{source:"background" as const}:{}),
			parts: [{ type: "text" as const, text }],
			...(attachments ? { attachments } : {}),
 ...(skills?{skills:skills.map(({name,revision,sha256})=>({name,revision,sha256}))}:{}),
		}));
		return { ...snapshot, run, pending: [...(snapshot.pending ?? []), ...queued] };
	}

	#publish(botId: BotId, state: ObserverState, snapshot: ConversationSnapshot): void {
		state.last = snapshot;
		const view = this.#view(snapshot);
		const before = state.activity;
		state.activity = nextActivity(view);
		// The roster also carries the approval count and the latest Run, which Desktop main turns into the dock badge,
		// notifications, and the power assertion.
		const latest = this.#runs.latest(botId);
		const message = view.items.findLast(
			(item) => (item.kind === "user" || item.kind === "assistant") && item.parts.some((p) => p.text.trim()),
		);
		const roster = `${view.approvals.length}|${latest?.runId ?? ""}|${latest?.state ?? ""}|${message?.id ?? ""}|${view.readCursor ?? 0}`;
		if (state.activity !== before || roster !== state.roster) this.#emit({ type: "bots.changed", payload: {} });
		state.roster = roster;
		this.#feed.publish(view);
		for (const item of snapshot.items) {
			if (item.kind === "tool" && item.execution)
				for (const child of item.execution.children) {
					if (child.state === "running" || state.settled.has(child.callId)) continue;
					state.settled.add(child.callId);
					if (child.capability.startsWith("app_groups_")) void this.groups.settled(botId, child.callId, child.state).catch(() => {});
					if (child.capability.startsWith("app_bots_")) void this.management.settled(botId, child.callId, child.state).catch(() => {});
					this.#toolSettled(botId, child.callId, snapshot.conversationId);
				}
			if (item.kind !== "tool" || item.status === "pending" || item.status === "running" || state.settled.has(item.id)) continue;
			state.settled.add(item.id);
			if (item.tool.startsWith("group_")) void this.groups.settled(botId, item.id, item.status).catch(() => {});
			if (["bot_create", "bot_update", "bot_delete"].includes(item.tool))
				void this.management.settled(botId, item.id, item.status).catch(() => {});
			this.#toolSettled(botId, item.id, snapshot.conversationId);
		}
	}

	async #observe(botId: BotId): Promise<void> {
		if (this.#observers.has(botId)) return;
		const state: ObserverState = { stop: () => {}, activity: "idle", settled: new Set() };
		this.#observers.set(botId, state);
		state.stop = await this.#runtime.observe(botId, (snapshot) => this.#publish(botId, state, snapshot));
	}
}

type ObserverState = {
	stop: () => void;
	activity: BotActivity;
	/** Tool calls whose result this observer has seen, so `toolSettled` runs once per call. */
	readonly settled: Set<string>;
	last?: ConversationSnapshot;
	/** Approval count and latest Run last announced with `bots.changed`. */
	roster?: string;
};

/** Live attention is separate from the durable unread cursor used by the roster. */
function nextActivity(snapshot: ConversationSnapshot): BotActivity {
	if (snapshot.approvals.length > 0 || snapshot.run?.state==="needs_attention") return "needs_attention";
	const sinceUser = snapshot.items.slice(snapshot.items.findLastIndex((item) => item.kind === "user") + 1);
	if (sinceUser.some((item) => item.kind === "tool" && item.status === "interrupted")) return "needs_attention";
	if (snapshot.live !== undefined) return "working";
	if (snapshot.run?.state === "queued") return "queued";
	return "idle";
}

/** In-memory `SecretStore` for tests and development without a Keychain. */
export class MemorySecretStore implements SecretStore {
	readonly #keys = new Map<string, string>();

	async configuredProviders(): Promise<ReadonlySet<string>> {
		return new Set(this.#keys.keys());
	}

	async setApiKey(providerId: string, apiKey: string): Promise<void> {
		this.#keys.set(providerId, apiKey);
	}

	async deleteApiKey(providerId: string): Promise<void> {
		this.#keys.delete(providerId);
	}

	async getApiKey(providerId: string): Promise<string | undefined> {
		return this.#keys.get(providerId);
	}
}

export const newRequestId = (): string => randomUUID();

export type { HostMethods };
export { ApprovalBook, decide, type Decision, type PolicyCall, type PolicySnapshot } from "./approvals.ts";
export { DEFAULT_MAX_ACTIVE_RUNS, RunScheduler, type RunSchedulerOptions, type SubmitOutcome } from "./runs.ts";
export { lexCommand, renderPart } from "./command-lexer.ts";
export { canonicalPath, isWithin, loadPolicy } from "./policy.ts";
export { createWebFetch, type RetrievalOutcome, type WebFetchOptions } from "./web-fetch.ts";
export {
	createWebSearch,
	SEARCH_PROVIDER_PREFIX,
	type SearchProvider,
	type SearchResult,
	TAVILY_PROVIDER_ID,
	TavilySearch,
	WEB_SEARCH_NOT_CONFIGURED,
	type WebSearchOptions,
	type WebToolHandler,
} from "./web-search.ts";
export { memoryUpdate } from "./memory-tool.ts";
export { Coalescer, COALESCE_WINDOW_MS, type Timers } from "./coalescer.ts";
export { ConversationFeed, type ConversationFeedOptions } from "./conversation-feed.ts";
