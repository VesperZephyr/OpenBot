/**
 * Transport-independent application methods for the Host Runtime. Process composition, credential storage, and IPC
 * live in `apps/local-server`; this package only sees ports.
 */
import { randomUUID } from "node:crypto";
import type { BotRuntime, ConfigEnvironment, ModelConfigStatus } from "@openbot/agent-runtime";
import {
	type BotActivity,
	type BotId,
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
}

export type EventSink = (event: HostEvent) => void;

/** The user's model configuration file. The Host implements file access and command execution. */
export interface ModelConfigFile {
	readonly path: string;
	/** Current file text, or `undefined` when the file does not exist. Rejects with a readable message otherwise. */
	read(): Promise<string | undefined>;
	readonly environment: ConfigEnvironment;
}

export type HostServiceOptions = {
	readonly runtime: BotRuntime;
	readonly secrets: SecretStore;
	readonly status: HostStatus;
	readonly dataDirectory: string;
	readonly modelConfig: ModelConfigFile;
	readonly emit: EventSink;
	readonly now?: () => number;
};

type Handlers = { [M in HostMethod]: (params: HostParams<M>) => Promise<HostResult<M>> };

export class HostService {
	readonly #runtime: BotRuntime;
	readonly #secrets: SecretStore;
	readonly #status: HostStatus;
	readonly #dataDirectory: string;
	readonly #modelConfig: ModelConfigFile;
	readonly #emit: EventSink;
	readonly #now: () => number;
	/** Per-Bot observation of its Pi conversation; drives sidebar activity and conversation events. */
	readonly #observers = new Map<BotId, { readonly stop: () => void; activity: BotActivity; answered: number }>();
	readonly #handlers: Handlers;
	#configStatus: ModelConfigStatus = { providers: [], errors: [] };

	constructor(options: HostServiceOptions) {
		this.#runtime = options.runtime;
		this.#secrets = options.secrets;
		this.#status = options.status;
		this.#dataDirectory = options.dataDirectory;
		this.#modelConfig = options.modelConfig;
		this.#emit = options.emit;
		this.#now = options.now ?? Date.now;
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
				const profile = await this.#runtime.updateBot(botId, change);
				this.#emit({ type: "bots.changed", payload: {} });
				return profile;
			},
			"conversations.snapshot": ({ botId }) => this.#runtime.snapshot(botId),
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
				const bot = await this.#runtime.getBot(botId);
				if (bot === undefined) throw new ProtocolError("not_found", `Unknown Bot: ${botId}`);
				if (bot.model === undefined && (await this.#runtime.defaultModel()) === undefined) {
					throw new ProtocolError("invalid_request", "Choose a model in Settings before messaging a Bot");
				}
				await this.#runtime.submit(botId, requestId, text);
				return { accepted: true };
			},
			"runs.cancel": async ({ botId }) => {
				await this.#runtime.cancel(botId);
				return null;
			},
			"settings.get": () => this.#settings(),
			"settings.update": async ({ defaultModel }) => {
				if (defaultModel !== undefined) await this.#runtime.setDefaultModel(defaultModel);
				return this.#settings();
			},
			"models.list": async () => {
				await this.#reloadModelConfig();
				return this.#runtime.listChatModels();
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
		};
	}

	/** Load the model configuration and attach observers to every existing Bot. Call once after the runtime opened. */
	async start(): Promise<void> {
		await this.#reloadModelConfig();
		for (const bot of await this.#runtime.listBots()) await this.#observe(bot.botId);
	}

	async stop(): Promise<void> {
		for (const observer of this.#observers.values()) observer.stop();
		this.#observers.clear();
	}

	/** Dispatch one validated request. Unknown methods and handler failures surface as `ProtocolError`. */
	async handle<M extends HostMethod>(method: M, params: HostParams<M>): Promise<HostResult<M>> {
		const handler: Handlers[M] | undefined = this.#handlers[method];
		if (handler === undefined) throw new ProtocolError("unknown_method", `Unknown method: ${method}`);
		return handler(params);
	}

	async #listBots(): Promise<BotSummary[]> {
		const bots = await this.#runtime.listBots();
		return bots.map((bot) => ({ ...bot, activity: this.#observers.get(bot.botId)?.activity ?? "idle" }));
	}

	async #settings(): Promise<RedactedSettings> {
		await this.#reloadModelConfig();
		const stored = await this.#secrets.configuredProviders();
		const fromConfig = new Map(this.#configStatus.providers.map((provider) => [provider.providerId, provider]));
		const defaultModel = await this.#runtime.defaultModel();
		return {
			...(defaultModel === undefined ? {} : { defaultModel }),
			providers: this.#runtime.listProviders().map(({ providerId, name }) => {
				const configured = fromConfig.get(providerId);
				const keyStored = stored.has(providerId);
				return {
					providerId,
					name,
					source: configured === undefined ? ("builtin" as const) : ("config" as const),
					configured: keyStored || configured?.keyAvailable === true,
					keyStored,
				};
			}),
			dataDirectory: this.#dataDirectory,
			modelConfig: { path: this.#modelConfig.path, errors: this.#configStatus.errors },
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

	async #observe(botId: BotId): Promise<void> {
		if (this.#observers.has(botId)) return;
		const state = { stop: () => {}, activity: "idle" as BotActivity, answered: -1 };
		this.#observers.set(botId, state);
		state.stop = await this.#runtime.observe(botId, (snapshot) => {
			const before = state.activity;
			state.activity = nextActivity(state, snapshot);
			if (state.activity !== before) this.#emit({ type: "bots.changed", payload: {} });
			this.#emit({ type: "conversation.updated", payload: snapshot });
		});
	}
}

/**
 * Sidebar state from a conversation snapshot: working while a Run is live; unread once a new answer arrives after
 * observation started; otherwise unchanged until the user reads it.
 */
function nextActivity(state: { activity: BotActivity; answered: number }, snapshot: ConversationSnapshot): BotActivity {
	const answered = snapshot.items.filter((item) => item.kind === "assistant").length;
	const first = state.answered === -1;
	const grew = !first && answered > state.answered;
	state.answered = answered;
	if (snapshot.live !== undefined) return "working";
	if (grew) return "unread";
	return state.activity === "working" ? "idle" : state.activity;
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

	read(providerId: string): string | undefined {
		return this.#keys.get(providerId);
	}
}

export const newRequestId = (): string => randomUUID();

export type { HostMethods };
