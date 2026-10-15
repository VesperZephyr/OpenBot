/**
 * The only OpenBot package that imports Pi. It maps Bots to Pi Durable conversations and exposes OpenBot-shaped
 * operations and snapshots; callers never see Pi types.
 */
import { BACKGROUND_CONTEXT, type Context } from "@earendil-works/chord/context";
import type { CredentialStore, Provider } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { MutableModels } from "@earendil-works/pi-ai/models";
import {
	type AgentChange,
	type ConversationRecord,
	type ConversationView,
	createRegistry,
	defineDoc,
	type EntryRecord,
	Harness,
	type LiveState,
	LiveDoc,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import {
	type BotId,
	type BotProfile,
	type ConversationSnapshot,
	type LiveRun,
	type MessagePart,
	type ModelRef,
	type ModelSummary,
	ProtocolError,
	type TranscriptItem,
} from "@openbot/protocol";

import { buildConfiguredProviders, type ConfigEnvironment, type ModelConfigStatus } from "./model-config.ts";

/** Credential contract the Host implements over the Keychain; re-exported so the Host never imports Pi. */
export type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
export type { ConfigEnvironment, ConfiguredProviderStatus, ModelConfigStatus } from "./model-config.ts";
export { SUPPORTED_MODEL_APIS } from "./model-config.ts";

type PiConversationId = ConversationRecord["id"];

/** Pi IDs are branded numbers; the record keeps the Pi conversation ID in that form. */
type BotRecord = BotProfile & { readonly conversationId: number };

/** Session-scoped Bot index stored next to Pi's own documents. */
const BotsDoc = defineDoc<{ bots: Record<string, BotRecord> }>({
	kind: "openbot.bots",
	version: 1,
	scope: "session",
	initial: () => ({ bots: {} }),
});

/** Application settings that live with the conversation store. */
const SettingsDoc = defineDoc<{ defaultModel?: ModelRef }>({
	kind: "openbot.settings",
	version: 1,
	scope: "session",
	initial: () => ({}),
});

export type BotRuntimeOptions = {
	/** SQLite file owned exclusively by this Host process. */
	readonly databasePath: string;
	/**
	 * Model collection. Defaults to every pi-ai built-in provider with `credentials` as their store. Tests pass a
	 * collection with a faux provider.
	 */
	readonly models?: MutableModels;
	/** Credential store for the default model collection; the Host passes a Keychain-backed store. */
	readonly credentials?: CredentialStore;
	readonly context?: Context;
};

export type CreateBotInput = {
	readonly botId: BotId;
	readonly name: string;
	readonly role?: string;
	readonly instructions?: string;
	readonly model?: ModelRef;
	readonly createdAt: number;
};

export type UpdateBotInput = {
	readonly name?: string;
	readonly role?: string;
	readonly instructions?: string;
	readonly model?: ModelRef | null;
	readonly pinned?: boolean;
	readonly status?: BotProfile["status"];
};

export type SubmitResult =
	| { readonly status: "answered"; readonly answer: readonly MessagePart[] }
	| { readonly status: "unanswered"; readonly reason: string };

export class BotRuntime {
	readonly #harness: Harness;
	readonly #models: MutableModels;
	readonly #context: Context;
	/** Built-in providers as registered at open, so a removed overlay restores the original. */
	readonly #builtins: ReadonlyMap<string, Provider>;
	#configuredIds: readonly string[] = [];

	private constructor(harness: Harness, models: MutableModels, context: Context) {
		this.#harness = harness;
		this.#models = models;
		this.#context = context;
		this.#builtins = new Map(models.getProviders().map((provider) => [provider.id, provider]));
	}

	static async open(options: BotRuntimeOptions): Promise<BotRuntime> {
		const context = options.context ?? BACKGROUND_CONTEXT;
		const models =
			options.models ?? builtinModels(options.credentials === undefined ? {} : { credentials: options.credentials });
		const harness = await Harness.open(
			await openNodeSqliteStorage(options.databasePath),
			{
				models,
				registry: createRegistry(),
				// No `env` and no CodingTools: every side effect must go through Tool Router and the executor.
				settings: { toolExecution: "sequential" },
			},
			context,
		);
		return new BotRuntime(harness, models, context);
	}

	/** Start the scheduler so work interrupted by the last shutdown continues. Call after recovery checks pass. */
	resume(): void {
		this.#harness.resume();
	}

	async close(): Promise<void> {
		await this.#harness.close(this.#context);
	}

	async listBots(): Promise<BotProfile[]> {
		const doc = await this.#harness.snapshot(BotsDoc, this.#context);
		return Object.values(doc?.bots ?? {}).map(toProfile);
	}

	async getBot(botId: BotId): Promise<BotProfile | undefined> {
		const record = await this.#record(botId);
		return record === undefined ? undefined : toProfile(record);
	}

	/** Idempotent for the same `botId`: returns the existing Bot instead of creating a second conversation. */
	async createBot(input: CreateBotInput): Promise<BotProfile> {
		const existing = await this.#record(input.botId);
		if (existing !== undefined) return toProfile(existing);

		const model = input.model ?? (await this.defaultModel());
		const conversation = await this.#harness.createConversation(
			{ ownership: { kind: "ownerless" }, agent: agentChange({ ...input, ...(model === undefined ? {} : { model }) }) },
			this.#context,
		);
		const record: BotRecord = {
			botId: input.botId,
			name: input.name,
			role: input.role ?? "",
			instructions: input.instructions ?? "",
			...(input.model === undefined ? {} : { model: input.model }),
			pinned: false,
			status: "active",
			createdAt: input.createdAt,
			conversationId: conversation.id,
		};
		// A crash between the two commits leaves an orphan conversation but no half-registered Bot.
		const stored = await this.#harness.commit(async (tx) => {
			const doc = await tx.doc(BotsDoc);
			doc.bots[input.botId] ??= record;
			// Drafts are only valid inside the commit callback, so return a plain copy.
			return JSON.parse(JSON.stringify(doc.bots[input.botId])) as BotRecord;
		}, this.#context);
		return toProfile(stored);
	}

	async updateBot(botId: BotId, change: UpdateBotInput): Promise<BotProfile> {
		const record = await this.#record(botId);
		if (record === undefined) throw new ProtocolError("not_found", `Unknown Bot: ${botId}`);
		const { model: currentModel, ...rest } = record;
		const model = change.model === undefined ? currentModel : (change.model ?? undefined);
		const updated: BotRecord = {
			...rest,
			...(change.name === undefined ? {} : { name: change.name }),
			...(change.role === undefined ? {} : { role: change.role }),
			...(change.instructions === undefined ? {} : { instructions: change.instructions }),
			...(change.pinned === undefined ? {} : { pinned: change.pinned }),
			...(change.status === undefined ? {} : { status: change.status }),
			...(model === undefined ? {} : { model }),
		};

		// A Bot without a model of its own runs on the application default.
		const effectiveModel = change.model === null ? ((await this.defaultModel()) ?? null) : change.model;
		const agent: AgentChange = {
			...(change.instructions === undefined ? {} : { instructions: change.instructions || null }),
			...(effectiveModel === undefined ? {} : { model: effectiveModel }),
		};
		const conversation = await this.#conversation(record);
		if (Object.keys(agent).length > 0) await conversation.configure(agent, this.#context);
		await this.#harness.commit(async (tx) => {
			(await tx.doc(BotsDoc)).bots[botId] = updated;
		}, this.#context);
		return toProfile(updated);
	}

	/**
	 * Durably admit a message and return without waiting for the answer. The same `requestId` returns the existing
	 * submission, so a retried call never starts a second Run.
	 */
	async submit(botId: BotId, requestId: string, text: string): Promise<void> {
		const conversation = await this.#conversation(await this.#requireRecord(botId));
		await conversation.submit({ type: "input", content: text, requestId }, this.#context);
	}

	/** Submit and wait for the answer; for harnesses and tests. */
	async submitAndWait(botId: BotId, requestId: string, text: string): Promise<SubmitResult> {
		const conversation = await this.#conversation(await this.#requireRecord(botId));
		const submission = await conversation.submit({ type: "input", content: text, requestId }, this.#context);
		const settled = await submission.wait(this.#context);
		if (settled.type !== "input") throw new ProtocolError("invalid_request", "Expected an input submission");
		if (settled.status !== "done") return { status: "unanswered", reason: settled.reason ?? "unknown" };
		const page = await conversation.entries(
			{ minEntryId: settled.answer, maxEntryId: settled.answer },
			1,
			undefined,
			this.#context,
		);
		const answer = page.items[0];
		return { status: "answered", answer: answer === undefined ? [] : textParts(answer) };
	}

	/** Abort the active Run; queued inputs are withdrawn and the call resolves once the conversation is idle. */
	async cancel(botId: BotId): Promise<void> {
		const conversation = await this.#conversation(await this.#requireRecord(botId));
		await conversation.abort(this.#context);
	}

	async snapshot(botId: BotId): Promise<ConversationSnapshot> {
		const record = await this.#requireRecord(botId);
		const view = await (await this.#conversation(record)).viewState(this.#context);
		try {
			return projectView(botId, view.value);
		} finally {
			view.dispose();
		}
	}

	/**
	 * Observe a Bot's conversation. The listener receives a projected snapshot after every commit that changes the
	 * view, starting with the current one. Returns a function that stops observation.
	 */
	async observe(botId: BotId, listener: (snapshot: ConversationSnapshot) => void): Promise<() => void> {
		const record = await this.#requireRecord(botId);
		const view = await (await this.#conversation(record)).viewState(this.#context);
		listener(projectView(botId, view.value));
		const unsubscribe = view.subscribe((value) => listener(projectView(botId, value)));
		return () => {
			unsubscribe();
			view.dispose();
		};
	}

	listChatModels(): ModelSummary[] {
		return this.#models.getModels().map((model) => ({
			provider: model.provider,
			modelId: model.id,
			name: model.name,
			reasoning: model.reasoning,
			images: model.input.includes("image"),
		}));
	}

	listProviders(): { readonly providerId: string; readonly name: string }[] {
		return this.#models.getProviders().map((provider) => ({ providerId: provider.id, name: provider.name }));
	}

	/**
	 * Apply the user's model configuration (`undefined` when there is no file): new providers are added, entries with
	 * a built-in ID replace that provider with an overlaid one, and providers from the previous load that are gone are
	 * removed or restored. Takes effect from the next model request.
	 */
	reloadConfiguredProviders(text: string | undefined, environment: ConfigEnvironment): ModelConfigStatus {
		const { providers, status } = buildConfiguredProviders(text, { environment, builtins: this.#builtins });
		for (const providerId of this.#configuredIds) {
			const builtin = this.#builtins.get(providerId);
			if (builtin === undefined) this.#models.deleteProvider(providerId);
			else this.#models.setProvider(builtin);
		}
		for (const provider of providers) this.#models.setProvider(provider);
		this.#configuredIds = providers.map((provider) => provider.id);
		return status;
	}

	async defaultModel(): Promise<ModelRef | undefined> {
		return (await this.#harness.snapshot(SettingsDoc, this.#context))?.defaultModel;
	}

	/**
	 * Set the model new Bots use when their profile names none. Existing Bots without a model of their own are
	 * reconfigured so the change applies from their next request.
	 */
	async setDefaultModel(model: ModelRef | null): Promise<void> {
		await this.#harness.commit(async (tx) => {
			const doc = await tx.doc(SettingsDoc);
			if (model === null) delete doc.defaultModel;
			else doc.defaultModel = model;
		}, this.#context);
		for (const record of Object.values((await this.#harness.snapshot(BotsDoc, this.#context))?.bots ?? {})) {
			if (record.model !== undefined) continue;
			await (await this.#conversation(record)).configure({ model }, this.#context);
		}
	}

	async #record(botId: BotId): Promise<BotRecord | undefined> {
		const doc = await this.#harness.snapshot(BotsDoc, this.#context);
		return doc?.bots[botId];
	}

	async #requireRecord(botId: BotId): Promise<BotRecord> {
		const record = await this.#record(botId);
		if (record === undefined) throw new ProtocolError("not_found", `Unknown Bot: ${botId}`);
		return record;
	}

	async #conversation(record: BotRecord) {
		const conversation = await this.#harness.conversation(record.conversationId as PiConversationId, this.#context);
		if (conversation === undefined) throw new ProtocolError("not_found", `Missing conversation for Bot: ${record.botId}`);
		return conversation;
	}
}

function agentChange(input: { readonly model?: ModelRef; readonly instructions?: string }): AgentChange {
	return {
		...(input.model === undefined ? {} : { model: input.model }),
		...(input.instructions === undefined || input.instructions === "" ? {} : { instructions: input.instructions }),
	};
}

function toProfile(record: BotRecord): BotProfile {
	const { conversationId: _conversationId, ...profile } = record;
	return profile;
}

/** Text blocks of a user or assistant message; images, thinking, and tool calls are projected separately later. */
function partsOf(content: string | readonly { readonly type: string }[]): MessagePart[] {
	if (typeof content === "string") return content === "" ? [] : [{ type: "text", text: content }];
	return content.flatMap((block) =>
		block.type === "text" && "text" in block && typeof block.text === "string"
			? [{ type: "text" as const, text: block.text }]
			: [],
	);
}

function textParts(entry: EntryRecord): MessagePart[] {
	return (entry.model ?? []).flatMap((message) =>
		message.role === "user" || message.role === "assistant" ? partsOf(message.content) : [],
	);
}

function toTranscriptItem(entry: EntryRecord): TranscriptItem[] {
	const id = String(entry.id);
	switch (entry.kind) {
		case "pi.user":
			return [{ kind: "user", id, parts: textParts(entry) }];
		case "pi.assistant": {
			const message = entry.model?.[0];
			const error =
				message?.role === "assistant" && (message.stopReason === "error" || message.stopReason === "aborted")
					? (message.errorMessage ?? message.stopReason)
					: undefined;
			return [{ kind: "assistant", id, parts: textParts(entry), ...(error === undefined ? {} : { error }) }];
		}
		case "pi.system":
		case "pi.reset":
			return [];
		default:
			return [{ kind: "other", id, entryKind: entry.kind }];
	}
}

function projectLive(live: LiveState | undefined): LiveRun | undefined {
	if (live?.run === undefined) return undefined;
	const content = live.generation?.message?.content;
	const partial = content === undefined ? [] : partsOf(content);
	return {
		state: "running",
		...(partial.length === 0 ? {} : { partial }),
		...(live.generation?.retry === undefined ? {} : { retry: live.generation.retry }),
	};
}

function projectView(botId: BotId, view: ConversationView): ConversationSnapshot {
	// Pi's view exposes built-in documents as untyped JSON keyed by kind; `pi.live` always holds a LiveState.
	const liveDoc: LiveState | undefined = view.docs[LiveDoc.definition.kind];
	const live = projectLive(liveDoc);
	return {
		botId,
		items: view.entries.flatMap(toTranscriptItem),
		...(live === undefined ? {} : { live }),
	};
}
