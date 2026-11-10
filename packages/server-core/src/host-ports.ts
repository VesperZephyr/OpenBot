import type { BotRuntime, ConfigEnvironment } from "@openbot/agent-runtime";
import type { ArtifactOperation, ArtifactOperationResult, BotId, HostEvent, HostMethod, HostStatus } from "@openbot/protocol";
import type { ApprovalBook } from "./approvals.ts";
import type { AuthorityExecutor } from "./authority.ts";
import type { BackgroundPort } from "./background.ts";
import type { Timers } from "./coalescer.ts";
import type { ConnectorPort } from "./connectors.ts";
import type { SkillPort } from "./skills.ts";

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
