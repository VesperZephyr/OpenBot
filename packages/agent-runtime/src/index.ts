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
	type PromptSection,
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
	type ToolCallStatus,
	type ToolDefinition,
	type TranscriptItem,
} from "@openbot/protocol";

import { buildConfiguredProviders, type ConfigEnvironment, type ModelConfigStatus } from "./model-config.ts";
import { type RunStore, runStore } from "./runs.ts";

const TOOLS_EXTENSION = "openbot.tools";
/** Display-only transcript entry written when the user stops a Run. */
const STOPPED_ENTRY = "openbot.stopped";

/** Credential contract the Host implements over the Keychain; re-exported so the Host never imports Pi. */
export type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
export type { ConfigEnvironment, ConfiguredProviderStatus, ModelConfigStatus } from "./model-config.ts";
export { SUPPORTED_MODEL_APIS } from "./model-config.ts";
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
}) => Promise<{ readonly status: string; readonly output: string }>;

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
		const registry = createRegistry();
		if (options.tools !== undefined) {
			const { invoke, definitions } = options.tools;
			registry.install(
				defineExtension({
					name: TOOLS_EXTENSION,
					tools: definitions.map((definition) => routedTool(definition, invoke)),
					sections: [workspaceSection],
				}),
			);
		}
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

/** Text blocks of a user or assistant message; images and thinking are not projected yet. */
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

type MutableToolItem = { kind: "tool"; id: string; tool: string; args: unknown; status: ToolCallStatus; output?: string };

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
			case "pi.user":
				items.push({ kind: "user", id, parts: textParts(entry) });
				break;
			case "pi.assistant": {
				const message = entry.model?.[0];
				const error =
					message?.role === "assistant" && (message.stopReason === "error" || message.stopReason === "aborted")
						? (message.errorMessage ?? message.stopReason)
						: undefined;
				const parts = textParts(entry);
				if (parts.length > 0 || error !== undefined) {
					items.push({ kind: "assistant", id, parts, ...(error === undefined ? {} : { error }) });
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
				item.status = !message.isError ? "succeeded" : wasAborted(entry) ? "cancelled" : "failed";
				item.output = partsOf(message.content).map((part) => part.text).join("\n");
				break;
			}
			case STOPPED_ENTRY:
				items.push({ kind: "stopped", id });
				break;
			case "pi.system":
			case "pi.reset":
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

function projectView(botId: BotId, view: ConversationView): ConversationSnapshot {
	// Pi's view exposes built-in documents as untyped JSON keyed by kind; `pi.live` always holds a LiveState.
	const liveDoc: LiveState | undefined = view.docs[LiveDoc.definition.kind];
	const items = toTranscript(view.entries);
	// Running tool slots carry live status and output until their result entry exists.
	for (const slot of liveDoc?.tools ?? []) {
		const item = items.find((entry): entry is MutableToolItem => entry.kind === "tool" && entry.id === slot.callId) as
			| MutableToolItem
			| undefined;
		if (item === undefined || item.status === "succeeded" || item.status === "failed" || item.status === "cancelled") continue;
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
			const failed = outcome.status !== "succeeded";
			return {
				output: [{ type: "text", text: outcome.output === "" ? "(no output)" : outcome.output }],
				isError: failed,
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

/** Tells the model where it works and how the tools behave. */
const workspaceSection: PromptSection = {
	key: "openbot",
	render: () =>
		[
			"You are a Bot in OpenBot, working on the user's own Mac through tools.",
			"Reply briefly before you start a multi-step task, then work; keep the user informed in short sentences.",
			"File tools work inside folders the user granted, starting with the shared workspace; relative paths are resolved against it.",
			"Every shell command waits for the user's approval. A denied call means the user declined it: adjust instead of retrying it unchanged.",
			"Prefer the file tools over shell commands for reading and editing files. Write answers in GitHub-flavored Markdown.",
		].join("\n"),
};
