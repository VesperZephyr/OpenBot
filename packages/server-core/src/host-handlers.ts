import { randomUUID } from "node:crypto";
import type { BotRuntime } from "@openbot/agent-runtime";
import {
	type ArtifactContent,
	type ArtifactListing,
	type ArtifactOperation,
	type ArtifactOperationResult,
	type ArtifactRef,
	type AvatarSource,
	type BotId,
	type BotProfile,
	type FileListing,
	type HostStatus,
	type ReaderFile,
	type SkillChange,
	ProtocolError,
} from "@openbot/protocol";
import type { AppCapabilities } from "./app-capabilities.ts";
import type { ApprovalBook } from "./approvals.ts";
import type { AuthorityCoordinator } from "./authority.ts";
import type { BackgroundTasks } from "./background.ts";
import type { BotManagement } from "./bot-management.ts";
import type { Connectors } from "./connectors.ts";
import type { Groups } from "./groups.ts";
import type { BotHost } from "./host-bots.ts";
import {
	createHostBot,
	deleteHostBot,
	duplicateHostBot,
	listHostBots,
	updateHostBot,
} from "./host-bots.ts";
import type { ConversationHost } from "./host-conversations.ts";
import {
	deleteConversation,
	directSnapshot,
	markConversationRead,
	reopenConversation,
	resetConversation,
	submitMessage,
	subscribeConversation,
} from "./host-conversations.ts";
import type { HostHandlers } from "./host-dispatch.ts";
import type { SettingsHost } from "./host-settings.ts";
import {
	addModelProvider,
	credentialStatus,
	deleteCredential,
	listModels,
	migrateCredentials,
	redactedSettings,
	setCredential,
	testModel,
	updateSettings,
} from "./host-settings.ts";
import type { LifecycleController } from "./lifecycle.ts";
import type { LocalTasks } from "./local-tasks.ts";
import type { Observation } from "./observation.ts";
import type { PolicyService } from "./policy-service.ts";
import { revealablePath } from "./reveal.ts";
import type { Routines } from "./routines.ts";
import type { RunScheduler } from "./runs.ts";
import type { Skills } from "./skills.ts";
import { BotTemplates } from "./templates.ts";
import type { EventSink } from "./host-ports.ts";

export type HandlerHost = {
	readonly tasks: LocalTasks;
	readonly routines: Routines;
	readonly background: BackgroundTasks;
	readonly connectors: Connectors;
	readonly skills: Skills;
	readonly observation: Observation;
	readonly lifecycle: LifecycleController;
	readonly runs: RunScheduler;
	readonly groups: Groups;
	readonly runtime: BotRuntime;
	readonly capabilities: AppCapabilities;
	readonly management: BotManagement;
	readonly authority: AuthorityCoordinator;
	readonly approvals: ApprovalBook;
	readonly policy: PolicyService;
	readonly status: HostStatus;
	readonly workspace: string;
	artifact(requestId: string, operation: ArtifactOperation): Promise<ArtifactOperationResult>;
	liveBot(botId: BotId): Promise<BotProfile>;
	actions(): BotHost & ConversationHost & SettingsHost;
	now(): number;
	emit: EventSink;
	observe(botId: BotId): Promise<void>;
};

export function createHostHandlers(host: HandlerHost): HostHandlers {
	const templates = new BotTemplates({
		runtime: host.runtime,
		skills: host.skills,
		reloadModels: async () =>
			new Set(
				(await redactedSettings(host.actions())).providers.filter((provider) => provider.configured).map((provider) => provider.providerId),
			),
		artifact: (id, operation) => host.artifact(id, operation),
		now: () => host.now(),
		changed: async (botId) => {
			host.emit({ type: "bots.changed", payload: {} });
			await host.observe(botId);
		},
	});
	const skillChange = (requestId: string, change: SkillChange) =>
		host.authority.change(async () =>
			host.skills.change(`desktop:${requestId}`, change, (await host.runtime.policy().snapshot()).settings.revision),
		);
	return {
		"tasks.create": (input) => host.tasks.create(input),
		"tasks.submit": (input) => host.tasks.submit(input),
		"tasks.stop": (input) => host.tasks.stop(input),
		"tasks.archive": (input) => host.tasks.archive(input),
		"tasks.list": (input) => host.tasks.list(input),
		"tasks.get": ({ taskId }) => host.tasks.get(taskId),
		"bots.templates.export": ({ botId, expectedRevision }) => templates.export(botId, expectedRevision),
		"bots.templates.inspect": ({ template }) => templates.inspect(template),
		"bots.templates.import": (input) => templates.import(input),
		"bots.templates.status": ({ requestId }) => host.runtime.templateStatus(requestId),
		"templates.file.read": ({ path }) => templates.read(path),
		"templates.file.write": (input) => templates.write(input),
		"routines.list": () => host.routines.list(),
		"routines.get": ({ routineId, occurrenceId }) => host.routines.detail(routineId, occurrenceId),
		"routines.change": (params) => host.routines.change(params),
		"routines.test": ({ routineId, expectedRevision, requestId }) => host.routines.test(routineId, expectedRevision, requestId),
		"routines.stop": ({ occurrenceId }) => host.routines.stop(occurrenceId),
		"routines.activity": () => host.routines.activity(),
		"routines.presence": ({ absenceDays, resume }) => host.routines.presence(absenceDays, resume),
		"background.stop": ({ invocationId }) => host.background.stop(invocationId),
		"connectors.list": () => host.connectors.list(),
		"connectors.install": (input) => host.connectors.install(input),
		"connectors.connect": (input) => host.connectors.connect(input),
		"connectors.disconnect": (input) => host.connectors.disconnect(input),
		"connectors.remove": (input) => host.connectors.remove(input),
		"connectors.credential.set": (input) => host.connectors.credential(input),
		"connectors.credential.delete": (input) => host.connectors.credential(input),
		"skills.list": () => host.skills.list(),
		"skills.get": ({ name, revision }) => host.skills.get(name, revision),
		"skills.save": ({ requestId, ...change }) => skillChange(requestId, { action: "save", ...change }),
		"skills.delete": ({ requestId, ...change }) => skillChange(requestId, { action: "delete", ...change }),
		"observation.wait": ({ cursor, waitMs }) => host.observation.wait(cursor, waitMs),
		"files.list": ({ path }) => host.artifact(randomUUID(), { action: "files-list", path }) as Promise<FileListing>,
		"files.read": ({ path }) => host.artifact(randomUUID(), { action: "files-read", path }) as Promise<ReaderFile>,
		"files.open": ({ path }) => host.artifact(randomUUID(), { action: "file-open", path }) as Promise<ReaderFile>,
		"artifacts.list": (params) => host.artifact(randomUUID(), { action: "list", ...params }) as Promise<ArtifactListing>,
		"artifacts.read": ({ artifactId }) => host.artifact(randomUUID(), { action: "read", artifactId }) as Promise<ArtifactContent>,
		"artifacts.import": ({ requestId, path }) => host.artifact(requestId, { action: "import", path }) as Promise<ArtifactRef>,
		"artifacts.export": ({ requestId, artifactId, path }) => host.artifact(requestId, { action: "export", artifactId, path }) as Promise<null>,
		"artifacts.remove": ({ requestId, artifactId }) => host.artifact(requestId, { action: "remove", artifactId }) as Promise<null>,
		"artifacts.get": ({ artifactId }) => host.artifact(randomUUID(), { action: "get", artifactId }) as Promise<ArtifactRef>,
		"artifacts.preview": ({ artifactId }) => host.artifact(randomUUID(), { action: "preview", artifactId }) as Promise<ArtifactContent>,
		"lifecycle.get": async () => host.lifecycle.state,
		"lifecycle.pause": () => host.lifecycle.pause(),
		"lifecycle.resume": () => host.lifecycle.resume(),
		"lifecycle.native": (params) => host.lifecycle.native(params),
		"runs.continue": ({ runId, requestId }) => host.runs.continue(runId, requestId),
		"collaboration.stop": ({ rootId }) => host.groups.stopTree(rootId),
		"groups.list": () => host.runtime.groups().list(),
		"groups.snapshot": async ({ groupId, history }) => ({
			...(await host.groups.snapshot(groupId, history)),
			backgroundTasks: host.background.view(undefined, undefined, groupId),
		}),
		"groups.change": (change) => host.groups.change(change),
		"groups.send": ({ groupId, requestId, text, recipientIds }) => host.groups.send(groupId, requestId, text, recipientIds),
		"host.status": async () => host.status,
		"bots.list": () => listHostBots(host.actions()),
		"avatars.source": ({ path }) => host.artifact(randomUUID(), { action: "avatar-source", path }) as Promise<AvatarSource>,
		"bots.avatar.get": async ({ botId }) => {
			await host.liveBot(botId);
			return host.runtime.avatarImage(botId);
		},
		"bots.management.history": () => host.management.history(),
		"bots.create": (params) => createHostBot(host.actions(), params),
		"bots.update": (params) => updateHostBot(host.actions(), params),
		"conversations.snapshot": (params) => directSnapshot(host.actions(), params),
		"conversations.window": (input) => host.runtime.historyWindow(input),
		"conversations.detail": (input) => host.runtime.historyDetail(input),
		"conversations.indexStatus": async () => host.runtime.historyStatus(),
		"conversations.indexRetry": () => host.runtime.retryHistory(),
		"conversations.search": (input) => host.capabilities.desktopSearch(input),
		"conversations.list": () => host.capabilities.desktopSummaries(),
		"conversations.markRead": (params) => markConversationRead(host.actions(), params),
		"messages.submit": (params) => submitMessage(host.actions(), params),
		"runs.cancel": async ({ runId }) => ({ state: await host.runs.cancel(runId) }),
		"approvals.list": ({ conversationId }) => host.approvals.decisions(conversationId),
		"approvals.decide": async ({ approvalId, decision }) => {
			if (!(await host.authority.change(() => host.approvals.decide(approvalId, decision)))) {
				throw new ProtocolError("not_found", "This request was already answered or its task ended");
			}
			// The new rule or grant may cover other waiting calls too.
			if (typeof decision !== "string") await host.policy.reevaluate();
			return null;
		},
		"usage.get": ({ botId, limit }) => host.runtime.usage(botId, limit),
		"settings.get": () => redactedSettings(host.actions()),
		"settings.update": (params) => updateSettings(host.actions(), params),
		"models.list": () => listModels(host.actions()),
		"credentials.status": () => credentialStatus(host.actions().secrets),
		"credentials.migrate": () => migrateCredentials(host.actions().secrets),
		"credentials.set": (params) => setCredential(host.actions(), params),
		"credentials.delete": (params) => deleteCredential(host.actions(), params),
		"bots.memory.get": ({ botId }) => host.runtime.memoryState(botId),
		"memory.shared.get": () => host.runtime.sharedMemory(),
		"memory.shared.update": ({ content, expectedRevision }) => host.runtime.setSharedMemory(content, expectedRevision),
		"memory.shared.restore": ({ revision, expectedRevision }) => host.runtime.restoreSharedMemory(revision, expectedRevision),
		"bots.memory.note": (input) => host.runtime.changeMemoryNote(input),
		"bots.memory.source": ({ botId, scope, noteId, which }) => host.runtime.memorySource(botId, scope, noteId, which),
		"bots.memory.update": ({ botId, content, expectedRevision }) => host.runtime.setMemory(botId, content, expectedRevision),
		"bots.memory.restore": ({ botId, revision, expectedRevision }) => host.runtime.restoreMemory(botId, revision, expectedRevision),
		"conversations.reset": (params) => resetConversation(host.actions(), params),
		"conversations.delete": (params) => deleteConversation(host.actions(), params),
		"conversations.reopen": (params) => reopenConversation(host.actions(), params),
		"policy.get": () => host.policy.get(),
		"policy.ask.create": (input) => host.policy.createAsk(input),
		"policy.ask.delete": (input) => host.policy.deleteAsk(input),
		"policy.reconcile": () => host.policy.reconcile(),
		"policy.update": (change) => host.policy.update(change),
		"policy.rules.delete": ({ id }) => host.policy.deleteRule(id),
		"grants.list": () => host.policy.grants(),
		"grants.revoke": ({ id }) => host.policy.revoke(id),
		"grants.add": ({ path, access }) => host.policy.add(path, access),
		"models.addProvider": (provider) => addModelProvider(host.actions(), provider),
		"models.test": (params) => testModel(host.actions(), params),
		"conversations.subscribe": (params) => subscribeConversation(host.actions(), params),
		"bots.duplicate": (params) => duplicateHostBot(host.actions(), params),
		"bots.delete": (params) => deleteHostBot(host.actions(), params),
		"files.resolveReveal": async ({ path }) => {
			// Reveal only inside folders Bots may use: the workspace and the folder grants.
			const grants = await host.policy.grants();
			return revealablePath(path, host.workspace, [host.workspace, ...grants.map((grant) => grant.path)]);
		},
	};
}
