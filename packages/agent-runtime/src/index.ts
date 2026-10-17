/**
 * The only OpenBot package that imports Pi. It maps Bots to Pi Durable conversations and exposes OpenBot-shaped
 * operations and snapshots; callers never see Pi types.
 */
import { BACKGROUND_CONTEXT, type Context } from "@earendil-works/chord/context";
import type { CredentialStore, Provider, ToolCall } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { MutableModels } from "@earendil-works/pi-ai/models";
import {
	type AgentChange,
	type ConversationRecord,
	type ConversationView,
	createRegistry,
	defineDoc,
	defineExtension,
	defineTool,
	type EntryRecord,
	Harness,
	InboxDoc,
	type InboxState,
	type LiveState,
	LiveDoc,
	type SubmissionId,
	type ToolRegistration,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import {
	type BotId,
	type BotProfile,
	type ConversationSnapshot,
	type LiveRun,
	type MessagePart,
	type PendingMessage,
	type ModelRef,
	type ModelSummary,
	ProtocolError,
	type ThinkingLevel,
	type ToolCallStatus,
	type ToolDefinition,
	type TranscriptItem,
} from "@openbot/protocol";

import { type ApprovalStore, approvalStore } from "./approvals.ts";
import { type PolicyStore, policyStore } from "./policy.ts";
import { applyMemoryEdit, checkMemorySize, type MemoryEdit, MemoryDoc } from "./memory.ts";
import { buildConfiguredProviders, type ConfigEnvironment, type ModelConfigStatus } from "./model-config.ts";
import { botSections } from "./prompt.ts";
import { type RunStore, runStore } from "./runs.ts";

/** The OpenBot extension every conversation selects: prompt sections, and routed tools when the Host passes them. */
const BOT_EXTENSION = "openbot.bot";
/** Display-only transcript entry written when the user stops a Run. */
const STOPPED_ENTRY = "openbot.stopped";
/** How long a model test may take before it counts as failed. */
const MODEL_TEST_TIMEOUT_MS = 30_000;

/** Credential contract the Host implements over the Keychain; re-exported so the Host never imports Pi. */
export type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
export type { ApprovalStore } from "./approvals.ts";
export type { PolicyStore, SavedScope } from "./policy.ts";
export type { ConfigEnvironment, ConfiguredProviderStatus, ModelConfigStatus } from "./model-config.ts";
export type { MemoryEdit } from "./memory.ts";
export { isTerminal, KEPT_TERMINAL_RUNS, type RunInput, type RunMessage, type RunStore, type StoredRun } from "./runs.ts";

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

/**
 * The port every routed tool call enters (Section 5.1). The Host wires it to Tool Router. `callId` is stable across
 * reruns of the same Pi tool task, so an interrupted call that Pi reruns after a restart reaches the router again as the
 * same call and never becomes a second invocation.
 */
export type ToolInvoker = (call: {
	readonly botId: BotId;
	readonly conversationId: string;
	readonly callId: string;
	readonly tool: string;
	readonly args: Readonly<Record<string, unknown>>;
	readonly signal: AbortSignal;
	readonly onProgress: (output: string) => void;
}) => Promise<{ readonly status: string; readonly output: string; readonly taskId?: string }>;

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
	/** Without an invoker, Bots get no tools and can only answer in text. */
	readonly tools?: { readonly invoke: ToolInvoker; readonly definitions: readonly ToolDefinition[] };
	readonly context?: Context;
};

export type CreateBotInput = {
	readonly botId: BotId;
	readonly name: string;
	readonly role?: string;
	readonly instructions?: string;
	readonly model?: ModelRef;
	readonly thinkingLevel?: ThinkingLevel;
	/** Initial memory, written in the same commit that registers the Bot (Duplicate). */
	readonly memory?: string;
	readonly createdAt: number;
};

export type UpdateBotInput = {
	readonly name?: string;
	readonly role?: string;
	readonly instructions?: string;
	readonly model?: ModelRef | null;
	readonly thinkingLevel?: ThinkingLevel;
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
	/** Stored entries before each conversation's current head marker; entries are immutable, so one read per head. */
	readonly #history = new Map<number, { readonly head: number; readonly entries: readonly EntryRecord[] }>();

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
		const registry = createRegistry();
		registry.install(
			defineExtension({
				name: BOT_EXTENSION,
				tools:
					options.tools === undefined
						? []
						: options.tools.definitions.map((definition) => routedTool(definition, options.tools!.invoke)),
				sections: botSections(async (input, context) => {
					const bots = (await input.read.snapshot(BotsDoc, context))?.bots ?? {};
					return Object.values(bots).find((bot) => bot.conversationId === Number(input.conversationId));
				}),
			}),
		);
		const harness = await Harness.open(
			await openNodeSqliteStorage(options.databasePath),
			{
				models,
				registry,
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

	/** The durable approval records; Host code (the approval book) is their only writer. */
	approvals(): ApprovalStore {
		return approvalStore(this.#harness, this.#context);
	}

	/** Command policy and folder grants; Host code is their only writer. */
	policy(): PolicyStore {
		return policyStore(this.#harness, this.#context);
	}

	/**
	 * The conversation ID routed tool calls of this Bot carry (`ToolInvoker` `conversationId`), from which the Tool
	 * Router derives approval and invocation IDs.
	 */
	async conversationKey(botId: BotId): Promise<string> {
		return String((await this.#requireRecord(botId)).conversationId);
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

		if (input.memory !== undefined) checkMemorySize(input.memory);
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
			...(input.thinkingLevel === undefined ? {} : { thinkingLevel: input.thinkingLevel }),
			pinned: false,
			status: "active",
			createdAt: input.createdAt,
			conversationId: conversation.id,
		};
		// A crash between the two commits leaves an orphan conversation but no half-registered Bot.
		const stored = await this.#harness.commit(async (tx) => {
			const doc = await tx.doc(BotsDoc);
			if (doc.bots[input.botId] === undefined) {
				doc.bots[input.botId] = record;
				if (input.memory !== undefined && input.memory !== "") (await tx.doc(MemoryDoc, input.botId, null)).content = input.memory;
			}
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
			...(change.thinkingLevel === undefined ? {} : { thinkingLevel: change.thinkingLevel }),
			...(change.pinned === undefined ? {} : { pinned: change.pinned }),
			...(change.status === undefined ? {} : { status: change.status }),
			...(model === undefined ? {} : { model }),
		};

		// A Bot without a model of its own runs on the application default.
		const effectiveModel = change.model === null ? ((await this.defaultModel()) ?? null) : change.model;
		const agent: AgentChange = {
			...(change.instructions === undefined ? {} : { instructions: change.instructions || null }),
			...(effectiveModel === undefined ? {} : { model: effectiveModel }),
			...(change.thinkingLevel === undefined ? {} : { thinkingLevel: change.thinkingLevel }),
		};
		const conversation = await this.#conversation(record);
		if (Object.keys(agent).length > 0) await conversation.configure(agent, this.#context);
		await this.#harness.commit(async (tx) => {
			(await tx.doc(BotsDoc)).bots[botId] = updated;
		}, this.#context);
		return toProfile(updated);
	}

	/**
	 * Durably admit a message and return its Pi submission without waiting for the answer. `start` begins a run on an
	 * idle conversation; `steer` joins the running work after its current tool round (Pi `whenBusy: "steer"`), or starts
	 * a run when the conversation went idle meanwhile. The same `requestId` returns the existing submission, so a retried
	 * call never admits the message twice.
	 */
	async submit(botId: BotId, requestId: string, text: string, mode: "start" | "steer"): Promise<{ submissionId: string }> {
		const conversation = await this.#conversation(await this.#requireRecord(botId));
		const submission = await conversation.submit(
			{ type: "input", content: text, requestId, ...(mode === "steer" ? { whenBusy: "steer" as const } : {}) },
			this.#context,
		);
		return { submissionId: String(submission.id) };
	}

	/** Where a submission of this Bot stands; `absent` when Pi has no such submission for the Bot's conversation. */
	async submissionState(
		botId: BotId,
		submissionId: string,
	): Promise<"queued" | "placed" | "done" | "unanswered" | "absent"> {
		return (await this.#ownedSubmission(botId, submissionId))?.status.status ?? "absent";
	}

	/** Resolve once Pi settled the submission; also after a reopen, from the stored record. */
	async waitSubmission(botId: BotId, submissionId: string): Promise<{ status: "done" | "unanswered"; reason?: string }> {
		const owned = await this.#ownedSubmission(botId, submissionId);
		if (owned === undefined) throw new ProtocolError("not_found", `Unknown submission ${submissionId} for Bot ${botId}`);
		const settled = await owned.submission.wait(this.#context);
		return settled.status === "done" ? { status: "done" } : { status: "unanswered", reason: settled.reason };
	}

	/**
	 * Withdraw a submission that still waits in Pi's queue; one already placed stays with its run. Used when a run ended
	 * without an answer, because Pi keeps queued inputs until the next input arrives.
	 */
	async withdraw(botId: BotId, submissionId: string): Promise<void> {
		const record = await this.#requireRecord(botId);
		await this.#harness.abortSubmission(
			Number(submissionId) as SubmissionId,
			this.#context,
			record.conversationId as PiConversationId,
		);
	}

	/** Durable Run records; scheduling is the Host's job. */
	runsStore(): RunStore {
		return runStore(this.#harness, this.#context);
	}

	async #ownedSubmission(botId: BotId, submissionId: string) {
		const record = await this.#requireRecord(botId);
		const submission = await this.#harness.submission(Number(submissionId) as SubmissionId, this.#context);
		if (submission === undefined) return undefined;
		const status = await submission.status(this.#context);
		return status.conversationId === record.conversationId ? { submission, status } : undefined;
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

	/** Abort the Bot's work: withdraw queued inputs and abort the active run; resolves once the conversation is idle. */
	async cancel(botId: BotId): Promise<void> {
		const conversation = await this.#conversation(await this.#requireRecord(botId));
		await conversation.abort(this.#context);
	}

	/**
	 * New topic: the next request starts from an empty context. Older entries stay in storage and in the transcript;
	 * memory is a document, so it carries over. Pi queues the reset while the conversation is busy.
	 */
	async reset(botId: BotId): Promise<void> {
		const conversation = await this.#conversation(await this.#requireRecord(botId));
		await conversation.reset(undefined, this.#context);
	}

	async memory(botId: BotId): Promise<string> {
		await this.#requireRecord(botId);
		return (await this.#harness.snapshot(MemoryDoc, botId, this.#context))?.content ?? "";
	}

	/** Replace the whole memory, as the user's editor does. Rejects content above the limit. */
	async setMemory(botId: BotId, content: string): Promise<string> {
		await this.#requireRecord(botId);
		checkMemorySize(content);
		return this.#harness.commit(async (tx) => {
			const doc = await tx.doc(MemoryDoc, botId, null);
			doc.content = content;
			return content;
		}, this.#context);
	}

	/** Edit one memory section in a single commit, as `memory_update` does. Rejects a result above the limit. */
	async editMemory(botId: BotId, edit: MemoryEdit): Promise<string> {
		await this.#requireRecord(botId);
		return this.#harness.commit(async (tx) => {
			const doc = await tx.doc(MemoryDoc, botId, null);
			const next = applyMemoryEdit(doc.content, edit);
			checkMemorySize(next);
			doc.content = next;
			return next;
		}, this.#context);
	}

	/** Leave a "stopped" note in the transcript, after the user cancelled a Run. */
	async markStopped(botId: BotId): Promise<void> {
		const conversation = await this.#conversation(await this.#requireRecord(botId));
		await conversation.submit({ type: "write", entry: { kind: STOPPED_ENTRY } }, this.#context);
	}

	/** The Bot's conversation without pending approvals; the Host adds those (`approvals` is empty here). */
	async snapshot(botId: BotId): Promise<ConversationSnapshot> {
		const record = await this.#requireRecord(botId);
		const view = await (await this.#conversation(record)).viewState(this.#context);
		try {
			return await this.#project(record, view.value);
		} finally {
			view.dispose();
		}
	}

	/**
	 * Observe a Bot's conversation. The listener receives a projected snapshot after every commit that changes the
	 * view, starting with the current one, in commit order. Returns a function that stops observation.
	 */
	async observe(botId: BotId, listener: (snapshot: ConversationSnapshot) => void): Promise<() => void> {
		const record = await this.#requireRecord(botId);
		const view = await (await this.#conversation(record)).viewState(this.#context);
		listener(await this.#project(record, view.value));
		// Projection may read older entries, so updates are serialized to keep snapshots in commit order.
		let queue = Promise.resolve();
		let stopped = false;
		const unsubscribe = view.subscribe((value) => {
			queue = queue
				.then(async () => {
					const snapshot = await this.#project(record, value);
					if (!stopped) listener(snapshot);
				})
				.catch((error: unknown) => console.error(`Projecting the conversation of ${botId} failed`, error));
		});
		return () => {
			stopped = true;
			unsubscribe();
			view.dispose();
		};
	}

	listChatModels(): ModelSummary[] {
		return this.#models.getModels().map((model) => ({
			provider: model.provider,
			modelId: model.id,
			name: model.name,
			source: this.#builtins.has(model.provider) ? "builtin" : "custom",
			overridden: this.#builtins.has(model.provider) && this.#configuredIds.includes(model.provider),
			endpoint: safeEndpoint(model.baseUrl),
			reasoning: model.reasoning,
			images: model.input.includes("image"),
		}));
	}

	listProviders(): { readonly providerId: string; readonly name: string }[] {
		return this.#models.getProviders().map((provider) => ({ providerId: provider.id, name: provider.name }));
	}

	/**
	 * Send one tiny real request to the model, with the same provider, endpoint, and credentials Bots use, and report
	 * whether it answered. Failures (unknown model, missing key, HTTP errors, timeout) become `{ ok: false, error }`.
	 */
	async testModel(ref: ModelRef, timeoutMs = MODEL_TEST_TIMEOUT_MS): Promise<{ readonly ok: boolean; readonly error?: string }> {
		const model = this.#models.getModel(ref.provider, ref.modelId);
		if (model === undefined) return { ok: false, error: "Unknown model. Reload configuration or choose an available model." };
		try {
			const answer = await this.#models.completeSimple(
				model,
				{ messages: [{ role: "user", content: "Reply with OK.", timestamp: Date.now() }] },
				{ maxTokens: 16, signal: AbortSignal.timeout(timeoutMs) },
			);
			if (answer.stopReason === "error" || answer.stopReason === "aborted") {
				return { ok: false, error: modelTestError(answer.errorMessage ?? answer.stopReason) };
			}
			return { ok: true };
		} catch (error) {
			return { ok: false, error: modelTestError(error instanceof Error ? error.message : String(error)) };
		}
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

	/** Pi's view holds only the active context; prepend the stored entries before its head so history stays visible. */
	async #project(record: BotRecord, view: ConversationView): Promise<ConversationSnapshot> {
		const marker = view.entries[0]?.head === undefined ? undefined : view.entries[0];
		const earlier = marker === undefined ? [] : await this.#earlierEntries(record, marker);
		return projectView(record.botId, view, earlier);
	}

	async #earlierEntries(record: BotRecord, marker: EntryRecord): Promise<readonly EntryRecord[]> {
		const cached = this.#history.get(record.conversationId);
		if (cached?.head === marker.id) return cached.entries;
		const conversation = await this.#conversation(record);
		const entries: EntryRecord[] = [];
		let cursor: Parameters<typeof conversation.entries>[2];
		do {
			const page = await conversation.entries(
				{ maxEntryId: marker.id, order: "ascending" },
				500,
				cursor,
				this.#context,
			);
			entries.push(...page.items);
			cursor = page.next;
		} while (cursor !== undefined);
		this.#history.set(record.conversationId, { head: marker.id, entries });
		return entries;
	}
}

function agentChange(input: {
	readonly model?: ModelRef;
	readonly instructions?: string;
	readonly thinkingLevel?: ThinkingLevel;
}): AgentChange {
	return {
		...(input.model === undefined ? {} : { model: input.model }),
		...(input.instructions === undefined || input.instructions === "" ? {} : { instructions: input.instructions }),
		...(input.thinkingLevel === undefined ? {} : { thinkingLevel: input.thinkingLevel }),
	};
}

function toProfile(record: BotRecord): BotProfile {
	const { conversationId: _conversationId, ...profile } = record;
	return profile;
}

/** Text blocks of a user or assistant message; images are not projected yet. */
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

function toolCallsOf(entry: EntryRecord): ToolCall[] {
	const message = entry.model?.[0];
	if (message?.role !== "assistant") return [];
	return message.content.filter((block): block is ToolCall => block.type === "toolCall");
}

/** Visible reasoning of an assistant entry; redacted blocks carry only an opaque payload and are left out. */
function thinkingOf(entry: EntryRecord): string | undefined {
	const message = entry.model?.[0];
	if (message?.role !== "assistant") return undefined;
	const text = message.content
		.flatMap((block) => (block.type === "thinking" && block.redacted !== true && block.thinking.trim() !== "" ? [block.thinking.trim()] : []))
		.join("\n\n");
	return text === "" ? undefined : text;
}

type MutableToolItem = { kind: "tool"; id: string; tool: string; args: unknown; status: ToolCallStatus; output?: string; taskId?: string };

/** What the model receives for an `unknown` outcome, instead of the executor's text (Section 5.1). */
export const UNKNOWN_OUTCOME_TEXT =
	"This action was interrupted and may have partly run. Check its effect before doing anything else.";

/** When the entry's first user or assistant message was created; Pi stamps every message. */
function timestampOf(entry: EntryRecord): number | undefined {
	const message = entry.model?.[0];
	return message?.role === "user" || message?.role === "assistant" ? message.timestamp : undefined;
}

/**
 * Transcript items in order. A tool call becomes a `tool` item right after the assistant text that made it; its
 * `pi.tool-result` entry completes that item instead of adding one.
 */
function toTranscript(entries: readonly EntryRecord[]): TranscriptItem[] {
	const items: TranscriptItem[] = [];
	const tools = new Map<string, MutableToolItem>();
	for (const entry of entries) {
		const id = String(entry.id);
		switch (entry.kind) {
			case "pi.user": {
				const at = timestampOf(entry);
				items.push({ kind: "user", id, parts: textParts(entry), ...(at === undefined ? {} : { at }) });
				break;
			}
			case "pi.assistant": {
				const message = entry.model?.[0];
				const error =
					message?.role === "assistant" && (message.stopReason === "error" || message.stopReason === "aborted")
						? (message.errorMessage ?? message.stopReason)
						: undefined;
				const parts = textParts(entry);
				const thinking = thinkingOf(entry);
				const at = timestampOf(entry);
				if (parts.length > 0 || error !== undefined || thinking !== undefined) {
					items.push({
						kind: "assistant",
						id,
						parts,
						...(thinking === undefined ? {} : { thinking }),
						...(error === undefined ? {} : { error }),
						...(at === undefined ? {} : { at }),
					});
				}
				for (const call of toolCallsOf(entry)) {
					const item: MutableToolItem = { kind: "tool", id: call.id, tool: call.name, args: call.arguments, status: "pending" };
					tools.set(call.id, item);
					items.push(item);
				}
				break;
			}
			case "pi.tool-result": {
				const message = entry.model?.[0];
				if (message?.role !== "toolResult") break;
				const item = tools.get(message.toolCallId);
				if (item === undefined) break;
				// Interrupted: the executor reported `unknown`, or Pi itself settled the call as interrupted by a restart.
				// Cancelled: the user stopped the Run and Pi recorded the call as aborted.
				const diagnostics = (entry.data as { diagnostics?: readonly { code?: string }[] } | undefined)?.diagnostics ?? [];
				const unknown =
					(message.details as { status?: string } | undefined)?.status === "unknown" ||
					diagnostics.some((diagnostic) => diagnostic.code === "interrupted");
				item.status = unknown ? "interrupted" : !message.isError ? "succeeded" : wasAborted(entry) ? "cancelled" : "failed";
				item.output = partsOf(message.content).map((part) => part.text).join("\n");
				const details: unknown = message.details;
				if (typeof details === "object" && details !== null && "taskId" in details && typeof details.taskId === "string") {
					item.taskId = details.taskId;
				}
				break;
			}
			case "pi.compaction":
				items.push({ kind: "divider", id, reason: "compaction" });
				break;
			case STOPPED_ENTRY:
				items.push({ kind: "stopped", id });
				break;
			case "pi.reset":
				items.push({ kind: "divider", id, reason: "reset" });
				break;
			case "pi.system":
				break;
			default:
				items.push({ kind: "other", id, entryKind: entry.kind });
		}
	}
	return items;
}

/** Pi marks a tool result it wrote because the run was aborted with an `aborted` diagnostic. */
function wasAborted(entry: EntryRecord): boolean {
	const data = entry.data as { readonly diagnostics?: readonly { readonly code?: string }[] } | undefined;
	return data?.diagnostics?.some((diagnostic) => diagnostic.code === "aborted") === true;
}

/** Inputs Pi holds in the inbox until the next boundary: messages sent while the Bot works. */
function pendingInputs(inbox: InboxState | undefined): PendingMessage[] {
	return (inbox?.items ?? []).flatMap((item) =>
		item.mode === "write" ? [] : [{ id: String(item.id), parts: partsOf(item.content as string | readonly { readonly type: string }[]) }],
	);
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

/**
 * `earlier` holds stored entries up to the view's head marker; together with the view's active entries, ordered by
 * ID and without duplicates, they are the whole transcript, including head markers the view leaves out. A compaction
 * marker is appended after the entries it keeps, so it is placed right before its head, where the summary ends.
 */
function projectView(botId: BotId, view: ConversationView, earlier: readonly EntryRecord[]): ConversationSnapshot {
	// Pi's view exposes built-in documents as untyped JSON keyed by kind; `pi.live` always holds a LiveState.
	const liveDoc: LiveState | undefined = view.docs[LiveDoc.definition.kind];
	const byId = new Map<number, EntryRecord>();
	for (const entry of [...earlier, ...view.entries]) byId.set(entry.id, entry);
	const position = (entry: EntryRecord): number =>
		entry.kind === "pi.compaction" && entry.head !== undefined ? entry.head - 0.5 : entry.id;
	const items = toTranscript([...byId.values()].sort((a, b) => position(a) - position(b)));
	// Running tool slots carry live status and output until their result entry exists.
	for (const slot of liveDoc?.tools ?? []) {
		const item = items.find((entry): entry is MutableToolItem => entry.kind === "tool" && entry.id === slot.callId) as
			| MutableToolItem
			| undefined;
		if (
			item === undefined ||
			item.status === "succeeded" ||
			item.status === "failed" ||
			item.status === "interrupted" ||
			item.status === "cancelled"
		)
			continue;
		item.status = slot.status === "running" ? "running" : "pending";
		if (slot.output !== undefined && slot.output !== "") item.output = slot.output;
	}
	const live = projectLive(liveDoc);
	const pending = pendingInputs(view.docs[InboxDoc.definition.kind] as InboxState | undefined);
	return {
		botId,
		items,
		...(live === undefined ? {} : { live }),
		approvals: [],
		...(pending.length === 0 ? {} : { pending }),
	};
}

/** A catalog tool registered with Pi. Replay-safe because the router and executor own idempotency (Section 5.1). */
function routedTool(definition: ToolDefinition, invoke: ToolInvoker): ToolRegistration {
	return defineTool({
		name: definition.name,
		description: definition.description,
		// Plain JSON Schema from the protocol catalog; Pi validates arguments against it before `execute`.
		parameters: definition.parameters as never,
		replay: "safe",
		executionMode: "sequential",
		async execute(args, api, context) {
			const botId = await botOfConversation(api, String(api.conversationId), context);
			const signal = context.abortSignal ?? new AbortController().signal;
			const outcome = await invoke({
				botId,
				conversationId: String(api.conversationId),
				callId: api.callId,
				tool: definition.name,
				args: args as Record<string, unknown>,
				signal,
				onProgress: (output) => api.output(output),
			});
			// A stopped Run: let Pi record the call as aborted rather than as the transport's failure text.
			signal.throwIfAborted();
			// An `unknown` outcome may have had an effect: the model must check it instead of retrying (Section 5.1).
			const text = outcome.status === "unknown" ? UNKNOWN_OUTCOME_TEXT : outcome.output === "" ? "(no output)" : outcome.output;
			return {
				output: [{ type: "text", text }],
				isError: outcome.status !== "succeeded",
				details: { status: outcome.status, ...(outcome.taskId === undefined ? {} : { taskId: outcome.taskId }) },
			};
		},
	});
}

async function botOfConversation(
	api: { snapshot: (token: typeof BotsDoc, context: Context) => Promise<Readonly<{ bots: Record<string, BotRecord> }> | undefined> },
	conversationId: string,
	context: Context,
): Promise<BotId> {
	const bots = (await api.snapshot(BotsDoc, context))?.bots ?? {};
	const record = Object.values(bots).find((bot) => String(bot.conversationId) === conversationId);
	if (record === undefined) throw new Error(`No Bot owns conversation ${conversationId}`);
	return record.botId;
}

/** Metadata and test failures can contain provider-controlled secrets; return only safe, fixed diagnostics. */
export function safeEndpoint(value: string): string {
	const url = URL.parse(value);
	return url !== null && (url.protocol === "http:" || url.protocol === "https:") ? url.origin : "Custom endpoint";
}

export function modelTestError(message: string): string {
	if (/401|403|api.key|auth|credential/i.test(message)) return "Authentication failed. Check the provider key and access.";
	if (/timeout|timed out|abort/i.test(message)) return "The request timed out. Check the endpoint and try again.";
	if (/404|not found|unknown model/i.test(message)) return "Model or endpoint not found. Check the model ID and base URL.";
	if (/429|rate.limit/i.test(message)) return "The provider is rate limiting requests. Try again later.";
	return "The model request failed. Check the endpoint, protocol and model ID.";
}
