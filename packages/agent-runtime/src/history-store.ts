/** Disposable display/search data. This database never owns an execution or an approval. */
import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
import { setImmediate as yieldTurn } from "node:timers/promises";
import {
	APP_MAX_RESULT_BYTES,
	ProtocolError,
	historyPartition,
	type ConversationKey,
	type ConversationPreview,
	type ConversationSearchResult,
	type ConversationSearchHit,
	type TimelineRow,
	type WindowInput,
	type WindowResult,
	type DetailResult,
} from "@openbot/protocol";

export const HISTORY_BATCH_BYTES = 512 * 1024;
export const HISTORY_DETAIL_BYTES = 32 * 1024;
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const lexical = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const normalizeHistoryText = (text: string) =>
	text
		.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ")
		.replace(/\s+/gu, " ")
		.trim();
export type HistoryMessage = ConversationPreview & { conversationKey: ConversationKey };
export type DisplayWrite = {
	id: string;
	ordinal: number;
	source: number;
	resultSource?: number;
	content: TimelineRow["content"];
	hash: string;
	toolIds?: string[];
	detailParts?: number;
};
export type HistoryBatch = {
	partition: string;
	key?: ConversationKey;
	rows: DisplayWrite[];
	messages: HistoryMessage[];
	checkpoint: string;
	ready: boolean;
};
type SearchCursor = { binding: string; generation: string; high: number; at: number; key: string; id: string };
function decodeCursor(value: string, binding: string, generation: string): SearchCursor {
	try {
		if (value.length > 4096) throw Error();
		const c = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
		if (
			!c ||
			Object.keys(c).sort().join() !== "at,binding,generation,high,id,key" ||
			c.binding !== binding ||
			c.generation !== generation ||
			!Number.isSafeInteger(c.high) ||
			c.high < 0 ||
			!Number.isFinite(c.at) ||
			typeof c.key !== "string" ||
			typeof c.id !== "string"
		)
			throw Error();
		return c;
	} catch {
		throw new ProtocolError("invalid_request", "Invalid application cursor");
	}
}
export class HistoryStore {
	readonly db: DatabaseSync;
	readonly generation: string;
	#metadataBytes = 0;
	constructor(path: string, source: string) {
		this.db = new DatabaseSync(path);
		this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000;");
		const version = this.db.prepare("PRAGMA user_version").get() as { user_version: number };
		if (version.user_version !== 0 && version.user_version !== 1) throw Error("Unsupported history cache");
		this.db.exec(`CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY CHECK(id=1), source TEXT NOT NULL, generation TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS conversations (key TEXT PRIMARY KEY, ready INTEGER NOT NULL DEFAULT 0, checkpoint TEXT NOT NULL DEFAULT '',message_count INTEGER NOT NULL DEFAULT 0,incoming INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE IF NOT EXISTS messages (sequence INTEGER PRIMARY KEY AUTOINCREMENT, conversation_key TEXT NOT NULL, id TEXT NOT NULL, sender TEXT NOT NULL, at REAL NOT NULL, original TEXT NOT NULL, normalized TEXT NOT NULL, key_order BLOB NOT NULL, id_order BLOB NOT NULL, UNIQUE(conversation_key,id));
   CREATE INDEX IF NOT EXISTS message_order ON messages(at DESC,key_order,id_order);
 CREATE INDEX IF NOT EXISTS message_seek ON messages((-at),key_order,id_order);
 CREATE TABLE IF NOT EXISTS stats (key TEXT PRIMARY KEY,value INTEGER NOT NULL);
   CREATE INDEX IF NOT EXISTS message_context ON messages(conversation_key,sequence);
   CREATE TABLE IF NOT EXISTS rows (partition TEXT NOT NULL,id TEXT NOT NULL,ordinal REAL NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(partition,id));
   CREATE UNIQUE INDEX IF NOT EXISTS timeline_order ON rows(partition,ordinal);
   CREATE TABLE IF NOT EXISTS tool_links (partition TEXT NOT NULL, id TEXT NOT NULL, source INTEGER NOT NULL, ordinal INTEGER NOT NULL,resultSource INTEGER,PRIMARY KEY(partition,id));
   CREATE TABLE IF NOT EXISTS staged_details (partition TEXT NOT NULL,id TEXT NOT NULL,part INTEGER NOT NULL,text TEXT NOT NULL,PRIMARY KEY(partition,id,part));
   CREATE TABLE IF NOT EXISTS staged_messages (partition TEXT NOT NULL,id TEXT NOT NULL,original TEXT NOT NULL, normalized TEXT NOT NULL,PRIMARY KEY(partition,id));
   CREATE TABLE IF NOT EXISTS detail_refs (reference TEXT PRIMARY KEY,partition TEXT NOT NULL,id TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS details (partition TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,part INTEGER NOT NULL,text TEXT NOT NULL,PRIMARY KEY(partition,id,revision,part));
   CREATE TABLE IF NOT EXISTS display_state (partition TEXT PRIMARY KEY,revision INTEGER NOT NULL DEFAULT 0,incoming INTEGER NOT NULL DEFAULT 0,ready INTEGER NOT NULL DEFAULT 0,checkpoint TEXT NOT NULL DEFAULT '');
   PRAGMA user_version=1;`);
		if (!(this.db.prepare("PRAGMA table_info(tool_links)").all() as { name: string }[]).some((c) => c.name === "resultSource"))
			throw Error("Unsupported history cache");
		const meta = this.db.prepare("SELECT source,generation FROM meta WHERE id=1").get() as
			| { source: string; generation: string }
			| undefined;
		if (meta?.source !== source) {
			this.db.exec(
				"BEGIN; DELETE FROM messages; DELETE FROM conversations; DELETE FROM rows; DELETE FROM details; DELETE FROM display_state; DELETE FROM tool_links; DELETE FROM staged_details; DELETE FROM staged_messages; DELETE FROM detail_refs; DELETE FROM meta;",
			);
			this.db.prepare("INSERT INTO meta VALUES(1,?,?)").run(source, randomUUID());
			this.db.exec("COMMIT");
		}
		this.generation = (this.db.prepare("SELECT generation FROM meta WHERE id=1").get() as { generation: string }).generation;
		this.#metadataBytes = Number(
			(this.db.prepare("SELECT value FROM stats WHERE key='metadata'").get() as { value: number } | undefined)?.value ?? 0,
		);
	}
	close() {
		this.db.close();
	}
	begin(key: ConversationKey) {
		this.db.prepare("INSERT INTO conversations(key) VALUES(?) ON CONFLICT(key) DO UPDATE SET ready=0").run(key);
	}
	finish(key: ConversationKey, checkpoint: string) {
		this.db.prepare("UPDATE conversations SET ready=1,checkpoint=? WHERE key=?").run(checkpoint, key);
	}
	ingest(messages: readonly HistoryMessage[], checkpoint?: { key: ConversationKey; value: string }): void {
		if (messages.length > 256 || bytes(messages) > HISTORY_BATCH_BYTES) throw Error("History batch exceeds limit");
		this.db.exec("BEGIN");
		try {
			const insert = this.db.prepare(
				"INSERT INTO messages(conversation_key,id,sender,at,original,normalized,key_order,id_order) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(conversation_key,id) DO NOTHING",
			);
			for (const m of messages) {
				this.metadata(m);
				insert.run(
					m.conversationKey,
					m.id,
					m.senderId,
					m.at,
					m.text,
					normalizeHistoryText(m.text),
					sortKey(m.conversationKey),
					sortKey(m.id),
				);
			}
			if (checkpoint) this.db.prepare("UPDATE conversations SET checkpoint=? WHERE key=?").run(checkpoint.value, checkpoint.key);
			this.db.exec("COMMIT");
		} catch (error) {
			try {
				this.db.exec("ROLLBACK");
			} catch {
				/* SQLite may already have rolled back a failed write. */
			}
			throw error;
		}
	}

	compactionOrdinal(partition: string, id: string, head: number) {
		const existing = this.displayRow(partition, id);
		if (existing) return existing.ordinal;
		const base = head * 1024 - 512,
			last = this.db
				.prepare("SELECT MAX(ordinal) AS n FROM rows WHERE partition=? AND ordinal>=? AND ordinal<?")
				.get(partition, base, head * 1024) as { n: number | null };
		const ordinal = last.n === null ? base : last.n + 1;
		if (ordinal >= head * 1024) throw Error("History ordinal exceeds limit");
		return ordinal;
	}
	checkpoint(partition: string): string | undefined {
		return (this.db.prepare("SELECT checkpoint FROM display_state WHERE partition=?").get(partition) as { checkpoint: string } | undefined)
			?.checkpoint;
	}
	link(partition: string, id: string): { source: number; ordinal: number } | undefined {
		return this.db.prepare("SELECT source,ordinal,resultSource FROM tool_links WHERE partition=? AND id=?").get(partition, id) as
			| { source: number; ordinal: number }
			| undefined;
	}
	private metadata(m: HistoryMessage) {
		const n = bytes({ key: m.conversationKey, id: m.id, sender: m.senderId, at: m.at, length: Number.MAX_SAFE_INTEGER });
		if (n > this.#metadataBytes) {
			this.#metadataBytes = n;
			this.db.prepare("INSERT INTO stats VALUES('metadata',?) ON CONFLICT(key) DO UPDATE SET value=MAX(value,excluded.value)").run(n);
		}
	}
	stageDetail(partition: string, id: string, part: number, text: string) {
		if (Buffer.byteLength(text) > HISTORY_DETAIL_BYTES) throw Error("Detail exceeds limit");
		if (part === 0) this.db.prepare("DELETE FROM staged_details WHERE partition=? AND id=?").run(partition, id);
		this.db.prepare("INSERT OR REPLACE INTO staged_details VALUES(?,?,?,?)").run(partition, id, part, text);
	}
	stageMessage(partition: string, id: string, part: number, text: string) {
		if (Buffer.byteLength(text) > HISTORY_DETAIL_BYTES) throw Error("Message chunk exceeds limit");
		const normalized = text.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/gu, " ");
		if (part === 0)
			this.db.prepare("INSERT OR REPLACE INTO staged_messages VALUES(?,?,?,?)").run(partition, id, text, normalized.trimStart());
		else
			this.db
				.prepare(
					"UPDATE staged_messages SET original=original||?,normalized=normalized||CASE WHEN normalized='' OR substr(normalized,-1)=' ' THEN ltrim(?,' ') ELSE ? END WHERE partition=? AND id=?",
				)
				.run(text, normalized, normalized, partition, id);
	}
	apply(batch: HistoryBatch) {
		if (batch.rows.length + batch.messages.length > 256 || bytes(batch) > HISTORY_BATCH_BYTES) throw Error("History batch exceeds limit");
		this.db.exec("BEGIN");
		try {
			this.db.prepare("INSERT OR IGNORE INTO display_state(partition) VALUES(?)").run(batch.partition);
			if (batch.key) this.db.prepare("INSERT OR IGNORE INTO conversations(key) VALUES(?)").run(batch.key);
			for (const row of batch.rows) {
				const old = this.db.prepare("SELECT hash,revision FROM rows WHERE partition=? AND id=?").get(batch.partition, row.id) as
					| { hash: string; revision: number }
					| undefined;
				if (old?.hash !== row.hash) {
					const revision = (old?.revision ?? 0) + 1;
					let content = row.content;
					if (content.kind === "large") {
						const reference = fingerprint([batch.partition, row.id]);
						this.db.prepare("INSERT OR REPLACE INTO detail_refs VALUES(?,?,?)").run(reference, batch.partition, row.id);
						content = {
							...content,
							detail: Buffer.from(JSON.stringify({ reference, generation: this.generation, revision })).toString("base64url"),
						};
					}
					if (bytes(content) > HISTORY_DETAIL_BYTES) throw Error("Inline row exceeds limit");
					this.db
						.prepare(
							"INSERT INTO rows VALUES(?,?,?,?,?,?) ON CONFLICT(partition,id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,hash=excluded.hash,ordinal=excluded.ordinal",
						)
						.run(batch.partition, row.id, row.ordinal, revision, JSON.stringify(content), row.hash);
					this.db.prepare("DELETE FROM details WHERE partition=? AND id=?").run(batch.partition, row.id);
					this.db
						.prepare("INSERT INTO details SELECT partition,id,?,part,text FROM staged_details WHERE partition=? AND id=?")
						.run(revision, batch.partition, row.id);
					this.db.prepare("UPDATE display_state SET revision=revision+1 WHERE partition=?").run(batch.partition);
				}
				for (const id of row.toolIds ?? [])
					this.db
						.prepare(
							"INSERT INTO tool_links VALUES(?,?,?,?,?) ON CONFLICT(partition,id) DO UPDATE SET source=excluded.source,ordinal=excluded.ordinal,resultSource=COALESCE(excluded.resultSource,tool_links.resultSource)",
						)
						.run(batch.partition, id, row.source, row.ordinal, row.resultSource ?? null);
				this.db.prepare("DELETE FROM staged_details WHERE partition=? AND id=?").run(batch.partition, row.id);
			}
			for (const message of batch.messages) {
				this.metadata(message);
				const previous = this.db
					.prepare("SELECT 1 FROM messages WHERE conversation_key=? AND id=?")
					.get(message.conversationKey, message.id);
				const params = [
					message.conversationKey,
					message.id,
					message.senderId,
					message.at,
					sortKey(message.conversationKey),
					sortKey(message.id),
				];
				const staged = this.db.prepare("SELECT 1 FROM staged_messages WHERE partition=? AND id=?").get(batch.partition, message.id);
				if (staged)
					this.db
						.prepare(
							"INSERT OR IGNORE INTO messages(conversation_key,id,sender,at,key_order,id_order,original,normalized) SELECT ?,?,?,?,?,?,original,rtrim(normalized,' ') FROM staged_messages WHERE partition=? AND id=?",
						)
						.run(...params, batch.partition, message.id);
				else
					this.db
						.prepare(
							"INSERT OR IGNORE INTO messages(conversation_key,id,sender,at,key_order,id_order,original,normalized) VALUES(?,?,?,?,?,?,?,?)",
						)
						.run(...params, message.text, normalizeHistoryText(message.text));
				this.db.prepare("DELETE FROM staged_messages WHERE partition=? AND id=?").run(batch.partition, message.id);
				if (!previous)
					this.db
						.prepare("UPDATE conversations SET message_count=message_count+1,incoming=incoming+? WHERE key=?")
						.run(Number(message.senderId !== "user"), message.conversationKey);
			}
			const incoming = batch.key
				? (this.db.prepare("SELECT incoming FROM conversations WHERE key=?").get(batch.key) as { incoming: number }).incoming
				: 0;
			this.db
				.prepare("UPDATE display_state SET checkpoint=?,ready=?,incoming=? WHERE partition=?")
				.run(batch.checkpoint, Number(batch.ready), incoming, batch.partition);
			if (batch.key)
				this.db.prepare("UPDATE conversations SET checkpoint=?,ready=? WHERE key=?").run(batch.checkpoint, Number(batch.ready), batch.key);
			this.db.exec("COMMIT");
		} catch (error) {
			try {
				this.db.exec("ROLLBACK");
			} catch {
				/* SQLite may already have rolled back a failed write. */
			}
			throw error;
		}
	}
	resolveDetail(key: ConversationKey, token: string): { partition: string; id: string; revision: number } {
		try {
			if (token.length > 2048) throw Error();
			const data = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
			if (
				Object.keys(data).sort().join() !== "generation,reference,revision" ||
				typeof data.reference !== "string" ||
				!Number.isSafeInteger(data.revision)
			)
				throw Error();
			if (data.generation !== this.generation) throw new ProtocolError("request_conflict", "History changed. Reload this location.");
			const ref = this.db.prepare("SELECT partition,id FROM detail_refs WHERE reference=?").get(data.reference) as
				| { partition: string; id: string }
				| undefined;
			if (!ref || JSON.parse(ref.partition)[0] !== key) throw Error();
			return { ...ref, revision: data.revision };
		} catch (error) {
			if (error instanceof ProtocolError) throw error;
			throw new ProtocolError("invalid_request", "Invalid detail reference");
		}
	}
	detail(key: ConversationKey, token: string, part: number): DetailResult {
		if (!Number.isSafeInteger(part) || part < 0) throw new ProtocolError("invalid_request", "Invalid detail part");
		const data = this.resolveDetail(key, token);
		const row = this.displayRow(data.partition, data.id);
		if (!row) throw new ProtocolError("not_found", "Message is unavailable");
		if (row.revision !== data.revision) throw new ProtocolError("request_conflict", "History changed. Reload this location.");
		const chunk = this.db
			.prepare("SELECT text FROM details WHERE partition=? AND id=? AND revision=? AND part=?")
			.get(data.partition, data.id, data.revision, part) as { text: string } | undefined;
		if (!chunk) throw new ProtocolError("not_found", "Detail part is unavailable");
		const next = this.db
			.prepare("SELECT 1 FROM details WHERE partition=? AND id=? AND revision=? AND part=?")
			.get(data.partition, data.id, data.revision, part + 1);
		return { text: chunk.text, revision: data.revision, ...(next ? { nextPart: part + 1 } : {}) };
	}
	context(key: ConversationKey, id: string, before: number, after: number) {
		if ((this.db.prepare("SELECT ready FROM conversations WHERE key=?").get(key) as { ready: number } | undefined)?.ready !== 1)
			throw Error("History is still indexing");
		const anchor = this.db.prepare("SELECT sequence FROM messages WHERE conversation_key=? AND id=?").get(key, id) as
			| { sequence: number }
			| undefined;
		if (!anchor) throw new ProtocolError("not_found", "Message is unavailable");
		const read = (op: string, n: number) =>
			this.db
				.prepare(
					`SELECT id,sender AS senderId,at,substr(original,1,8193) AS text FROM messages WHERE conversation_key=? AND sequence ${op} ? ORDER BY sequence ${op === "<" ? "DESC" : "ASC"} LIMIT ?`,
				)
				.all(key, anchor.sequence, n) as ConversationPreview[];
		const older = read("<", before + 1),
			newer = read(">=", after + 2);
		return {
			messages: [...older.slice(0, before).reverse(), ...newer.slice(0, after + 1)],
			hasBefore: older.length > before,
			hasAfter: newer.length > after + 1,
		};
	}
	displayRow(partition: string, id: string): TimelineRow | undefined {
		const row = this.db.prepare("SELECT id,ordinal,revision,payload FROM rows WHERE partition=? AND id=?").get(partition, id) as
			| { id: string; ordinal: number; revision: number; payload: string }
			| undefined;
		return row ? { id: row.id, ordinal: row.ordinal, revision: row.revision, content: JSON.parse(row.payload) } : undefined;
	}
	window(input: WindowInput): WindowResult {
		const partition = historyPartition(input);
		const state = this.db.prepare("SELECT revision,incoming,ready FROM display_state WHERE partition=?").get(partition) as
			| { revision: number; incoming: number; ready: number }
			| undefined;
		if (!state?.ready) return { status: "building" };
		const limit = input.limit ?? 100;
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new ProtocolError("invalid_request", "Invalid history limit");
		let direction: "before" | "after" = "before",
			boundary: number | undefined,
			anchor: string | undefined;
		if (input.position.kind === "around") {
			anchor = input.position.rowId;
			const row = this.displayRow(partition, anchor);
			if (!row) throw new ProtocolError("not_found", "Message is unavailable");
			boundary = row.ordinal;
		} else if (input.position.kind === "cursor") {
			try {
				if (input.position.cursor.length > 4096) throw Error();
				const c = JSON.parse(Buffer.from(input.position.cursor, "base64url").toString("utf8"));
				if (
					Object.keys(c).sort().join() !== "boundary,direction,generation,partition,revision" ||
					c.partition !== fingerprint(partition) ||
					c.generation !== this.generation ||
					c.revision !== state.revision ||
					!["before", "after"].includes(c.direction) ||
					!Number.isSafeInteger(c.boundary) ||
					c.boundary < 0
				)
					throw Error();
				boundary = c.boundary;
				direction = c.direction;
			} catch {
				throw new ProtocolError("request_conflict", "History changed. Reload this location.");
			}
		}
		const read = (op: string, order: string, n: number, edge?: number) =>
			(
				this.db
					.prepare(
						`SELECT id,ordinal,revision,payload FROM rows WHERE partition=? ${edge === undefined ? "" : `AND ordinal ${op} ?`} ORDER BY ordinal ${order},id ${order} LIMIT ?`,
					)
					.all(...(edge === undefined ? [partition, n] : [partition, edge, n])) as {
					id: string;
					ordinal: number;
					revision: number;
					payload: string;
				}[]
			).map((r) => ({ id: r.id, ordinal: r.ordinal, revision: r.revision, content: JSON.parse(r.payload) }) as TimelineRow);
		let rows: TimelineRow[];
		if (anchor) {
			const before = read("<", "DESC", limit, boundary),
				after = read(">", "ASC", limit, boundary);
			rows = [this.displayRow(partition, anchor)!];
			for (let i = 0; rows.length < limit && (i < before.length || i < after.length); i++) {
				if (before[i]) rows.unshift(before[i]!);
				if (rows.length < limit && after[i]) rows.push(after[i]!);
			}
		} else
			rows = read(direction === "before" ? "<" : ">", direction === "before" ? "DESC" : "ASC", limit, boundary).sort(
				(a, b) => a.ordinal - b.ordinal || lexical(a.id, b.id),
			);
		const token = (dir: string, edge: number) =>
			Buffer.from(
				JSON.stringify({
					partition: fingerprint(partition),
					generation: this.generation,
					revision: state.revision,
					direction: dir,
					boundary: edge,
				}),
			).toString("base64url");
		const result = (): WindowResult => {
			const first = rows[0],
				last = rows.at(-1);
			const older = first && this.db.prepare("SELECT 1 FROM rows WHERE partition=? AND ordinal<? LIMIT 1").get(partition, first.ordinal);
			const newer = last && this.db.prepare("SELECT 1 FROM rows WHERE partition=? AND ordinal>? LIMIT 1").get(partition, last.ordinal);
			if (!rows.length && this.db.prepare("SELECT 1 FROM rows WHERE partition=? LIMIT 1").get(partition))
				throw new ProtocolError("not_found", "History page is unavailable");
			return {
				status: "ready",
				window: {
					conversationKey: input.conversationKey,
					generation: this.generation,
					revision: state.revision,
					rows,
					atLatest: !newer,
					...(older ? { before: token("before", first!.ordinal) } : {}),
					...(newer ? { after: token("after", last!.ordinal) } : {}),
					...(!newer && !input.deliveryId && !input.occurrenceId ? { readCursor: state.incoming } : {}),
				},
			};
		};
		while (bytes(result()) > HISTORY_BATCH_BYTES) {
			if (rows.length === 1) throw Error("History window exceeds limit");
			if (rows[0]!.id === anchor) rows.pop();
			else rows.shift();
		}
		return result();
	}
	async search(
		query: string,
		eligible: readonly ConversationKey[],
		scope: string,
		cursor: string | undefined,
		signal: AbortSignal,
	): Promise<ConversationSearchResult> {
		const binding = fingerprint([query, scope, eligible.slice().sort(lexical)]);
		const batchSize = Math.max(1, Math.min(256, Math.floor((HISTORY_BATCH_BYTES - 1024) / Math.max(1, this.#metadataBytes + 32))));
		const saved = cursor ? decodeCursor(cursor, binding, this.generation) : undefined;
		for (const key of eligible)
			if ((this.db.prepare("SELECT ready FROM conversations WHERE key=?").get(key) as { ready: number } | undefined)?.ready !== 1)
				throw Error("History is still indexing");
		const high = saved?.high ?? Number((this.db.prepare("SELECT COALESCE(MAX(sequence),0) AS n FROM messages").get() as { n: number }).n);
		const literal = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu");
		if (!query || !eligible.length) return { items: [] };
		const allowed = new Set(eligible),
			hits: ConversationSearchHit[] = [];
		let after = saved ? { at: saved.at, key: saved.key, id: saved.id } : undefined;
		while (hits.length < 31) {
			signal.throwIfAborted();
			// Only metadata is read here; text is streamed separately, including legacy oversized messages.
			const rows = (
				after
					? this.db
							.prepare(
								"SELECT conversation_key AS key,id,sender,at,length(normalized) AS length FROM messages WHERE sequence<=? AND ((-at),key_order,id_order)>(?,?,?) ORDER BY (-at),key_order,id_order LIMIT ?",
							)
							.all(high, -after.at, sortKey(after.key), sortKey(after.id), batchSize)
					: this.db
							.prepare(
								"SELECT conversation_key AS key,id,sender,at,length(normalized) AS length FROM messages WHERE sequence<=? ORDER BY (-at),key_order,id_order LIMIT ?",
							)
							.all(high, batchSize)
			) as { key: ConversationKey; id: string; sender: string; at: number; length: number }[];
			if (!rows.length) break;
			for (const row of rows) {
				after = { at: row.at, key: row.key, id: row.id };
				if (!allowed.has(row.key)) continue;
				const found = await this.match(row.key, row.id, row.length, literal, query.length, signal);
				if (found) hits.push({ conversationKey: row.key, messageId: row.id, senderId: row.sender, at: row.at, ...found });
				if (hits.length === 31) break;
			}
			await yieldTurn();
		}
		const items = hits.slice(0, 30);
		const next = () => {
			const last = items.at(-1)!;
			return Buffer.from(
				JSON.stringify({ binding, generation: this.generation, high, at: last.at, key: last.conversationKey, id: last.messageId }),
			).toString("base64url");
		};
		let nextCursor = hits.length > items.length ? next() : undefined;
		while (bytes({ ok: true, value: { items, ...(nextCursor ? { nextCursor } : {}) } }) > APP_MAX_RESULT_BYTES) {
			items.pop();
			if (!items.length) throw Error("Search result exceeds limit");
			nextCursor = next();
		}
		return { items, ...(nextCursor ? { nextCursor } : {}) };
	}
	private async match(key: string, id: string, length: number, literal: RegExp, queryLength: number, signal: AbortSignal) {
		const chunk = 8192,
			overlap = queryLength + 256;
		for (let offset = 0; offset < length; offset += chunk) {
			signal.throwIfAborted();
			const start = Math.max(0, offset - overlap);
			const text = (
				this.db
					.prepare("SELECT substr(normalized,?,?) AS text FROM messages WHERE conversation_key=? AND id=?")
					.get(start + 1, chunk + overlap * 2, key, id) as { text: string }
			).text;
			const found = literal.exec(text);
			if (found) {
				const point = start + Array.from(text.slice(0, found.index)).length;
				const first = Math.max(0, point - 48);
				const body = (
					this.db
						.prepare("SELECT substr(normalized,?,176) AS text FROM messages WHERE conversation_key=? AND id=?")
						.get(first + 1, key, id) as { text: string }
				).text;
				const prefix = first > 0 ? "…" : "";
				const matchStart =
					prefix.length +
					Array.from(body)
						.slice(0, point - first)
						.join("").length;
				return {
					snippet: prefix + body + (first + 176 < length ? "…" : ""),
					matchStart,
					matchEnd: Math.min(prefix.length + body.length, matchStart + found[0].length),
				};
			}
			if (offset > 0) await yieldTurn();
		}
		return undefined;
	}
}
/** Big-endian UTF-16 preserves the existing JS lexical comparator, including astral/BMP ordering. */
function sortKey(value: string): Buffer {
	const out = Buffer.from(value, "utf16le");
	out.swap16();
	return out;
}
