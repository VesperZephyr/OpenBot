/**
 * Transport-independent application methods for the Host Runtime. Process composition, credential storage, and IPC
 * live in `apps/local-server`; this package only sees ports.
 */
import { randomUUID } from "node:crypto";
import type { BotRuntime, ConfigEnvironment, ModelConfigStatus } from "@openbot/agent-runtime";
import type { ApprovalBook } from "./approvals.ts";
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

/** Credential storage port. The Host implements it over the macOS Keychain; tests use memory. */
export interface SecretStore {
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

export type OperationAudit = { readonly operationId: string; readonly operation: HostMethod | "core.ensure"; readonly at: number; readonly durationMs: number; readonly outcome: "succeeded" | "failed" };

export type HostServiceOptions = {
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
	readonly toolSettled?: (botId: BotId, callId: string) => void;
	/** Runs when the user stops a Bot's work; the Host stops the background commands its conversation started. */
	readonly conversationStopped?: (botId: BotId) => void;
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
	readonly #audit: (event: OperationAudit) => void;
	#configWrites: Promise<unknown> = Promise.resolve();
	readonly #runtime: BotRuntime;
	readonly #secrets: SecretStore;
	readonly #status: HostStatus;
	readonly #dataDirectory: string;
	readonly #modelConfig: ModelConfigFile;
	readonly #approvals: ApprovalBook;
	readonly #toolSettled: (botId: BotId, callId: string) => void;
	readonly #conversationStopped: (botId: BotId) => void;
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
		this.#emit = options.emit;
		this.#now = options.now ?? Date.now;
		this.#runs = new RunScheduler({
			runtime: this.#runtime,
			maxActiveRuns: options.maxActiveRuns ?? DEFAULT_MAX_ACTIVE_RUNS,
			changed: (botId) => this.#republish(botId),
			now: this.#now,
			stopping: (botId) => this.#conversationStopped(botId),
		});
		this.#policy = new PolicyService({ runtime: this.#runtime, approvals: this.#approvals, workspace: this.#workspace, now: this.#now });
		this.#feed = new ConversationFeed({
			deliver: (snapshot) => this.#emit({ type: "conversation.updated", payload: snapshot }),
			...(options.coalesce?.windowMs === undefined ? {} : { windowMs: options.coalesce.windowMs }),
			...(options.coalesce?.timers === undefined ? {} : { timers: options.coalesce.timers }),
		});
		this.#handlers = {
			"host.status": async () => this.#status,
			"bots.list": () => this.#listBots(),
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
			"conversations.markRead": async ({ botId }) => {
				const observer = this.#observers.get(botId);
				if (observer?.activity === "unread") {
					observer.activity = "idle";
					this.#emit({ type: "bots.changed", payload: {} });
				}
				return null;
			},
			"messages.submit": async ({ botId, requestId, text }) => {
				if (text.trim() === "") throw new ProtocolError("invalid_request", "Message is empty");
				const bot = await this.#liveBot(botId);
				if (bot.model === undefined && (await this.#runtime.defaultModel()) === undefined) {
					throw new ProtocolError("invalid_request", "Choose a model in Settings before messaging a Bot");
				}
				return this.#runs.submit(botId, requestId, text);
			},
			"runs.cancel": async ({ runId }) => ({ state: await this.#runs.cancel(runId) }),
			"approvals.decide": async ({ approvalId, decision }) => {
				if (!(await this.#approvals.decide(approvalId, decision))) {
					throw new ProtocolError("not_found", "This request was already answered or its task ended");
				}
				// The new rule or grant may cover other waiting calls too.
				if (typeof decision !== "string") await this.#policy.reevaluate();
				return null;
			},
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
			"credentials.set": async ({ providerId, apiKey }) => {
				if (apiKey.trim() === "") throw new ProtocolError("invalid_request", "API key is empty");
				await this.#secrets.setApiKey(providerId, apiKey.trim());
				return this.#settings();
			},
			"credentials.delete": async ({ providerId }) => {
				await this.#secrets.deleteApiKey(providerId);
				return this.#settings();
			},
			"bots.memory.get": async ({ botId }) => ({ content: await this.#runtime.memory(botId) }),
			"bots.memory.update": async ({ botId, content }) => ({ content: await this.#runtime.setMemory(botId, content) }),
			"conversations.reset": async ({ botId }) => {
				await this.#runtime.reset(botId);
				return null;
			},
			"policy.get": () => this.#policy.get(),
			"policy.update": (change) => this.#policy.update(change),
			"policy.rules.delete": ({ id }) => this.#policy.deleteRule(id),
			"grants.list": () => this.#policy.grants(),
			"grants.revoke": ({ id }) => this.#policy.revoke(id),
			"grants.add": ({ path, access }) => this.#policy.add(path, access),
			"models.addProvider": (provider) => {
				const next = this.#configWrites.catch(() => {}).then(async () => {
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
					memory: source.kind === "core" ? "" : await this.#runtime.memory(botId),
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
				const run = this.#runs.active(botId);
				if (run !== undefined) await this.#runs.cancel(run.runId);
				this.#conversationStopped(botId);
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

	/**
	 * Load the model configuration and pending approvals, attach observers to every existing Bot, then sweep Runs left
	 * by the last shutdown. Call once after the runtime opened and before it resumes, so approvals from before a
	 * restart show before Pi reruns.
	 */
	async start(): Promise<void> {
		await this.#reloadModelConfig();
		const at = this.#now();
		await this.#runtime.ensureCoreBot(at);
		try { this.#audit({ operationId: randomUUID(), operation: "core.ensure", at, durationMs: this.#now() - at, outcome: "succeeded" }); } catch { /* Keep diagnostics independent of startup. */ }
		await this.#approvals.start(this.#runtime.approvals());
		for (const bot of await this.#runtime.listBots()) if (bot.status !== "deleted") await this.#observe(bot.botId);
		await this.#runs.start();
	}

	/** Call before the runtime closes: the shutdown aborts waiting calls, and their approvals must stay pending. */
	async stop(): Promise<void> {
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
			const result = await handler(params);
			outcome = method === "models.test" && (result as { ok?: boolean }).ok === false ? "failed" : "succeeded";
			return result;
		} finally {
			if (!method.endsWith(".get") && !method.endsWith(".list") && !["host.status", "conversations.snapshot", "conversations.subscribe", "conversations.markRead", "files.resolveReveal"].includes(method)) {
				try { this.#audit({ operationId: randomUUID(), operation: method, at, durationMs: this.#now() - at, outcome }); } catch { /* Diagnostics must not undo a committed action. */ }
			}
		}
	}

	async #listBots(): Promise<BotSummary[]> {
		const bots = await this.#runtime.listBots();
		return bots
			.filter((bot) => bot.status !== "deleted")
			.map((bot) => {
				const lastRun = this.#runs.latest(bot.botId);
				return {
					...bot,
					activity: this.#observers.get(bot.botId)?.activity ?? "idle",
					pendingApprovals: this.#approvals.forBot(bot.botId).length,
					...(lastRun === undefined
						? {}
						: { lastRun: { runId: lastRun.runId, state: lastRun.state, ...(lastRun.error === undefined ? {} : { error: lastRun.error }) } }),
				};
			});
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
			providers: this.#runtime.listProviders().filter(({ providerId }) => !providerId.startsWith(SEARCH_PROVIDER_PREFIX)).map(({ providerId, name }) => {
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
		return this.#withRun(this.#withApprovals(snapshot));
	}

	#withApprovals(snapshot: ConversationSnapshot): ConversationSnapshot {
		const approvals = this.#approvals.forBot(snapshot.botId);
		if (approvals.length === 0) return snapshot;
		const live = snapshot.live === undefined ? undefined : { ...snapshot.live, state: "waiting_approval" as const };
		return { ...snapshot, approvals, ...(live === undefined ? {} : { live }) };
	}

	/** A queued Run's messages are not in Pi yet; they show as pending until the Run starts. */
	#withRun(snapshot: ConversationSnapshot): ConversationSnapshot {
		const stored = this.#runs.active(snapshot.botId);
		if (stored === undefined) return snapshot;
		const { messages, inputs: _inputs, ...run } = stored;
		if (run.state !== "queued") return { ...snapshot, run };
		const queued = messages.map(({ requestId, text }) => ({ id: requestId, parts: [{ type: "text" as const, text }] }));
		return { ...snapshot, run, pending: [...(snapshot.pending ?? []), ...queued] };
	}

	#publish(botId: BotId, state: ObserverState, snapshot: ConversationSnapshot): void {
		state.last = snapshot;
		const view = this.#view(snapshot);
		const before = state.activity;
		state.activity = nextActivity(state, view);
		// The roster also carries the approval count and the latest Run, which Desktop main turns into the dock badge,
		// notifications, and the power assertion.
		const latest = this.#runs.latest(botId);
		const roster = `${view.approvals.length}|${latest?.runId ?? ""}|${latest?.state ?? ""}`;
		if (state.activity !== before || roster !== state.roster) this.#emit({ type: "bots.changed", payload: {} });
		state.roster = roster;
		this.#feed.publish(view);
		for (const item of snapshot.items) {
			if (item.kind !== "tool" || item.status === "pending" || item.status === "running" || state.settled.has(item.id)) continue;
			state.settled.add(item.id);
			this.#toolSettled(botId, item.id);
		}
	}

	async #observe(botId: BotId): Promise<void> {
		if (this.#observers.has(botId)) return;
		const state: ObserverState = { stop: () => {}, activity: "idle", answered: -1, settled: new Set() };
		this.#observers.set(botId, state);
		state.stop = await this.#runtime.observe(botId, (snapshot) => this.#publish(botId, state, snapshot));
	}
}

type ObserverState = {
	stop: () => void;
	activity: BotActivity;
	answered: number;
	/** Tool calls whose result this observer has seen, so `toolSettled` runs once per call. */
	readonly settled: Set<string>;
	last?: ConversationSnapshot;
	/** Approval count and latest Run last announced with `bots.changed`. */
	roster?: string;
};

/**
 * Sidebar state from a conversation snapshot: needs attention while an approval waits or after an interrupted call
 * (until the user writes again), working while a Run is live, queued while its Run waits for a free slot, unread
 * once a new answer arrives after observation started; otherwise unchanged until the user reads it.
 */
function nextActivity(state: { activity: BotActivity; answered: number }, snapshot: ConversationSnapshot): BotActivity {
	const answered = snapshot.items.filter((item) => item.kind === "assistant").length;
	const first = state.answered === -1;
	const grew = !first && answered > state.answered;
	state.answered = answered;
	if (snapshot.approvals.length > 0) return "needs_attention";
	const sinceUser = snapshot.items.slice(snapshot.items.findLastIndex((item) => item.kind === "user") + 1);
	if (sinceUser.some((item) => item.kind === "tool" && item.status === "interrupted")) return "needs_attention";
	// Pi's live state, not the Run record: the answer lands before the Run is marked ended.
	if (snapshot.live !== undefined) return "working";
	if (snapshot.run?.state === "queued") return "queued";
	if (grew) return "unread";
	return state.activity === "unread" || state.activity === "idle" ? state.activity : "idle";
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
