import { PublicTranscript } from "./public-transcript.ts";
/** Pi-side projection queue. Only identities cross the synchronous commit listener. */
import { createHash } from "node:crypto";
import { stat, rm } from "node:fs/promises";
import { setImmediate as yieldTurn } from "node:timers/promises";
import type { Harness, ConversationId, EntryId } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord/context";
import {
	ProtocolError,
	historyPartition,
	type ConversationKey,
	type ConversationPreview,
	type DetailInput,
	type DetailResult,
	type IndexStatus,
	type TranscriptItem,
	type WindowInput,
	type WindowResult,
} from "@openbot/protocol";
import { BotsDoc } from "./bots.ts";
import { RoutinesDoc } from "./routines.ts";
import { AppExecutionsDoc } from "./app-executions.ts";
import { GroupsDoc } from "./groups.ts";
import { directMessages, groupMessages } from "./conversation-index.ts";
import { HistoryClient } from "./history-client.ts";
import type { DisplayWrite, HistoryBatch, HistoryMessage } from "./history-store.ts";
import { toTranscript } from "./transcript.ts";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const partition = (key: ConversationKey, deliveryId?: string, occurrenceId?: string) =>
	historyPartition({ conversationKey: key, ...(deliveryId ? { deliveryId } : {}), ...(occurrenceId ? { occurrenceId } : {}) });
type Channel = { botId: string; channelId: string; conversationId: number };
type Source = {
	key: ConversationKey;
	partition: string;
	conversationId?: number;
	botId?: string;
	deliveryId?: string;
	occurrenceId?: string;
};
type Checkpoint = { source: number | string; position: number; hash: string };
/** UTF-8 byte bound without splitting a surrogate pair. */
export function* historyChunks(text: string, max = 32768): Generator<string> {
	let part = "",
		bytes = 0;
	for (const point of text) {
		const n = Buffer.byteLength(point);
		if (bytes + n > max) {
			yield part;
			part = "";
			bytes = 0;
		}
		part += point;
		bytes += n;
	}
	if (part) yield part;
}
export class HistoryProjection {
	#worker: HistoryClient | undefined;
	#sources = new Map<string, Source>();
	#validated = new Set<string>();
	// Only identity and digest metadata are retained; settled transcript bodies stay in the worker.
	#executionHashes = new Map<string, string>();
	#dirty = new Set<number | string>();
	#rescan = true;
	#busy = false;
	#closed = false;
	#unavailable = false;
	#restarts = 0;
	#stop: () => void;
	#line: Promise<void> = Promise.resolve();
	#source = "";
	#selected: string | undefined;
	#reads = 0;
	private harness: Harness;
	private context: Context;
	private options: {
		path: string;
		databasePath: string;
		workerUrl?: string;
		channels: () => Promise<readonly Channel[]>;
		changed: () => void;
	};
	constructor(harness: Harness, context: Context, options: HistoryProjection["options"]) {
		this.harness = harness;
		this.context = context;
		this.options = options;
		this.#stop = harness.subscribeCommits((publication) => {
			for (const change of publication.changes) {
				if (change.type === "entry") this.dirty(change.value.conversationId);
				else if (
					change.type === "document" &&
					["openbot.bots", "openbot.channels", "openbot.groups", "openbot.routines", "openbot.app-executions"].includes(change.record.kind)
				)
					this.dirty("catalog");
			}
		});
		this.schedule();
	}
	private dirty(id: number | string) {
		if (this.#rescan) return;
		if (this.#dirty.size >= 256) {
			this.#dirty.clear();
			this.#rescan = true;
		} else this.#dirty.add(id);
		this.schedule();
	}
	private schedule() {
		if (this.#busy || this.#closed || this.#unavailable) return;
		this.#busy = true;
		this.#line = this.run()
			.catch(() => this.failed())
			.finally(() => {
				this.#busy = false;
				if (!this.#closed && !this.#unavailable && (this.#rescan || this.#dirty.size)) this.schedule();
			});
	}
	private async open() {
		const info = await stat(this.options.databasePath);
		this.#source = JSON.stringify([4, String(info.dev), String(info.ino)]);
		this.#worker = await HistoryClient.open(this.options.path, this.#source, this.options.workerUrl);
		this.#worker.onFailure = () => {
			this.#rescan = true;
			this.schedule();
		};
	}
	private async catalog() {
		const bots = (await this.harness.snapshot(BotsDoc, this.context))?.bots ?? {};
		const groups = await this.harness.snapshot(GroupsDoc, this.context);
		for (const bot of Object.values(bots))
			if (bot.status !== "deleted")
				this.#sources.set(partition(`bot:${bot.botId}`), {
					key: `bot:${bot.botId}`,
					partition: partition(`bot:${bot.botId}`),
					conversationId: bot.conversationId,
					botId: bot.botId,
				});
		for (const group of Object.values(groups?.groups ?? {}))
			this.#sources.set(partition(`group:${group.groupId}`), {
				key: `group:${group.groupId}`,
				partition: partition(`group:${group.groupId}`),
			});
	}
	private async run() {
		await yieldTurn();
		if (!this.#worker) await this.open();
		while (!this.#closed && (this.#rescan || this.#dirty.size)) {
			const all = this.#rescan;
			this.#rescan = false;
			const dirty = this.#dirty;
			this.#dirty = new Set();
			if (all || dirty.has("catalog")) await this.catalog();
			for (const source of [...this.#sources.values()].sort(
				(a, b) => Number(b.partition === this.#selected) - Number(a.partition === this.#selected),
			)) {
				if (this.#closed) return;
				if (
					all ||
					dirty.has("catalog") ||
					dirty.has(source.partition) ||
					(source.conversationId !== undefined && dirty.has(source.conversationId))
				) {
					if (await this.project(source)) this.#validated.add(source.partition);
				}
				await yieldTurn();
			}
		}
		this.options.changed();
	}
	private async failed() {
		await this.#worker?.close().catch(() => {});
		this.#worker = undefined;
		this.#validated.clear();
		this.#executionHashes.clear();
		if (this.#closed) return;
		if (this.#restarts++ < 1) {
			try {
				await this.discard();
				this.#rescan = true;
			} catch {
				this.#unavailable = true;
				this.options.changed();
			}
		} else {
			this.#unavailable = true;
			this.options.changed();
		}
	}
	private async discard() {
		for (const suffix of ["", "-wal", "-shm"]) await rm(this.options.path + suffix, { force: true });
	}
	async retry() {
		if (this.#busy) return;
		this.#restarts = 0;
		await this.#worker?.close();
		this.#worker = undefined;
		this.#validated.clear();
		this.#executionHashes.clear();
		await this.discard();
		this.#unavailable = false;
		this.#rescan = true;
		this.schedule();
	}
	status(): IndexStatus {
		return {
			state: this.#unavailable ? "unavailable" : this.#busy || this.#rescan || this.#dirty.size ? "building" : "ready",
			retryable: this.#unavailable,
		};
	}
	async close() {
		this.#closed = true;
		this.#stop();
		await this.#line;
		await this.#worker?.close();
	}
	private async call<T>(command: Parameters<HistoryClient["call"]>[0]): Promise<T> {
		if (!this.#worker) throw Error("History is unavailable");
		return this.#worker.call<T>(command);
	}
	private async checkpoint(source: Source): Promise<Checkpoint | undefined> {
		const saved = await this.call<string | undefined>({ method: "checkpoint", partition: source.partition });
		return saved ? (JSON.parse(saved) as Checkpoint) : undefined;
	}
	private async project(source: Source) {
		let checkpoint = await this.checkpoint(source);
		if (source.conversationId !== undefined) {
			const conversation = await this.harness.conversation(source.conversationId as ConversationId, this.context);
			if (!conversation) return false;
			if (checkpoint) {
				const entry = checkpoint.position
					? (
							await conversation.entries(
								{ minEntryId: checkpoint.position as EntryId, maxEntryId: checkpoint.position as EntryId },
								1,
								undefined,
								this.context,
							)
						).items[0]
					: undefined;
				if (checkpoint.source !== source.conversationId || (checkpoint.position && (!entry || digest(entry) !== checkpoint.hash)))
					throw Error("History source changed");
			}
			const selector = new PublicTranscript(this.harness, this.context);
			let mode = await selector.mode(source.conversationId);
			let cursor: Parameters<typeof conversation.entries>[2];
			const executions = Object.values((await this.harness.snapshot(AppExecutionsDoc, this.context))?.executions ?? {}).filter(
				(e) => e.conversationId === String(source.conversationId),
			);
			do {
				const page = await conversation.entries(
					{ ...(checkpoint?.position ? { minEntryId: (checkpoint.position + 1) as EntryId } : {}), order: "ascending" },
					256,
					cursor,
					this.context,
				);
				const rows: DisplayWrite[] = [],
					messages: HistoryMessage[] = [];
				let batch: HistoryBatch = {
					partition: source.partition,
					...(!source.deliveryId && !source.occurrenceId ? { key: source.key } : {}),
					rows,
					messages,
					checkpoint: JSON.stringify(checkpoint ?? { source: source.conversationId, position: 0, hash: "" }),
					ready: false,
				};
				const flush = async () => {
					if (rows.length || messages.length) {
						await this.call({ method: "apply", batch });
						rows.length = 0;
						messages.length = 0;
					}
				};
				for (const entry of page.items) {
					if (this.#closed) return;
					let seed: TranscriptItem[] = [];
					let link: { source: number; ordinal: number } | undefined;
					const result = entry.kind === "pi.tool-result" ? entry.model?.[0] : undefined;
					if (result?.role === "toolResult") {
						await flush();
						link = await this.call({ method: "link", partition: source.partition, rowId: result.toolCallId });
						if (link) {
							const original = (
								await conversation.entries(
									{ minEntryId: link.source as EntryId, maxEntryId: link.source as EntryId },
									1,
									undefined,
									this.context,
								)
							).items[0];
							if (original) seed = toTranscript([original]).filter((item) => item.kind === "tool" && item.id === result.toolCallId);
						}
					}
					let offset = 0;
					if (entry.kind === "openbot.messages-v1") mode = entry.id;
					const selection = await selector.select(entry, mode, seed);
					if (selection.remove.length) { await flush(); await this.call({ method: "apply", batch: { ...batch, rows: [], messages: [], removeRows: selection.remove } }); }
					for (let item of selection.items) {
						const execution = executions.find((e) => e.parentCallId === item.id);
						if (item.kind === "tool" && execution) item = { ...item, execution };
						let ordinal = link?.ordinal ?? selection.source * 1024 + offset++;
						if (entry.kind === "pi.compaction" && entry.head !== undefined) {
							await flush();
							ordinal = await this.call<number>({
								method: "compactionOrdinal",
								partition: source.partition,
								rowId: item.id,
								head: entry.head,
							});
						}
						if (!Number.isSafeInteger(ordinal) || offset >= 512) throw Error("History ordinal exceeds limit");
						const row = await this.prepare(source, item.id, ordinal, link?.source ?? selection.source, { kind: "direct", item });
						if (result?.role === "toolResult") row.resultSource = entry.id;
						const publicMessages =
							source.deliveryId || source.occurrenceId ? [] : directMessages({ botId: source.botId!, items: [item], approvals: [] });
						for (const message of publicMessages) messages.push(await this.message(source, message));
						rows.push(row);
						if (rows.length + messages.length >= 128 || size(batch) > 256 * 1024) await flush();
					}
					checkpoint = { source: source.conversationId, position: entry.id, hash: digest(entry) };
					batch.checkpoint = JSON.stringify(checkpoint);
				}
				await flush();
				cursor = page.next;
				if (!cursor) {
					await flush();
					// CodeMode child state can change without a Pi transcript entry. Refresh only its indexed call rows.
					for (const execution of executions) {
						const identity = JSON.stringify([source.partition, execution.executionId]),
							hash = digest(execution);
						if (this.#executionHashes.get(identity) === hash) continue;
						const link = await this.call<{ source: number; ordinal: number; resultSource?: number } | undefined>({
							method: "link",
							partition: source.partition,
							rowId: execution.parentCallId,
						});
						if (!link) continue;
						const original = (
							await conversation.entries(
								{ minEntryId: link.source as EntryId, maxEntryId: link.source as EntryId },
								1,
								undefined,
								this.context,
							)
						).items[0];
						if (!original) continue;
						let items = toTranscript([original]).filter((i) => i.id === execution.parentCallId);
						if (link.resultSource) {
							const result = (
								await conversation.entries(
									{ minEntryId: link.resultSource as EntryId, maxEntryId: link.resultSource as EntryId },
									1,
									undefined,
									this.context,
								)
							).items[0];
							if (result) items = toTranscript([result], items);
						}
						const item = items[0];
						if (item?.kind !== "tool") continue;
						const row = await this.prepare(source, item.id, link.ordinal, link.source, { kind: "direct", item: { ...item, execution } });
						if (link.resultSource) row.resultSource = link.resultSource;
						await this.call({ method: "apply", batch: { ...batch, rows: [row], messages: [], ready: false } });
						this.#executionHashes.set(identity, hash);
					}
					await this.call({ method: "apply", batch: { ...batch, ready: true } });
				} else this.dirty(source.partition);
				return !cursor;
			} while (cursor && !this.#closed);
		} else {
			const state = await this.harness.snapshot(GroupsDoc, this.context),
				id = source.key.slice(6),
				posts = state?.posts[id] ?? [];
			const identity = JSON.stringify([id, state?.groups[id]?.createdAt]);
			if (
				checkpoint &&
				(checkpoint.source !== identity ||
					checkpoint.position > posts.length ||
					(checkpoint.position && digest(posts[checkpoint.position - 1]) !== checkpoint.hash))
			)
				throw Error("History source changed");
			for (let start = checkpoint?.position ?? 0; start < posts.length; start += 64) {
				const rows: DisplayWrite[] = [],
					messages: HistoryMessage[] = [];
				for (let i = start; i < Math.min(start + 64, posts.length); i++) {
					const post = posts[i]!;
					rows.push(await this.prepare(source, post.postId, i, 0, { kind: "group", post }));
					for (const message of groupMessages([post])) messages.push(await this.message(source, message));
					checkpoint = { source: identity, position: i + 1, hash: digest(post) };
					if (size({ rows, messages }) > 256 * 1024) {
						await this.call({
							method: "apply",
							batch: {
								partition: source.partition,
								key: source.key,
								rows: rows.splice(0),
								messages: messages.splice(0),
								checkpoint: JSON.stringify(checkpoint),
								ready: false,
							},
						});
					}
				}
				await this.call({
					method: "apply",
					batch: { partition: source.partition, key: source.key, rows, messages, checkpoint: JSON.stringify(checkpoint), ready: false },
				});
				await yieldTurn();
				if (this.#closed) return false;
				if (start + 64 < posts.length) {
					this.dirty(source.partition);
					return false;
				}
			}
			await this.call({
				method: "apply",
				batch: {
					partition: source.partition,
					key: source.key,
					rows: [],
					messages: [],
					checkpoint: JSON.stringify(checkpoint ?? { source: identity, position: 0, hash: "" }),
					ready: true,
				},
			});
		}
		return true;
	}
	private async prepare(
		source: Source,
		id: string,
		ordinal: number,
		entry: number,
		content: Extract<DisplayWrite["content"], { kind: "direct" | "group" }>,
	): Promise<DisplayWrite> {
		const hash = digest(content),
			toolIds = content.kind === "direct" && content.item.kind === "tool" ? [id] : [];
		if (size(content) <= 32768) return { id, ordinal, source: entry, hash, content, toolIds };
		// The text is derived exclusively from the existing authorized display object, never raw Pi data.
		const fields = content.kind === "direct" ? content.item : content.post;
		let preview = "",
			part = 0;
		for (const [field, value] of Object.entries(fields)) {
			if (["kind", "id", "postId", "rootId", "replyTo"].includes(field)) continue;
			const label = field === "parts" || field === "text" ? "Message" : field.replace(/([A-Z])/g, " $1");
			const body =
				field === "parts" && Array.isArray(value)
					? value.map((part) => part.text ?? "").join("\n\n")
					: typeof value === "string"
						? value
						: JSON.stringify(value);
			const text = `${label}: ${body}\n`;
			for (const chunk of historyChunks(text)) {
				await this.call({ method: "stageDetail", partition: source.partition, rowId: id, part: part++, text: chunk });
				if (Buffer.byteLength(preview) < 8192) preview += historyChunks(chunk, 8192 - Buffer.byteLength(preview)).next().value ?? "";
			}
		}
		return {
			id,
			ordinal,
			source: entry,
			hash,
			toolIds,
			detailParts: part,
			content: { kind: "large", originalKind: content.kind === "direct" ? content.item.kind : "group", preview, detail: "" },
		};
	}
	private async message(source: Source, message: ConversationPreview): Promise<HistoryMessage> {
		if (size(message) <= 32768) return { ...message, conversationKey: source.key };
		let part = 0;
		for (const text of historyChunks(message.text))
			await this.call({ method: "stageMessage", partition: source.partition, rowId: message.id, part: part++, text });
		return { ...message, text: "", conversationKey: source.key };
	}
	private async authorize(key: ConversationKey, deliveryId?: string, occurrenceId?: string): Promise<Source> {
		if (deliveryId && occurrenceId) throw new ProtocolError("invalid_request", "Choose one history selector");
		if (key.startsWith("bot:")) {
			if (deliveryId) throw new ProtocolError("invalid_request", "Delivery requires a group");
			const bot = (await this.harness.snapshot(BotsDoc, this.context))?.bots[key.slice(4)];
			if (!bot || bot.status === "deleted") throw new ProtocolError("not_found", "Conversation is unavailable");
			if (occurrenceId) {
				const routines = await this.harness.snapshot(RoutinesDoc, this.context),
					occurrence = routines?.occurrences[occurrenceId];
				const routine = occurrence && routines?.routines[occurrence.routineId];
				if (
					!occurrence ||
					!routine ||
					occurrence.botId !== bot.botId ||
					routine.botId !== bot.botId ||
					!occurrence.channelId.startsWith("routine_")
				)
					throw new ProtocolError("not_found", "Occurrence is unavailable");
				const channel = (await this.options.channels()).find((c) => c.botId === bot.botId && c.channelId === occurrence.channelId);
				if (!channel) throw new ProtocolError("not_found", "Occurrence is unavailable");
				return {
					key,
					partition: partition(key, undefined, occurrenceId),
					occurrenceId,
					conversationId: channel.conversationId,
					botId: bot.botId,
				};
			}
			return { key, partition: partition(key), conversationId: bot.conversationId, botId: bot.botId };
		}
		if (occurrenceId) throw new ProtocolError("invalid_request", "Occurrence requires a Bot");
		const groups = await this.harness.snapshot(GroupsDoc, this.context),
			id = key.slice(6);
		if (!groups?.groups[id]) throw new ProtocolError("not_found", "Conversation is unavailable");
		if (!deliveryId) return { key, partition: partition(key) };
		const delivery = groups.deliveries[deliveryId];
		if (!delivery || delivery.groupId !== id) throw new ProtocolError("not_found", "Delivery is unavailable");
		const channel = (await this.options.channels()).find((channel) => channel.botId === delivery.botId && channel.channelId === id);
		if (!channel) throw new ProtocolError("not_found", "Delivery is unavailable");
		return { key, partition: partition(key, deliveryId), deliveryId, conversationId: channel.conversationId, botId: channel.botId };
	}
	async window(input: WindowInput): Promise<WindowResult> {
		const source = await this.authorize(input.conversationKey, input.deliveryId, input.occurrenceId);
		this.#selected = source.partition;
		if (!this.#sources.has(source.partition)) {
			this.#sources.set(source.partition, source);
			this.dirty(source.partition);
		}
		if (this.#unavailable) return { status: "unavailable", retryable: true };
		if (
			!this.#worker ||
			!this.#validated.has(source.partition) ||
			this.#dirty.has(source.conversationId ?? source.partition) ||
			this.#dirty.has("catalog")
		)
			return { status: "building" };
		try {
			const result = await this.call<WindowResult>({ method: "window", input });
			await this.authorize(input.conversationKey, input.deliveryId, input.occurrenceId);
			return result;
		} catch (error) {
			if (error instanceof ProtocolError) throw error;
			return { status: "unavailable", retryable: true };
		}
	}
	async detail(input: DetailInput): Promise<DetailResult> {
		let delivery: string | undefined, occurrence: string | undefined;
		try {
			const token = await this.call<{ partition: string }>({ method: "resolveDetail", key: input.conversationKey, token: input.detail });
			const [key, kind, id] = JSON.parse(token.partition);
			if (key !== input.conversationKey) throw Error();
			if (kind === "delivery") delivery = id;
			else if (kind === "occurrence") occurrence = id;
			else if (kind !== null) throw Error();
		} catch (error) {
			if (error instanceof ProtocolError) throw error;
			throw new ProtocolError("invalid_request", "Invalid detail reference");
		}
		const source = await this.authorize(input.conversationKey, delivery, occurrence);
		if (!this.#validated.has(source.partition)) throw Error("History is still indexing");
		const result = await this.call<DetailResult>({ method: "detail", key: input.conversationKey, token: input.detail, part: input.part });
		await this.authorize(input.conversationKey, delivery, occurrence);
		return result;
	}
	async search(query: string, keys: ConversationKey[], scope: string, cursor?: string, signal?: AbortSignal) {
		if (this.#reads >= 4) throw Error("History is busy");
		this.#reads++;
		const bounded = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(5000)]);
		try {
			return await this.searchReady(query, keys, scope, cursor, bounded);
		} catch (error) {
			if (bounded.aborted && !signal?.aborted) throw Error("History read timed out");
			throw error;
		} finally {
			this.#reads--;
		}
	}
	private async searchReady(query: string, keys: ConversationKey[], scope: string, cursor?: string, signal?: AbortSignal) {
		const deadline = Date.now() + 4900;
		while (!this.#closed && !this.#unavailable) {
			signal?.throwIfAborted();
			if (this.#worker && keys.every((key) => this.#validated.has(partition(key))) && !this.#busy)
				try {
					return await this.#worker.call<import("@openbot/protocol").ConversationSearchResult>(
						{ method: "search", query, keys, scope, ...(cursor ? { cursor } : {}) },
						signal,
					);
				} catch (error) {
					if (error instanceof ProtocolError || !(error instanceof Error) || error.message !== "History is still indexing") throw error;
				}
			if (Date.now() >= deadline) break;
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		throw Error("History is unavailable");
	}
	async contextMessages(key: ConversationKey, id: string, before: number, after: number, signal?: AbortSignal) {
		await this.authorize(key);
		if (this.#reads >= 4) throw Error("History is busy");
		this.#reads++;
		const bounded = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(5000)]);
		try {
			while (!this.#closed && !this.#unavailable) {
				bounded.throwIfAborted();
				if (this.#worker && this.#validated.has(partition(key)) && !this.#busy) {
					const result = await this.#worker.call<{ messages: ConversationPreview[]; hasBefore: boolean; hasAfter: boolean }>(
						{ method: "context", key, rowId: id, before, after },
						bounded,
					);
					await this.authorize(key);
					return result;
				}
				await new Promise((resolve) => setTimeout(resolve, 20));
			}
			throw Error("History is unavailable");
		} catch (error) {
			if (bounded.aborted && !signal?.aborted) throw Error("History read timed out");
			throw error;
		} finally {
			this.#reads--;
		}
	}
}
