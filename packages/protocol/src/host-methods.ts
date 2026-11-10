import type { ArtifactContent, ArtifactListing, ArtifactRef } from "./artifacts.ts";
import type { AvatarChange, AvatarImage, AvatarSource } from "./avatars.ts";
import type { BotId, BotManagementActivity, BotProfile, BotSummary } from "./bots.ts";
import type { ConversationKey, ConversationSearchResult, ConversationSnapshot, ConversationSummary } from "./conversations.ts";
import type { CredentialMigration, CredentialStatus } from "./credentials.ts";
import type { ConnectorChange, ConnectorInstall, ConnectorProfile } from "./connectors.ts";
import type { Group, GroupChange, GroupPost, GroupSnapshot } from "./groups.ts";
import type { LifecycleState, NativeLifecycle } from "./lifecycle.ts";
import type { MemoryNoteChange, MemoryScope, MemorySourceEvidence, MemoryState } from "./memory.ts";
import type { ModelApi, ModelRef, ModelSummary, ThinkingLevel } from "./models.ts";
import type { ApprovalDecision, ApprovalDecisionLog } from "./approvals.ts";
import type { AskFirstInput, CommandSetting, FolderGrant, GrantAccess, PolicySettings } from "./policy.ts";
import type { FileListing, ReaderFile } from "./reader.ts";
import type { RunId, RunRecord } from "./runs.ts";
import type { SkillDetail, SkillRef, SkillSummary, SkillVersion } from "./skills.ts";
import type { BotUsage } from "./usage.ts";
import type { RedactedSettings } from "./settings.ts";

// ---------------------------------------------------------------------------
// Desktop-to-Host methods (Section 6.1). Each entry maps a method name to its params and result.

export type ObservationCursor = { readonly streamId: string; readonly seq: number };

export type ObservationUpdate = ObservationCursor & { readonly changes: number };

export type HostMethods = {
 "tasks.create":{params:import("./local-tasks.ts").LocalTaskCreate;result:import("./local-tasks.ts").LocalTaskAccepted};
 "tasks.submit":{params:import("./local-tasks.ts").LocalTaskSubmit;result:import("./local-tasks.ts").LocalTaskAccepted};
 "tasks.stop":{params:import("./local-tasks.ts").LocalTaskControl;result:import("./local-tasks.ts").LocalTaskAccepted};
 "tasks.archive":{params:import("./local-tasks.ts").LocalTaskArchive;result:import("./local-tasks.ts").LocalTaskAccepted};
 "tasks.list":{params:{archived?:boolean;cursor?:string};result:{tasks:readonly import("./local-tasks.ts").LocalTaskCard[];next?:string}};
 "tasks.get":{params:{taskId:string};result:import("./local-tasks.ts").LocalTaskSnapshot};
 "bots.templates.export": { params: {botId:string;expectedRevision:number}; result: import("./templates.ts").TemplateReview };
 "bots.templates.inspect": { params: {template:import("./templates.ts").BotTemplateV1}; result: import("./templates.ts").TemplateReview };
 "bots.templates.import": { params: import("./templates.ts").TemplateImportInput; result: import("./templates.ts").ImportResult };
 "bots.templates.status": { params: {requestId:string}; result: import("./templates.ts").ImportResult | null };
 "templates.file.read": { params: {path:string}; result: import("./templates.ts").TemplateFile };
 "templates.file.write": { params: {requestId:string;path:string;template:import("./templates.ts").BotTemplateV1;templateDigest:string}; result: null };

 "routines.list": {params:Record<string,never>;result:import("./routines.ts").RoutineList};
 "routines.get": {params:{routineId:string;occurrenceId?:string};result:import("./routines.ts").RoutineDetail};
 "routines.change": {params:import("./routines.ts").RoutineChange;result:import("./routines.ts").Routine};
 "routines.test": {params:{routineId:string;expectedRevision:number;requestId:string};result:import("./routines.ts").RoutineOccurrence};
 "routines.stop": {params:{occurrenceId:string};result:null};
 "routines.activity": {params:Record<string,never>;result:null};
 "routines.presence": {params:{absenceDays:number;resume:boolean};result:null};
 "connectors.list":{params:Record<string,never>;result:readonly ConnectorProfile[]};
 "connectors.install":{params:ConnectorInstall;result:ConnectorProfile};
 "connectors.connect":{params:ConnectorChange;result:ConnectorProfile};
 "connectors.disconnect":{params:ConnectorChange;result:ConnectorProfile};
 "connectors.remove":{params:ConnectorChange;result:ConnectorProfile};
 "connectors.credential.set":{params:{connectorId:string;expectedRevision:number;value:string};result:ConnectorProfile};
 "connectors.credential.delete":{params:{connectorId:string;expectedRevision:number};result:ConnectorProfile};
 "skills.list": {params: Record<string,never>; result: readonly SkillSummary[]};
 "skills.get": {params: {name:string; revision?:number}; result:SkillDetail};
 "skills.save": {params: {requestId:string; name:string; expectedRevision:number; document:import("./skills.ts").SkillDocument}; result:SkillVersion};
 "skills.delete": {params: {requestId:string; name:string; expectedRevision:number}; result:SkillVersion};
	"observation.wait": { params: { readonly cursor?: ObservationCursor; readonly waitMs?: number }; result: ObservationUpdate };
	"artifacts.import": { params: { requestId: string; path: string }; result: ArtifactRef };
	"artifacts.export": { params: { requestId: string; artifactId: string; path: string }; result: null };
	"artifacts.get": { params: { artifactId: string }; result: ArtifactRef };
	"files.list": { params: { path: string }; result: FileListing };
	"files.read": { params: { path: string }; result: ReaderFile };
	"files.open": { params: { path: string }; result: ReaderFile };
	"artifacts.list": { params: { offset: number; query: string; source?: "input" | "result"; botId?: string }; result: ArtifactListing };
	"artifacts.read": { params: { artifactId: string }; result: ArtifactContent };
	"artifacts.preview": { params: { artifactId: string }; result: ArtifactContent };
	"artifacts.remove": { params: { requestId: string; artifactId: string }; result: null };
 "lifecycle.get":{params:Record<string,never>;result:LifecycleState};
 "lifecycle.pause":{params:Record<string,never>;result:LifecycleState};
 "lifecycle.resume":{params:Record<string,never>;result:LifecycleState};
 "lifecycle.native":{params:NativeLifecycle;result:LifecycleState};
 "runs.continue":{params:{runId:string;requestId:string};result:{runId:string;state:RunRecord["state"];steered:boolean}};
	"collaboration.stop": { params: { rootId: string }; result: null };
	"groups.list": { params: Record<string, never>; result: readonly Group[] };
	"groups.snapshot": { params: { groupId: string; history?: "omit" }; result: GroupSnapshot };
	"groups.change": { params: GroupChange; result: Group };
	"groups.send": { params: { groupId: string; requestId: string; text: string; recipientIds?: readonly string[] }; result: GroupPost };

	"host.status": { params: Record<string, never>; result: HostStatus };
	"bots.management.history": { params: Record<string, never>; result: readonly BotManagementActivity[] };
	"avatars.source": { params: { path: string }; result: AvatarSource };
	"bots.avatar.get": { params: { botId: string }; result: AvatarImage | null };
	"bots.list": { params: Record<string, never>; result: readonly BotSummary[] };
	"bots.create": {
		params: {
			readonly requestId: string;
			readonly name: string;
			readonly role?: string;
			readonly instructions?: string;
			readonly model?: ModelRef;
		};
		result: BotProfile;
	};
	"bots.update": {
		params: {
			readonly avatar?: AvatarChange;
			readonly botId: BotId;
			readonly expectedRevision?: number;
			readonly defaultSkills?: readonly SkillRef[];
			readonly name?: string;
			readonly role?: string;
			readonly instructions?: string;
			readonly model?: ModelRef | null;
			readonly thinkingLevel?: ThinkingLevel;
			readonly pinned?: boolean;
			/** `deleted` is reached only through `bots.delete`. */
			readonly status?: Exclude<BotProfile["status"], "deleted">;
		};
		result: BotProfile;
	};
	"background.stop": {params:{readonly invocationId:string};result:null};
	"conversations.snapshot": { params: { readonly botId: BotId; readonly history?: "omit" }; result: ConversationSnapshot };
 "conversations.window": {params: import("./history.ts").WindowInput; result: import("./history.ts").WindowResult};
 "conversations.detail": {params: import("./history.ts").DetailInput; result: import("./history.ts").DetailResult};
 "conversations.indexStatus": {params: Record<string,never>; result: import("./history.ts").IndexStatus};
 "conversations.indexRetry": {params: Record<string,never>; result:null};
	"conversations.search": {
		params: {
			readonly query: string;
			readonly unreadOnly?: boolean;
			readonly includeHidden?: boolean;
			readonly conversationKey?: ConversationKey;
			readonly cursor?: string;
		};
		result: ConversationSearchResult;
	};
	"conversations.list": { params: Record<string, never>; result: readonly ConversationSummary[] };
	"conversations.markRead": { params: { readonly conversationKey: ConversationKey; readonly through: number }; result: null };
	"messages.submit": {
		params: { readonly botId: BotId; readonly requestId: string; readonly text: string; readonly artifactIds?: readonly string[]; readonly skills?: readonly SkillRef[] };
		/** `steered`: the message joined the Bot's running or queued Run instead of starting one. */
		result: { readonly runId: RunId; readonly state: RunRecord["state"]; readonly steered: boolean };
	};
	"runs.cancel": { params: { readonly runId: RunId }; result: { readonly state: RunRecord["state"] } };
	"approvals.decide": { params: { readonly approvalId: string; readonly decision: ApprovalDecision }; result: null };
	"approvals.list": { params: { readonly conversationId: string }; result: readonly ApprovalDecisionLog[] };
	"usage.get": { params: { readonly botId: BotId; readonly limit?: number }; result: BotUsage };
	"settings.get": { params: Record<string, never>; result: RedactedSettings };
	"settings.update": {
		params: { readonly defaultModel?: ModelRef | null; readonly setupComplete?: boolean; readonly language?: "en" | "zh-CN"; readonly languageChosen?: boolean };
		result: RedactedSettings;
	};
	"models.list": { params: Record<string, never>; result: readonly ModelSummary[] };
	"credentials.status": { params: Record<string, never>; result: CredentialStatus };
	"credentials.migrate": { params: Record<string, never>; result: CredentialMigration };
	"credentials.set": {
		params: { readonly providerId: string; readonly apiKey: string };
		result: RedactedSettings;
	};
	"credentials.delete": { params: { readonly providerId: string }; result: RedactedSettings };
	"bots.memory.get": { params: { readonly botId: BotId }; result: MemoryState };
	"memory.shared.get": { params: Record<string, never>; result: MemoryState };
	"memory.shared.update": { params: { readonly content: string; readonly expectedRevision: number }; result: MemoryState };
	"memory.shared.restore": { params: { readonly revision: number; readonly expectedRevision: number }; result: MemoryState };
	"bots.memory.note": { params: MemoryNoteChange; result: { readonly local: MemoryState; readonly shared: MemoryState } };
	"bots.memory.source": {
		params: { readonly botId: BotId; readonly scope: MemoryScope; readonly noteId: string; readonly which: "original" | "changed" };
		result: MemorySourceEvidence;
	};
	"bots.memory.update": {
		params: { readonly botId: BotId; readonly content: string; readonly expectedRevision: number };
		result: MemoryState;
	};
	"bots.memory.restore": {
		params: { readonly botId: BotId; readonly revision: number; readonly expectedRevision: number };
		result: MemoryState;
	};
	/** New topic: the Bot's next request starts from an empty context; memory and stored history stay. */
	"conversations.reset": { params: { readonly botId: BotId }; result: null };
	/**
	 * Remove one direct conversation from the list and clear that conversation's approval records.
	 * The Bot stays. Core cannot be removed from the list.
	 */
	"conversations.delete": { params: { readonly conversationKey: ConversationKey }; result: { readonly conversationId: string } };
	/**
	 * Start an empty direct chat for a Bot whose conversation was deleted. The Bot, workspace files,
	 * and conversation key stay. Older entries remain stored. Approval records cleared by delete stay cleared.
	 */
	"conversations.reopen": { params: { readonly botId: BotId }; result: null };
	"policy.get": { params: Record<string, never>; result: PolicySettings };
	"policy.update": {
		params: { readonly commandSetting?: CommandSetting; readonly readOnlyDefault?: boolean };
		result: PolicySettings;
	};
 "policy.ask.create": { params: AskFirstInput & { readonly requestId: string; readonly expectedRevision: number }; result: PolicySettings };
 "policy.ask.delete": { params: { readonly requestId: string; readonly expectedRevision: number; readonly id: string }; result: PolicySettings };
 "policy.reconcile": { params: Record<string, never>; result: PolicySettings };
	"policy.rules.delete": { params: { readonly id: string }; result: PolicySettings };
	"grants.list": { params: Record<string, never>; result: readonly FolderGrant[] };
	"grants.revoke": { params: { readonly id: string }; result: readonly FolderGrant[] };
	/**
	 * Desktop main sends the folder the user picked in the native dialog; the renderer calls this method with an
	 * opaque `selection` token instead (see `apps/desktop/src/shared/api.ts`) and never supplies a path.
	 */
	"grants.add": { params: { readonly path: string; readonly access: GrantAccess }; result: readonly FolderGrant[] };
	/**
	 * Declare an OpenAI- or Anthropic-compatible provider in the model configuration file. An existing ID is refused.
	 * `verify: true` tests a temporary provider first and does not touch the shared model table. `secret` is sent only
	 * with `verify`; it is not stored until the test succeeds, and then only in the Keychain. A failed test writes
	 * nothing. There is no remove method.
	 */
	"models.addProvider": {
		params: {
			readonly id: string;
			readonly name: string;
			readonly baseUrl: string;
			readonly api: ModelApi;
			readonly modelIds: readonly string[];
			readonly verify?: boolean;
			readonly secret?: string;
		};
		result: RedactedSettings;
	};
	/**
	 * Send one tiny real request to the model. A failing endpoint or key is reported in the result, not thrown.
	 * `secret`, when present, is used only for this request and is not written to the Keychain.
	 */
	"models.test": { params: ModelRef & { readonly secret?: string }; result: { readonly ok: boolean; readonly error?: string } };
	/**
	 * Choose the one Bot whose `conversation.updated` events Desktop receives; `null` receives none. Replaces the
	 * previous choice. `bots.changed` is always sent.
	 */
	"conversations.subscribe": { params: { readonly botId: BotId | null }; result: null };
	/** A new Bot with the same profile and memory, without history. Idempotent per `requestId`. */
	"bots.duplicate": { params: { readonly botId: BotId; readonly requestId: string }; result: BotProfile };
	/** Cancel the Bot's Run, then mark it `deleted`. Its conversation stays on disk. */
	"bots.delete": { params: { readonly botId: BotId }; result: null };
	/**
	 * The canonical absolute path of an existing file or folder inside the workspace, else `null`. A relative path is
	 * resolved against the workspace. Desktop main asks before it reveals a path in Finder.
	 */
	"files.resolveReveal": { params: { readonly path: string }; result: string | null };
};

export type HostMethod = keyof HostMethods;
export type HostParams<M extends HostMethod> = HostMethods[M]["params"];
export type HostResult<M extends HostMethod> = HostMethods[M]["result"];

export const HOST_METHODS = [
	"background.stop",
 "tasks.create", "tasks.submit", "tasks.stop", "tasks.archive", "tasks.list", "tasks.get",
	"observation.wait",
	"artifacts.import",
	"artifacts.export",
	"artifacts.get",
 "routines.list","routines.get","routines.change","routines.test","routines.stop","routines.activity","routines.presence",
 "connectors.list","connectors.install","connectors.connect","connectors.disconnect","connectors.remove","connectors.credential.set","connectors.credential.delete",
 "skills.list","skills.get","skills.save","skills.delete",
	"files.list", "files.read", "files.open", "artifacts.list", "artifacts.read",
	"artifacts.preview",
	"artifacts.remove",
 "lifecycle.get","lifecycle.pause","lifecycle.resume","lifecycle.native","runs.continue",
	"collaboration.stop",
	"groups.list",
	"groups.snapshot",
	"groups.change",
	"groups.send",
	"host.status",
	"bots.templates.export", "bots.templates.inspect", "bots.templates.import", "bots.templates.status", "templates.file.read", "templates.file.write",
 "bots.list",
	"avatars.source",
	"bots.avatar.get",
	"bots.management.history",
	"bots.create",
	"bots.update",
	"conversations.snapshot",
 "conversations.window", "conversations.detail", "conversations.indexStatus", "conversations.indexRetry",
	"conversations.list",
	"conversations.search",
	"conversations.markRead",
	"messages.submit",
	"runs.cancel",
	"approvals.decide",
	"approvals.list",
	"usage.get",
	"settings.get",
	"settings.update",
	"models.list",
	"credentials.status",
	"credentials.migrate",
	"credentials.set",
	"credentials.delete",
	"bots.memory.get",
	"memory.shared.get",
	"memory.shared.update",
	"memory.shared.restore",
	"bots.memory.note",
	"bots.memory.source",
	"bots.memory.update",
	"bots.memory.restore",
	"conversations.reset",
	"conversations.delete",
	"conversations.reopen",
	"policy.get",
	"policy.update",
	"policy.rules.delete",
 "policy.ask.create", "policy.ask.delete", "policy.reconcile",
	"grants.list",
	"grants.revoke",
	"grants.add",
	"models.addProvider",
	"models.test",
	"conversations.subscribe",
	"bots.duplicate",
	"bots.delete",
	"files.resolveReveal",
] as const satisfies readonly HostMethod[];

export function isHostMethod(value: unknown): value is HostMethod {
	return typeof value === "string" && (HOST_METHODS as readonly string[]).includes(value);
}

export type HostStatus = {
	readonly protocolVersion: typeof import("./version.ts").PROTOCOL_VERSION;
	readonly hostVersion: string;
	readonly nodeVersion: string;
	readonly targetId: string;
	readonly startedAt: number;
};
