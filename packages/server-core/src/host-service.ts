import { LocalTasks } from "./local-tasks.ts";
import { BotMessages } from "./messages.ts";
import { BotTemplates } from "./templates.ts";
import { paramsError } from "@openbot/protocol/schemas";
import { TEMPLATE_LIMITS, templateIpcSize } from "@openbot/protocol";
import type { ReaderFile, FileListing, ArtifactListing } from "@openbot/protocol";
import type { AvatarSource } from "@openbot/protocol";
import { Routines } from "./routines.ts";
import { Connectors } from "./connectors.ts";
import { BackgroundTasks } from "./background.ts";
import { Skills } from "./skills.ts";
import { Observation } from "./observation.ts";
import { ARTIFACT_LIMITS } from "@openbot/protocol";
import type { ArtifactRef, ArtifactContent, ArtifactOperation, ArtifactOperationResult } from "@openbot/protocol";
import { AuthorityCoordinator } from "./authority.ts";
import { LifecycleController } from "./lifecycle.ts";
import { AppCapabilities } from "./app-capabilities.ts";
import { randomUUID } from "node:crypto";
import type { BotRuntime, ModelConfigStatus } from "@openbot/agent-runtime";
import type { ApprovalBook } from "./approvals.ts";
import { Groups } from "./groups.ts";
import { BotManagement, type ManagementCall } from "./bot-management.ts";
import { PolicyService } from "./policy-service.ts";
import { ConversationFeed } from "./conversation-feed.ts";
import { revealablePath } from "./reveal.ts";
import { DEFAULT_MAX_ACTIVE_RUNS, RunScheduler } from "./runs.ts";
import {
	type BotId,
	type BotProfile,
	type HostMethod,
	type HostParams,
	type HostResult,
	type HostStatus,
	ProtocolError,
} from "@openbot/protocol";
import {
	createHostBot,
	deleteHostBot,
	duplicateHostBot,
	listHostBots,
	liveHostBot,
	manageHostBots,
	updateHostBot,
} from "./host-bots.ts";
import type { ObserverState } from "./host-conversations.ts";
import {
	deleteConversation,
	directSnapshot,
	markConversationRead,
	observeBot,
	reopenConversation,
	republishConversation,
	resetConversation,
	submitMessage,
	subscribeConversation,
} from "./host-conversations.ts";
import type { ArtifactPort, EventSink, HostServiceOptions, ModelConfigFile, OperationAudit, SecretStore } from "./host-ports.ts";
import {
	addModelProvider,
	credentialStatus,
	deleteCredential,
	listModels,
	migrateCredentials,
	redactedSettings,
	reloadModelConfig,
	setCredential,
	testModel,
	updateSettings,
} from "./host-settings.ts";

type Handlers = { [M in HostMethod]: (params: HostParams<M>) => Promise<HostResult<M>> };

export class HostService {
 readonly tasks: LocalTasks;
 readonly messages: BotMessages;
 observeExecution(call: { runId?: string; conversationId: string; callId: string; tool: string; args: Readonly<Record<string, unknown>> }, phase: "preparing" | "dispatching" | "settled") { if (call.runId && this.#runs.isRunning(call.runId)) this.#runtime.execution.dispatch(call, phase); else if (call.runId) this.#runtime.execution.clear(call.runId); }
 #templateOperations=0;
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
 #stopHistory:(()=>void)|undefined;
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
   taskChanged:()=>{this.#observation.changed(1);void this.tasks?.changed();},
   taskPreparing:(runId,work)=>this.tasks.preparing(runId,work),
   taskInput:(run,submit)=>this.authority.change(async()=>{this.lifecycle.assertAllowed();await this.#runtime.tasks().assertRun(run.runId);return submit();}),
			now: this.#now,
			stopping: (botId, channelId, runId) => this.#conversationStopped(botId, channelId, runId),
			admissible: async (run) => await this.tasks.admissible(run) && await this.groups.admissible(run) && await this.background.admissible(run) && await this.routines.admissible(run),
		});
		this.groups = new Groups({
			canRun: () => !this.lifecycle.state.blocked,
			runtime: this.#runtime,
			authority: this.management,
			runs: this.#runs,
			approvals: this.#approvals,
			changed: () => { this.#emit({ type: "groups.changed", payload: {} }); this.#observation.changed(8); },
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
		this.authority=new AuthorityCoordinator({resolveTool:name=>this.connectors.resolve(name),assertCall:async call=>{await this.tasks.assertExecution(call);await this.connectors.assertExecution(call);await this.routines.assertExecution(call);},dataDirectory:this.#dataDirectory,runtime:this.#runtime,workspace:this.#workspace,targetId:this.#status.targetId,approvals:this.#approvals,executor:options.authorityExecutor??{synchronize:async()=>{},revoke:async()=>{}},interrupt:async(ids,stop)=>{await this.#runs.interruptSelected(ids,stop);await this.groups.interruptActive();}});
  this.#policy = new PolicyService({resolveTool:name=>this.connectors.resolve(name), runtime: this.#runtime, approvals: this.#approvals, workspace: this.#workspace, now: this.#now,change:fn=>this.authority.change(fn),reconcile:()=>this.authority.reconcile() });
		this.#feed = new ConversationFeed({
			deliver: (snapshot) => this.#emit({ type: "conversation.updated", payload: snapshot }),
			...(options.coalesce?.windowMs === undefined ? {} : { windowMs: options.coalesce.windowMs }),
			...(options.coalesce?.timers === undefined ? {} : { timers: options.coalesce.timers }),
		});
		this.connectors=new Connectors({runtime:this.#runtime,targetId:this.#status.targetId,...(options.connectors?{port:options.connectors}:{}),secrets:this.#secrets,approvals:this.#approvals,assertAllowed:()=>this.lifecycle.assertAllowed(),change:fn=>this.authority.change(fn),publish:(defs,available)=>this.#runtime.refreshConnectorTools(defs,available),changed:()=>this.#observation.changed(8)});
  this.skills=new Skills({runtime:this.#runtime,...(options.skills?{port:options.skills}:{}),targetId:this.#status.targetId,assertAllowed:()=>this.lifecycle.assertAllowed(),changed:()=>this.#observation.changed(8)});
 const skillChange=(requestId:string,change:import("@openbot/protocol").SkillChange)=>this.authority.change(async()=>this.skills.change(`desktop:${requestId}`,change,(await this.#runtime.policy().snapshot()).settings.revision));
 this.routines=new Routines({runtime:this.#runtime,runs:this.#runs,approvals:this.#approvals,targetId:this.#status.targetId,canRun:()=>!this.lifecycle.state.blocked,now:this.#now,changed:()=>this.#observation.changed(11),resolveSkills:refs=>this.skills.attachments(refs),changeAuthority:fn=>this.authority.change(fn),settled:this.#toolSettled});
 this.tasks=new LocalTasks({runtime:this.#runtime,runs:this.#runs,authority:this.authority,...(options.authorityExecutor?{executor:options.authorityExecutor}:{}),approvals:this.#approvals,workspace:this.#workspace,targetId:this.#status.targetId,cap:options.maxActiveRuns??DEFAULT_MAX_ACTIVE_RUNS,now:this.#now,paused:()=>this.lifecycle.state.blocked,changed:()=>this.#observation.changed(1),resolveAttachments:(botId,ids)=>this.#resolveAttachments(botId,ids),resolveSkills:refs=>this.skills.attachments(refs)});
 this.messages = new BotMessages({ runtime: this.#runtime, targetId: this.#status.targetId, assertAllowed: () => this.lifecycle.assertAllowed(), assertContext: async call => { await this.tasks.assertExecution(call);await this.background.assertExecution(call); const gate = await this.groups.executionGate(call); if (gate?.kind === "deny") throw new ProtocolError("invalid_request", gate.reason); } });
		const templates = new BotTemplates({
			runtime: this.#runtime,
			skills: this.skills,
			reloadModels: async () =>
				new Set((await this.#settings()).providers.filter((p) => p.configured).map((p) => p.providerId)),
			artifact: (id, op) => this.#artifact(id, op),
			now: this.#now,
			changed: async (botId) => {
				this.#emit({ type: "bots.changed", payload: {} });
				await this.#observe(botId);
			},
		});


 this.#handlers = {
   "tasks.create":input=>this.tasks.create(input),
   "tasks.submit":input=>this.tasks.submit(input),
   "tasks.stop":input=>this.tasks.stop(input),
   "tasks.archive":input=>this.tasks.archive(input),
   "tasks.list":input=>this.tasks.list(input),
   "tasks.get":({taskId})=>this.tasks.get(taskId),
  "bots.templates.export":({botId,expectedRevision})=>templates.export(botId,expectedRevision),
  "bots.templates.inspect":({template})=>templates.inspect(template),
  "bots.templates.import":input=>templates.import(input),
  "bots.templates.status":({requestId})=>this.#runtime.templateStatus(requestId),
  "templates.file.read":({path})=>templates.read(path),
  "templates.file.write":input=>templates.write(input),
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
			"files.list": ({path}) => this.#artifact(randomUUID(), {action:"files-list",path}) as Promise<FileListing>,
			"files.read": ({path}) => this.#artifact(randomUUID(), {action:"files-read",path}) as Promise<ReaderFile>,
			"files.open": ({path}) => this.#artifact(randomUUID(), {action:"file-open",path}) as Promise<ReaderFile>,
			"artifacts.list": (params) => this.#artifact(randomUUID(), {action:"list",...params}) as Promise<ArtifactListing>,
			"artifacts.read": ({artifactId}) => this.#artifact(randomUUID(), {action:"read",artifactId}) as Promise<ArtifactContent>,
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
			"groups.snapshot": async ({ groupId, history }) => ({...await this.groups.snapshot(groupId,history),backgroundTasks:this.background.view(undefined,undefined,groupId)}),
			"groups.change": (change) => this.groups.change(change),
			"groups.send": ({ groupId, requestId, text, recipientIds }) => this.groups.send(groupId, requestId, text, recipientIds),
			"host.status": async () => this.#status,
			"bots.list": () => listHostBots(this.#actions()),
			"avatars.source": ({ path }) => this.#artifact(randomUUID(), { action: "avatar-source", path }) as Promise<AvatarSource>,
			"bots.avatar.get": async ({ botId }) => { await this.#liveBot(botId); return this.#runtime.avatarImage(botId); },
			"bots.management.history": () => this.management.history(),
			"bots.create": (params) => createHostBot(this.#actions(), params),
			"bots.update": (params) => updateHostBot(this.#actions(), params),
			"conversations.snapshot": (params) => directSnapshot(this.#actions(), params),
   "conversations.window": input=>this.#runtime.historyWindow(input),
   "conversations.detail": input=>this.#runtime.historyDetail(input),
   "conversations.indexStatus": async ()=>this.#runtime.historyStatus(),
   "conversations.indexRetry": ()=>this.#runtime.retryHistory(),
			"conversations.search": (input) => this.capabilities.desktopSearch(input),
			"conversations.list": () => this.capabilities.desktopSummaries(),
			"conversations.markRead": (params) => markConversationRead(this.#actions(), params),
			"messages.submit": (params) => submitMessage(this.#actions(), params),
			"runs.cancel": async ({ runId }) => ({ state: await this.#runs.cancel(runId) }),
			"approvals.list": ({ conversationId }) => this.#approvals.decisions(conversationId),
			"approvals.decide": async ({ approvalId, decision }) => {
				if (!(await this.authority.change(()=>this.#approvals.decide(approvalId, decision)))) {
					throw new ProtocolError("not_found", "This request was already answered or its task ended");
				}
				// The new rule or grant may cover other waiting calls too.
				if (typeof decision !== "string") await this.#policy.reevaluate();
				return null;
			},
			"usage.get": ({botId,limit}) => this.#runtime.usage(botId,limit),
			"settings.get": () => redactedSettings(this.#actions()),
			"settings.update": (params) => updateSettings(this.#actions(), params),
			"models.list": () => listModels(this.#actions()),
			"credentials.status": () => credentialStatus(this.#secrets),
			"credentials.migrate": () => migrateCredentials(this.#secrets),
			"credentials.set": (params) => setCredential(this.#actions(), params),
			"credentials.delete": (params) => deleteCredential(this.#actions(), params),
			"bots.memory.get": ({ botId }) => this.#runtime.memoryState(botId),
			"memory.shared.get": () => this.#runtime.sharedMemory(),
			"memory.shared.update": ({ content, expectedRevision }) => this.#runtime.setSharedMemory(content, expectedRevision),
			"memory.shared.restore": ({ revision, expectedRevision }) => this.#runtime.restoreSharedMemory(revision, expectedRevision),
			"bots.memory.note": (input) => this.#runtime.changeMemoryNote(input),
			"bots.memory.source": ({ botId, scope, noteId, which }) => this.#runtime.memorySource(botId, scope, noteId, which),
			"bots.memory.update": ({ botId, content, expectedRevision }) => this.#runtime.setMemory(botId, content, expectedRevision),
			"bots.memory.restore": ({ botId, revision, expectedRevision }) => this.#runtime.restoreMemory(botId, revision, expectedRevision),
			"conversations.reset": (params) => resetConversation(this.#actions(), params),
			"conversations.delete": (params) => deleteConversation(this.#actions(), params),
			"conversations.reopen": (params) => reopenConversation(this.#actions(), params),
			"policy.get": () => this.#policy.get(),
 "policy.ask.create":input=>this.#policy.createAsk(input),
 "policy.ask.delete":input=>this.#policy.deleteAsk(input),
 "policy.reconcile":()=>this.#policy.reconcile(),
			"policy.update": (change) => this.#policy.update(change),
			"policy.rules.delete": ({ id }) => this.#policy.deleteRule(id),
			"grants.list": () => this.#policy.grants(),
			"grants.revoke": ({ id }) => this.#policy.revoke(id),
			"grants.add": ({ path, access }) => this.#policy.add(path, access),
			"models.addProvider": (provider) => addModelProvider(this.#actions(), provider),
			"models.test": (params) => testModel(this.#actions(), params),
			"conversations.subscribe": (params) => subscribeConversation(this.#actions(), params),
			"bots.duplicate": (params) => duplicateHostBot(this.#actions(), params),
			"bots.delete": (params) => deleteHostBot(this.#actions(), params),
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
  const historyStop=this.#runtime.onHistoryChanged(()=>{this.#observation.changed(7);void this.tasks.changed();});
  const taskActivity=()=>this.#observation.changed(1);this.#runtime.execution.changes.add(taskActivity);
  this.#stopHistory=()=>{historyStop();this.#runtime.execution.changes.delete(taskActivity);};
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
  await this.tasks.changed();
		if (this.lifecycle.state.needsResume && !this.lifecycle.state.autoResume) await this.lifecycle.pause("recovery").catch(() => {});
		await this.groups.start();
		await this.background.start();
  await this.routines.start();
		if (!this.lifecycle.state.blocked) this.#runtime.resume();
	}

	/** Call before the runtime closes: the shutdown aborts waiting calls, and their approvals must stay pending. */
	async stop(): Promise<void> {
 this.#stopHistory?.();
 await this.tasks.close();
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
  const templateOperation=method.startsWith("bots.templates.")||method.startsWith("templates.file.");
  if(templateOperation) {
   if(paramsError(method,params)) throw new ProtocolError("invalid_request","Invalid Bot template or import choices");
   if(this.#templateOperations>=TEMPLATE_LIMITS.operations) throw new ProtocolError("invalid_request","Too many template operations; try again");
   this.#templateOperations++;
  }
		const at = this.#now();
		let outcome: "succeeded" | "failed" = "failed";
		try {
			const result = await ([
				"bots.templates.import",
				"bots.create",
				"bots.update",
				"bots.duplicate",
				"bots.delete",
				"conversations.delete",
				"conversations.reopen",
				"messages.submit",
				"groups.change",
				"groups.send",
			].includes(method)
				? this.#serializeBots(() => handler(params))
				: handler(params));
   if(templateOperation&&!templateIpcSize(result)) throw new ProtocolError("invalid_request","Bot template exceeds the IPC limit");
			outcome = method === "models.test" && (result as { ok?: boolean }).ok === false ? "failed" : "succeeded";
			return result;
		} finally {
   if(templateOperation)this.#templateOperations--;
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
		return manageHostBots(this.#actions(), call);
	}

 async admitTaskDispatch(invocation:import("@openbot/protocol").ToolInvocation,signal:AbortSignal,send:()=>void):Promise<void>{
  const run=invocation.runId?await this.#runtime.runsStore().get(invocation.runId):undefined;
  const channel=(await this.#runtime.channels()).find(c=>String(c.conversationId)===invocation.conversationId);
  if(channel?.kind!=="task" && !run?.taskId && run?.origin!=="task"){signal.throwIfAborted();send();return;}
  await this.authority.change(async()=>{
   this.lifecycle.assertAllowed();
   if(invocation.target.kind!=="local" || invocation.target.targetId!==this.#status.targetId || invocation.authorityRevision!==(await this.#runtime.policy().settings()).revision)throw new ProtocolError("permission_revoked","Task authority changed before dispatch");
   const rejection=await this.#approvals.rejection(`approval:${invocation.invocationId}`);if(rejection)throw new ProtocolError("permission_revoked",rejection);
   await this.tasks.assertExecution({...invocation,tool:invocation.tool,args:invocation.args});
   signal.throwIfAborted();send();
  });
 }
	/** A Bot the user can still see; a deleted one is unknown to every method that acts on it. */
	async #liveBot(botId: BotId): Promise<BotProfile> {
		return liveHostBot(this.#runtime, botId);
	}

	async #settings() {
		return redactedSettings(this.#actions());
	}

	/** Re-read the model configuration so edits apply without restarting; cheap enough to run on every settings read. */
	async #reloadModelConfig(): Promise<void> {
		return reloadModelConfig(this.#actions());
	}

	/** Republish a Bot's conversation after its pending approvals changed. Wire to the `ApprovalBook` callback. */
	approvalsChanged(botId: BotId): void {
		this.#republish(botId);
	}

	#republish(botId: BotId): void {
		republishConversation(this.#actions(), botId);
	}

	async #observe(botId: BotId): Promise<void> {
		return observeBot(this.#actions(), botId);
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
