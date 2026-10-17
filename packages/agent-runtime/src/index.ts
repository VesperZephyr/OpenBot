/**
 * The only OpenBot package that imports Pi. It maps Bots to Pi Durable conversations and exposes OpenBot-shaped
 * operations and snapshots; callers never see Pi types.
 */
import { createHash, randomUUID } from "node:crypto";
import { BACKGROUND_CONTEXT, type Context } from "@earendil-works/chord/context";
import type { CredentialStore, Provider, ToolCall } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { MutableModels } from "@earendil-works/pi-ai/models";
import {
	type AgentChange,
	type ConversationRecord,
	type ConversationView,
	createRegistry,
	configure,
	type Tx,
	type Extension,
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
	type MemoryState,
	type MemorySnapshot,
	MEMORY_HISTORY_LIMIT,
	type BotManagementProposal,
	type ManagementAuthority,
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
import { applyMemoryEdit, checkMemorySize, type MemoryEdit, MemoryDoc, MemoryReceiptDoc, memoryState } from "./memory.ts";
import { buildConfiguredProviders, type ConfigEnvironment, type ModelConfigStatus } from "./model-config.ts";
import { botSections } from "./prompt.ts";
import { groupStore, detachGroupBot } from "./groups.ts";
import { ManagementDoc, managementStore } from "./management.ts";
import { type RunStore, runStore, RunsDoc } from "./runs.ts";

/** The OpenBot extension every conversation selects: prompt sections, and routed tools when the Host passes them. */
const BOT_EXTENSION = "openbot.bot";
const CORE_EXTENSION = "openbot.core-management";
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
type BotRecord = Omit<BotProfile, "kind" | "revision"> & {
	readonly revision?: number;
	readonly kind?: BotProfile["kind"];
	readonly conversationId: number;
};

/** Session-scoped Bot index stored next to Pi's own documents. */
const BotsDoc = defineDoc<{ bots: Record<string, BotRecord> }>({
	kind: "openbot.bots",
	version: 1,
	scope: "session",
	initial: () => ({ bots: {} }),
});

const ChannelsDoc = defineDoc<{ channels: Record<string, { botId: string; channelId: string; conversationId: number }> }>({
	kind: "openbot.channels",
	version: 1,
	scope: "session",
	initial: () => ({ channels: {} }),
});
const channelKey = (botId: string, channelId: string): string => JSON.stringify([botId, channelId]);

/** Application settings that live with the conversation store. */
const SettingsDoc = defineDoc<{ defaultModel?: ModelRef; setupComplete?: boolean; language?: "en" | "zh-CN" }>({
	kind: "openbot.settings",
	version: 1,
	scope: "session",
	initial: () => ({}),
});

/** Allocate identity before its conversation: restart reconciles the same Core rather than allocating another. */
const CoreDoc = defineDoc<{ coreBotId?: string }>({
	kind: "openbot.core",
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
	readonly runId?: string;
	readonly collaboration?: { readonly runId: string };
	readonly authority?: ManagementAuthority;
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
	/** Optional initial memory, written in the same commit that registers the Bot. */
	readonly memory?: string;
	readonly createdAt: number;
};

export type UpdateBotInput = {
	readonly expectedRevision?: number;
	readonly name?: string;
	readonly role?: string;
	readonly instructions?: string;
	readonly model?: ModelRef | null;
	readonly thinkingLevel?: ThinkingLevel;
	readonly pinned?: boolean;
	readonly status?: BotProfile["status"];
};

export type SubmitResult =
	{ readonly status: "answered"; readonly answer: readonly MessagePart[] } | { readonly status: "unanswered"; readonly reason: string };

export class BotRuntime {
	readonly #harness: Harness;
	readonly #extensions: { bot: Extension; core: Extension; group: Extension };
	readonly #models: MutableModels;
	readonly #context: Context;
	/** Built-in providers as registered at open, so a removed overlay restores the original. */
	readonly #builtins: ReadonlyMap<string, Provider>;
	#configuredIds: readonly string[] = [];
	/** Stored entries before each conversation's current head marker; entries are immutable, so one read per head. */
	#coreBootstrap: Promise<BotProfile> | undefined;
	readonly #history = new Map<number, { readonly head: number; readonly entries: readonly EntryRecord[] }>();

	private constructor(
		harness: Harness,
		models: MutableModels,
		context: Context,
		extensions: { bot: Extension; core: Extension; group: Extension },
	) {
		this.#extensions = extensions;
		this.#harness = harness;
		this.#models = models;
		this.#context = context;
		this.#builtins = new Map(models.getProviders().map((provider) => [provider.id, provider]));
	}

	static async open(options: BotRuntimeOptions): Promise<BotRuntime> {
		const context = options.context ?? BACKGROUND_CONTEXT;
		const models = options.models ?? builtinModels(options.credentials === undefined ? {} : { credentials: options.credentials });
		const registry = createRegistry();
		const bot = defineExtension({
			name: BOT_EXTENSION,
			tools:
				options.tools === undefined
					? []
					: options.tools.definitions
							.filter((d) => !d.capability.endsWith(".management") && d.capability !== "collaboration")
							.map((definition) => routedTool(definition, options.tools!.invoke)),
			sections: botSections(async (input, context) => {
				const bots = (await input.read.snapshot(BotsDoc, context))?.bots ?? {};
				const direct = Object.values(bots).find((bot) => bot.conversationId === Number(input.conversationId));
				const channel = Object.values((await input.read.snapshot(ChannelsDoc, context))?.channels ?? {}).find(
					(item) => item.conversationId === Number(input.conversationId),
				);
				return direct ?? (channel ? bots[channel.botId] : undefined);
			}),
		});
		const core = defineExtension({
			name: CORE_EXTENSION,
			tools: (options.tools?.definitions ?? [])
				.filter((d) => d.capability.endsWith(".management"))
				.map((d) => routedTool(d, options.tools!.invoke)),
		});
		const group = defineExtension({
			name: "openbot.group-collaboration",
			tools: (options.tools?.definitions ?? [])
				.filter((d) => d.capability === "collaboration")
				.map((d) => routedTool(d, options.tools!.invoke)),
		});
		registry.install(group);
		registry.install(bot);
		registry.install(core);
		const harness = await Harness.open(
			await openNodeSqliteStorage(options.databasePath),
			{
				models,
				registry,
				// No `env` and no CodingTools: every side effect must go through Tool Router and the executor.
				settings: { toolExecution: "sequential", extensions: [bot] },
			},
			context,
		);
		await harness.commit(async (tx) => {
			const profiles = await tx.doc(BotsDoc);
			for (const record of Object.values(profiles.bots)) {
				await configure(tx, record.conversationId as PiConversationId, {
					instructions: revisionedInstructions(record.instructions, record.revision ?? 1),
				});
			}
		}, context);
		await harness.commit(async (tx) => {
			const channels = await tx.doc(ChannelsDoc);
			for (const channel of Object.values(channels.channels))
				await configure(tx, channel.conversationId as PiConversationId, { extensions: [bot, group] });
		}, context);
		return new BotRuntime(harness, models, context, { bot, core, group });
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

	groups() {
		return groupStore(this.#harness, this.#context, async (tx) => Object.values((await tx.doc(BotsDoc)).bots).map(toProfile));
	}

	management() {
		return managementStore(this.#harness, this.#context);
	}

	/** Command policy and folder grants; Host code is their only writer. */
	policy(): PolicyStore {
		return policyStore(this.#harness, this.#context);
	}

	/**
	 * The conversation ID routed tool calls of this Bot carry (`ToolInvoker` `conversationId`), from which the Tool
	 * Router derives approval and invocation IDs.
	 */
	async conversationKey(botId: BotId, channelId = "direct"): Promise<string> {
		return String((await this.#contextRecord(botId, channelId)).conversationId);
	}

	async channels(): Promise<readonly { botId: string; channelId: string; conversationId: number }[]> {
		return Object.values((await this.#harness.snapshot(ChannelsDoc, this.#context))?.channels ?? {});
	}

	async ensureChannel(botId: BotId, channelId: string): Promise<string> {
		if (channelId === "direct") return this.conversationKey(botId);
		if (!channelId.trim()) throw new ProtocolError("invalid_request", "Channel ID is empty");
		const defaultModel = await this.defaultModel();
		return this.#harness.commit(async (tx) => {
			const bot = (await tx.doc(BotsDoc)).bots[botId];
			if (!bot || bot.status === "deleted") throw new ProtocolError("not_found", "Unknown or deleted Bot");
			const channels = await tx.doc(ChannelsDoc);
			const key = channelKey(botId, channelId);
			if (channels.channels[key]) return String(channels.channels[key].conversationId);
			const conversation = await tx.createConversation({ ownership: { kind: "ownerless" } });
			await configure(tx, conversation.id, {
				...agentChange({ ...bot, ...((bot.model ?? defaultModel) ? { model: (bot.model ?? defaultModel)! } : {}) }),
				instructions: revisionedInstructions(bot.instructions, bot.revision ?? 1),
				extensions: [this.#extensions.bot, this.#extensions.group],
			});
			channels.channels[key] = { botId, channelId, conversationId: conversation.id };
			return String(conversation.id);
		}, this.#context);
	}

	async #contextRecord(botId: BotId, channelId = "direct"): Promise<BotRecord> {
		const bot = await this.#requireRecord(botId);
		if (channelId === "direct") return bot;
		const channel = (await this.#harness.snapshot(ChannelsDoc, this.#context))?.channels[channelKey(botId, channelId)];
		if (!channel) throw new ProtocolError("not_found", "Unknown Bot channel");
		return { ...bot, conversationId: channel.conversationId };
	}

	async listBots(): Promise<BotProfile[]> {
		const doc = await this.#harness.snapshot(BotsDoc, this.#context);
		return Object.values(doc?.bots ?? {}).map(toProfile);
	}

	async getBot(botId: BotId): Promise<BotProfile | undefined> {
		const record = await this.#record(botId);
		return record === undefined ? undefined : toProfile(record);
	}

	async ensureCoreBot(now: number): Promise<BotProfile> {
		const pending = (this.#coreBootstrap ??= this.#bootstrapCore(now));
		try {
			return await pending;
		} finally {
			if (this.#coreBootstrap === pending) this.#coreBootstrap = undefined;
		}
	}

	async #bootstrapCore(now: number): Promise<BotProfile> {
		const botId = await this.#harness.commit(async (tx) => {
			const doc = await tx.doc(CoreDoc);
			doc.coreBotId ??= `core_${randomUUID()}`;
			return doc.coreBotId;
		}, this.#context);
		await this.createBot({
			botId,
			name: "OpenBot",
			role: "Personal assistant",
			instructions:
				"You are the user's personal assistant. Help with everyday tasks, keep useful preferences in your own memory, and use only the tools actually available to you. Reply in the user's language.",
			createdAt: now,
		});
		return this.#harness.commit(async (tx) => {
			const doc = await tx.doc(BotsDoc);
			const existing = doc.bots[botId]!;
			doc.bots[botId] = { ...existing, kind: "core", status: "active", pinned: true };
			await configure(tx, existing.conversationId as PiConversationId, { extensions: [this.#extensions.bot, this.#extensions.core] });
			return toProfile(JSON.parse(JSON.stringify(doc.bots[botId])) as BotRecord);
		}, this.#context);
	}

	async language(): Promise<"en" | "zh-CN"> {
		return (await this.#harness.snapshot(SettingsDoc, this.#context))?.language ?? "en";
	}
	async setLanguage(language: "en" | "zh-CN"): Promise<void> {
		await this.#harness.commit(async (tx) => {
			(await tx.doc(SettingsDoc)).language = language;
		}, this.#context);
	}

	async setupComplete(): Promise<boolean> {
		return (await this.#harness.snapshot(SettingsDoc, this.#context))?.setupComplete === true;
	}
	async setSetupComplete(value: boolean): Promise<void> {
		await this.#harness.commit(async (tx) => {
			(await tx.doc(SettingsDoc)).setupComplete = value;
		}, this.#context);
	}

	/** Idempotent for the same `botId`: returns the existing Bot instead of creating a second conversation. */
	async createBot(input: CreateBotInput, proposal?: BotManagementProposal): Promise<BotProfile> {
		if (input.memory !== undefined) checkMemorySize(input.memory);
		const model = input.model ?? (await this.defaultModel());
		return this.#harness.commit(async (tx) => {
			const receipt = await committedManagement(tx, proposal);
			if (receipt) return receipt;
			const doc = await tx.doc(BotsDoc);
			if (doc.bots[input.botId] && proposal) throw new ProtocolError("request_conflict", "Bot identity already exists");
			if (doc.bots[input.botId]) return toProfile(JSON.parse(JSON.stringify(doc.bots[input.botId])) as BotRecord);
			const conversation = await tx.createConversation({ ownership: { kind: "ownerless" } });
			await configure(tx, conversation.id, {
				...agentChange({ ...input, ...(model === undefined ? {} : { model }) }),
				instructions: revisionedInstructions(input.instructions ?? "", 1),
				extensions: [this.#extensions.bot],
			});
			const record: BotRecord = {
				botId: input.botId,
				revision: 1,
				kind: "specialist",
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
			doc.bots[input.botId] = record;
			if (input.memory) (await tx.doc(MemoryDoc, input.botId, null)).content = input.memory;
			const result = toProfile(record);
			await completeManagement(tx, proposal, result);
			return result;
		}, this.#context);
	}

	async updateBot(botId: BotId, change: UpdateBotInput, proposal?: BotManagementProposal): Promise<BotProfile> {
		const defaultModel = await this.defaultModel();
		return this.#harness.commit(async (tx) => {
			const receipt = await committedManagement(tx, proposal);
			if (receipt) return receipt;
			const doc = await tx.doc(BotsDoc);
			const record = doc.bots[botId];
			if (!record) throw new ProtocolError("not_found", "Unknown Bot");
			const coreId = (await tx.doc(CoreDoc)).coreBotId;
			if (
				(record.kind === "core" || botId === coreId) &&
				(proposal || change.pinned === false || (change.status !== undefined && change.status !== "active"))
			) {
				throw new ProtocolError("invalid_request", "The Core Bot cannot be deleted, hidden or unpinned");
			}
			if (proposal && (record.status === "deleted" || (record.revision ?? 1) !== proposal.expectedRevision))
				throw new ProtocolError("request_conflict", "Bot changed. Inspect it again before proposing another change.");
			const { model: currentModel, ...rest } = JSON.parse(JSON.stringify(record)) as BotRecord;
			const model = change.model === undefined ? currentModel : (change.model ?? undefined);
			if (change.expectedRevision !== undefined && change.expectedRevision !== (record.revision ?? 1))
				throw new ProtocolError("request_conflict", "Profile changed. Reload before saving your draft.");
			const { model: _model, expectedRevision: _expectedRevision, ...fields } = change;
			const updated: BotRecord = { ...rest, ...fields, revision: (record.revision ?? 1) + 1, ...(model === undefined ? {} : { model }) };
			const effectiveModel = change.model === null ? (defaultModel ?? null) : change.model;
			const agent: AgentChange = {
				instructions: revisionedInstructions(updated.instructions, updated.revision ?? 1),
				...(effectiveModel === undefined ? {} : { model: effectiveModel }),
				...(change.thinkingLevel === undefined ? {} : { thinkingLevel: change.thinkingLevel }),
			};
			if (Object.keys(agent).length) {
				await configure(tx, record.conversationId as PiConversationId, agent);
				for (const channel of Object.values((await tx.doc(ChannelsDoc)).channels)) {
					if (channel.botId === botId) await configure(tx, channel.conversationId as PiConversationId, agent);
				}
			}
			doc.bots[botId] = updated;
			if (updated.status === "deleted") await detachGroupBot(tx, botId);
			const result = toProfile(updated);
			await completeManagement(tx, proposal, result);
			return result;
		}, this.#context);
	}

	/**
	 * Durably admit a message and return its Pi submission without waiting for the answer. `start` begins a run on an
	 * idle conversation; `steer` joins the running work after its current tool round (Pi `whenBusy: "steer"`), or starts
	 * a run when the conversation went idle meanwhile. The same `requestId` returns the existing submission, so a retried
	 * call never admits the message twice.
	 */
	async submit(
		botId: BotId,
		requestId: string,
		text: string,
		mode: "start" | "steer",
		channelId = "direct",
	): Promise<{ submissionId: string }> {
		const conversation = await this.#conversation(await this.#contextRecord(botId, channelId));
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
		channelId = "direct",
	): Promise<"queued" | "placed" | "done" | "unanswered" | "absent"> {
		return (await this.#ownedSubmission(botId, submissionId, channelId))?.status.status ?? "absent";
	}

	/** Resolve once Pi settled the submission; also after a reopen, from the stored record. */
	async waitSubmission(
		botId: BotId,
		submissionId: string,
		channelId = "direct",
	): Promise<{ status: "done" | "unanswered"; reason?: string }> {
		const owned = await this.#ownedSubmission(botId, submissionId, channelId);
		if (owned === undefined) throw new ProtocolError("not_found", `Unknown submission ${submissionId} for Bot ${botId}`);
		const settled = await owned.submission.wait(this.#context);
		return settled.status === "done" ? { status: "done" } : { status: "unanswered", reason: settled.reason };
	}

	/**
	 * Withdraw a submission that still waits in Pi's queue; one already placed stays with its run. Used when a run ended
	 * without an answer, because Pi keeps queued inputs until the next input arrives.
	 */
	async withdraw(botId: BotId, submissionId: string, channelId = "direct"): Promise<void> {
		const record = await this.#contextRecord(botId, channelId);
		await this.#harness.abortSubmission(Number(submissionId) as SubmissionId, this.#context, record.conversationId as PiConversationId);
	}

	/** Durable Run records; scheduling is the Host's job. */
	runsStore(): RunStore {
		return runStore(this.#harness, this.#context);
	}

	async #ownedSubmission(botId: BotId, submissionId: string, channelId = "direct") {
		const record = await this.#contextRecord(botId, channelId);
		const submission = await this.#harness.submission(Number(submissionId) as SubmissionId, this.#context);
		if (submission === undefined) return undefined;
		const status = await submission.status(this.#context);
		return status.conversationId === record.conversationId ? { submission, status } : undefined;
	}

	/** Submit and wait for the answer; for harnesses and tests. */
	async submitAndWait(botId: BotId, requestId: string, text: string, channelId = "direct"): Promise<SubmitResult> {
		const conversation = await this.#conversation(await this.#contextRecord(botId, channelId));
		const submission = await conversation.submit({ type: "input", content: text, requestId }, this.#context);
		const settled = await submission.wait(this.#context);
		if (settled.type !== "input") throw new ProtocolError("invalid_request", "Expected an input submission");
		if (settled.status !== "done") return { status: "unanswered", reason: settled.reason ?? "unknown" };
		const page = await conversation.entries({ minEntryId: settled.answer, maxEntryId: settled.answer }, 1, undefined, this.#context);
		const answer = page.items[0];
		return { status: "answered", answer: answer === undefined ? [] : textParts(answer) };
	}

	/** Read the exact answer of a settled delivery, even after later channel tasks have run. */
	async submissionAnswer(botId: string, submissionId: string, channelId: string): Promise<string> {
		const owned = await this.#ownedSubmission(botId, submissionId, channelId);
		if (!owned) return "";
		const settled = await owned.submission.wait(this.#context);
		if (settled.type !== "input" || settled.status !== "done") return "";
		const conversation = await this.#conversation(await this.#contextRecord(botId, channelId));
		const page = await conversation.entries({ minEntryId: settled.answer, maxEntryId: settled.answer }, 1, undefined, this.#context);
		return page.items[0]
			? textParts(page.items[0])
					.map((p) => p.text)
					.join("\n")
			: "";
	}

	/** Abort channel work. Startup uses background mode to mark cancellation before the scheduler resumes. */
	async cancel(botId: BotId, channelId = "direct", background = false): Promise<void> {
		const conversation = await this.#conversation(await this.#contextRecord(botId, channelId));
		await conversation.abort(this.#context, { background });
	}

	/**
	 * New topic: the next request starts from an empty context. Older entries stay in storage and in the transcript;
	 * memory is a document, so it carries over. Pi queues the reset while the conversation is busy.
	 */
	async reset(botId: BotId, channelId = "direct"): Promise<void> {
		const conversation = await this.#conversation(await this.#contextRecord(botId, channelId));
		await conversation.reset(undefined, this.#context);
	}

	async memory(botId: BotId): Promise<string> {
		await this.#requireRecord(botId);
		return (await this.#harness.snapshot(MemoryDoc, botId, this.#context))?.content ?? "";
	}

	async memoryState(botId: BotId): Promise<MemoryState> {
		await this.#requireRecord(botId);
		return memoryState(await this.#harness.snapshot(MemoryDoc, botId, this.#context));
	}

	async setMemory(botId: BotId, content: string, expectedRevision: number): Promise<MemoryState> {
		return this.#changeMemory(botId, expectedRevision, () => content, "user");
	}

	async restoreMemory(botId: BotId, revision: number, expectedRevision: number): Promise<MemoryState> {
		return this.#changeMemory(
			botId,
			expectedRevision,
			(state) => {
				const previous = state.history.find((item) => item.revision === revision);
				if (!previous) throw new ProtocolError("not_found", "Memory version is no longer available");
				return previous.content;
			},
			"restore",
			revision,
		);
	}

	async #changeMemory(
		botId: BotId,
		expectedRevision: number,
		next: (state: MemoryState) => string,
		source: MemorySnapshot["source"],
		restoredFrom?: number,
	): Promise<MemoryState> {
		return this.#harness.commit(async (tx) => {
			const record = (await tx.doc(BotsDoc)).bots[botId];
			if (!record || record.status === "deleted") throw new ProtocolError("not_found", "Unknown or deleted Bot");
			const doc = await tx.doc(MemoryDoc, botId, null);
			const state = memoryState(doc);
			if (state.revision !== expectedRevision)
				throw new ProtocolError("request_conflict", "Memory changed. Reload before saving your draft.");
			const content = next(state);
			checkMemorySize(content);
			const { history, ...previous } = state;
			doc.history = [...history, previous].slice(-MEMORY_HISTORY_LIMIT);
			doc.content = content;
			doc.revision = state.revision + 1;
			doc.source = source;
			doc.updatedAt = Date.now();
			delete doc.restoredFrom;
			if (restoredFrom !== undefined) doc.restoredFrom = restoredFrom;
			return JSON.parse(JSON.stringify(memoryState(doc))) as MemoryState;
		}, this.#context);
	}

	/** Receipt and edit commit together; replay cannot overwrite a later user correction. */
	async editMemory(botId: BotId, edit: MemoryEdit, invocationId: string): Promise<number> {
		const fingerprint = createHash("sha256")
			.update(JSON.stringify([botId, edit.action, edit.section, edit.content, edit.expectedRevision]))
			.digest("hex");
		return this.#harness.commit(async (tx) => {
			const receipt = await tx.doc(MemoryReceiptDoc, invocationId, null);
			if (receipt.fingerprint) {
				if (receipt.fingerprint !== fingerprint) throw new ProtocolError("request_conflict", "Memory invocation arguments changed");
				return receipt.revision!;
			}
			const record = (await tx.doc(BotsDoc)).bots[botId];
			if (!record || record.status === "deleted") throw new ProtocolError("not_found", "Unknown or deleted Bot");
			const doc = await tx.doc(MemoryDoc, botId, null);
			const state = memoryState(doc);
			if (state.revision !== edit.expectedRevision)
				throw new ProtocolError("request_conflict", "Memory changed. Review the refreshed memory system section before trying again.");
			const content = applyMemoryEdit(state.content, edit);
			checkMemorySize(content);
			const { history, ...previous } = state;
			doc.history = [...history, previous].slice(-MEMORY_HISTORY_LIMIT);
			doc.content = content;
			doc.revision = state.revision + 1;
			doc.source = "model";
			doc.updatedAt = Date.now();
			delete doc.restoredFrom;
			receipt.fingerprint = fingerprint;
			receipt.revision = doc.revision;
			return doc.revision;
		}, this.#context);
	}

	/** Leave a "stopped" note in the transcript, after the user cancelled a Run. */
	async markStopped(botId: BotId, channelId = "direct"): Promise<void> {
		const conversation = await this.#conversation(await this.#contextRecord(botId, channelId));
		await conversation.submit({ type: "write", entry: { kind: STOPPED_ENTRY } }, this.#context);
	}

	/** The Bot's conversation without pending approvals; the Host adds those (`approvals` is empty here). */
	async snapshot(botId: BotId, channelId = "direct"): Promise<ConversationSnapshot> {
		const record = await this.#contextRecord(botId, channelId);
		const view = await (await this.#conversation(record)).viewState(this.#context);
		try {
			return await this.#project(record, view.value, channelId);
		} finally {
			view.dispose();
		}
	}

	/**
	 * Observe a Bot's conversation. The listener receives a projected snapshot after every commit that changes the
	 * view, starting with the current one, in commit order. Returns a function that stops observation.
	 */
	async observe(botId: BotId, listener: (snapshot: ConversationSnapshot) => void, channelId = "direct"): Promise<() => void> {
		const record = await this.#contextRecord(botId, channelId);
		const view = await (await this.#conversation(record)).viewState(this.#context);
		listener(await this.#project(record, view.value, channelId));
		// Projection may read older entries, so updates are serialized to keep snapshots in commit order.
		let queue = Promise.resolve();
		let stopped = false;
		const unsubscribe = view.subscribe((value) => {
			queue = queue
				.then(async () => {
					const snapshot = await this.#project(record, value, channelId);
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
			for (const channel of await this.channels())
				if (channel.botId === record.botId)
					await (await this.#conversation({ ...record, conversationId: channel.conversationId })).configure({ model }, this.#context);
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
	async #project(record: BotRecord, view: ConversationView, channelId = "direct"): Promise<ConversationSnapshot> {
		const marker = view.entries[0]?.head === undefined ? undefined : view.entries[0];
		const earlier = marker === undefined ? [] : await this.#earlierEntries(record, marker);
		return {
			...projectView(record.botId, view, earlier),
			conversationId: String(record.conversationId),
			...(channelId === "direct" ? {} : { channelId }),
		};
	}

	async #earlierEntries(record: BotRecord, marker: EntryRecord): Promise<readonly EntryRecord[]> {
		const cached = this.#history.get(record.conversationId);
		if (cached?.head === marker.id) return cached.entries;
		const conversation = await this.#conversation(record);
		const entries: EntryRecord[] = [];
		let cursor: Parameters<typeof conversation.entries>[2];
		do {
			const page = await conversation.entries({ maxEntryId: marker.id, order: "ascending" }, 500, cursor, this.#context);
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
	return { ...profile, revision: profile.revision ?? 1, kind: profile.kind ?? "specialist" };
}

/** Text blocks of a user or assistant message; images are not projected yet. */
function partsOf(content: string | readonly { readonly type: string }[]): MessagePart[] {
	if (typeof content === "string") return content === "" ? [] : [{ type: "text", text: content }];
	return content.flatMap((block) =>
		block.type === "text" && "text" in block && typeof block.text === "string" ? [{ type: "text" as const, text: block.text }] : [],
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
		.flatMap((block) =>
			block.type === "thinking" && block.redacted !== true && block.thinking.trim() !== "" ? [block.thinking.trim()] : [],
		)
		.join("\n\n");
	return text === "" ? undefined : text;
}

type MutableToolItem = { kind: "tool"; id: string; tool: string; args: unknown; status: ToolCallStatus; output?: string; taskId?: string };

/** What the model receives for an `unknown` outcome, instead of the executor's text (Section 5.1). */
export const UNKNOWN_OUTCOME_TEXT = "This action was interrupted and may have partly run. Check its effect before doing anything else.";

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
				item.output = partsOf(message.content)
					.map((part) => part.text)
					.join("\n");
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
			MutableToolItem | undefined;
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
			const bots = (await api.snapshot(BotsDoc, context))?.bots ?? {};
			const direct = Object.values(bots).find((bot) => bot.conversationId === Number(api.conversationId));
			const channel = Object.values((await api.snapshot(ChannelsDoc, context))?.channels ?? {}).find(
				(item) => item.conversationId === Number(api.conversationId),
			);
			const botId = direct?.botId ?? channel?.botId;
			if (!botId) throw new Error("No Bot owns this conversation");
			const signal = context.abortSignal ?? new AbortController().signal;
			let authority: ManagementAuthority | undefined;
			if (definition.capability.endsWith(".management")) {
				const saved = await api.memo<{ origin: "user"; runId: string } | null>("openbot.management-authority", context);
				if (saved !== undefined) authority = saved ?? undefined;
				else {
					const runs = Object.values((await api.snapshot(RunsDoc, context))?.runs ?? {});
					const run = runs.find(
						(r) => r.botId === botId && (r.channelId ?? "direct") === "direct" && !!direct && r.state === "running" && r.origin === "user",
					);
					authority =
						(await api.memo("openbot.management-authority", run ? { origin: "user" as const, runId: run.runId } : null, context)) ??
						undefined;
				}
			}
			let collaboration: { runId: string } | undefined;
			if (definition.capability === "collaboration") {
				const saved = await api.memo<{ runId: string } | null>("openbot.collaboration-authority", context);
				if (saved !== undefined) collaboration = saved ?? undefined;
				else {
					const runs = Object.values((await api.snapshot(RunsDoc, context))?.runs ?? {});
					const run = runs.find(
						(r) => r.botId === botId && (r.channelId ?? "direct") === (channel?.channelId ?? "direct") && r.state === "running",
					);
					collaboration = (await api.memo("openbot.collaboration-authority", run ? { runId: run.runId } : null, context)) ?? undefined;
				}
			}
			let runId = await api.memo<string | null>("openbot.run-id", context);
			if (runId === undefined) {
				const runs = Object.values((await api.snapshot(RunsDoc, context))?.runs ?? {});
				const run = runs.find(
					(r) => r.botId === botId && (r.channelId ?? "direct") === (channel?.channelId ?? "direct") && r.state === "running",
				);
				runId = await api.memo("openbot.run-id", run?.runId ?? null, context);
			}
			const outcome = await invoke({
				...(runId ? { runId } : {}),
				...(collaboration ? { collaboration } : {}),
				...(authority === undefined ? {} : { authority }),
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

async function committedManagement(tx: Tx, proposal?: BotManagementProposal): Promise<BotProfile | undefined> {
	if (!proposal) return undefined;
	const record = (await tx.doc(ManagementDoc)).operations[proposal.invocationId];
	if (!record || record.fingerprint !== proposal.fingerprint) throw new ProtocolError("request_conflict", "Management proposal mismatch");
	if (record.outcome) throw new ProtocolError("request_conflict", "Management request already ended");
	return record.result ? (JSON.parse(JSON.stringify(record.result)) as BotProfile) : undefined;
}
async function completeManagement(tx: Tx, proposal: BotManagementProposal | undefined, result: BotProfile): Promise<void> {
	if (proposal) (await tx.doc(ManagementDoc)).operations[proposal.invocationId] = { ...proposal, result, completedAt: Date.now() };
}

function revisionedInstructions(instructions: string, revision: number): string {
	return `OpenBot profile revision: ${revision}.\n${instructions}`;
}
