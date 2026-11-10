/**
 * Transport-independent application methods for the Host Runtime. Process composition, credential storage, and IPC
 * live in `apps/local-server`; this package only sees ports.
 */

export type { HostMethods } from "@openbot/protocol";
export { HostService, newRequestId } from "./host-service.ts";
export type { ArtifactPort, EventSink, HostServiceOptions, ModelConfigFile, OperationAudit, SecretStore } from "./host-ports.ts";
export { MemorySecretStore } from "./secrets.ts";
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
export { memoryUpdate, memoryRead } from "./memory-tool.ts";
export { Coalescer, COALESCE_WINDOW_MS, type Timers } from "./coalescer.ts";
export { ConversationFeed, type ConversationFeedOptions } from "./conversation-feed.ts";

export { LocalBackups } from "./backup.ts";
