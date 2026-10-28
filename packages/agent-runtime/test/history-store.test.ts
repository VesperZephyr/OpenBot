import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { HistoryStore } from "../src/history-store.ts";
import { ConversationSearchIndex } from "../src/conversation-search.ts";
import type { ConversationKey, ConversationPreview } from "@openbot/protocol";
let root: string, store: HistoryStore;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "openbot-history-store-"));
	store = new HistoryStore(join(root, "history.sqlite"), "source");
});
afterEach(async () => {
	store.close();
	await rm(root, { recursive: true, force: true });
});
const signal = () => AbortSignal.timeout(5000);
const key: ConversationKey = "bot:fixture";
const texts = [
	"English NEEDLE, Chinese 星图",
	"Combining Cafe\u0301 / café / K / k",
	"line\n\n white\tspace",
	"[] $ ^ . (needle) \\ .*",
	"\u202asecret\u202c needle",
	"🦊".repeat(8200) + "NEEDLE" + "界".repeat(200),
	"𐀀\ue000",
];
function project(values: ConversationPreview[]) {
	store.begin(key);
	for (let i = 0; i < values.length; i += 32) store.ingest(values.slice(i, i + 32).map((m) => ({ ...m, conversationKey: key })));
	store.finish(key, "checkpoint");
}
it("preserves literal Unicode matching, snippets and offsets against the current search oracle", async () => {
	const values = texts.map((text, i) => ({ id: String(i), senderId: "bot", text, at: i }));
	project(values);
	const oracle = new ConversationSearchIndex();
	oracle.project(key, values);
	for (const query of ["needle", "星图", "cafe\u0301", "café", "k", "white space", "[]", ".*", "secret", "🦊", "𐀀"]) {
		const actual = await store.search(query, [key], "scope", undefined, signal());
		expect(actual.items, query).toEqual(oracle.search(query, new Set([key]), "scope").items);
	}
});
it("pages by fixed insertion boundary, excludes new arrivals and rejects changed scopes and generations", async () => {
	const values = Array.from({ length: 80 }, (_, i) => ({
		id: String(i).padStart(3, "0"),
		senderId: "bot",
		text: "needle",
		at: Math.floor(i / 2),
	}));
	project(values);
	const first = await store.search("needle", [key], "owner", undefined, signal());
	expect(first.items).toHaveLength(30);
	expect(first.nextCursor).toBeDefined();
	store.ingest([{ conversationKey: key, id: "late", senderId: "bot", text: "needle", at: 15 }]);
	const ids = first.items.map((m) => m.messageId);
	let cursor = first.nextCursor;
	while (cursor) {
		const page = await store.search("needle", [key], "owner", cursor, signal());
		ids.push(...page.items.map((m) => m.messageId));
		cursor = page.nextCursor;
	}
	expect(ids).toHaveLength(80);
	expect(new Set(ids).size).toBe(80);
	expect(ids).not.toContain("late");
	await expect(store.search("needle", [key], "other", first.nextCursor, signal())).rejects.toThrow("cursor");
	store.close();
	store = new HistoryStore(join(root, "history.sqlite"), "replacement");
	await expect(store.search("needle", [key], "owner", first.nextCursor, signal())).rejects.toThrow("cursor");
});
it("persists deduplicated messages, refuses incomplete scope, and honors cancellation", async () => {
	project([{ id: "one", senderId: "bot", text: "saved", at: 1 }]);
	store.ingest([{ conversationKey: key, id: "one", senderId: "bot", text: "saved", at: 1 }]);
	store.close();
	store = new HistoryStore(join(root, "history.sqlite"), "source");
	expect((await store.search("saved", [key], "scope", undefined, signal())).items).toHaveLength(1);
	store.begin("bot:other");
	await expect(store.search("saved", [key, "bot:other"], "scope", undefined, signal())).rejects.toThrow("indexing");
	await expect(store.search("saved", [key], "scope", undefined, AbortSignal.abort())).rejects.toThrow();
});

it("keeps timeline anchors, byte bounds and stale cursor conflicts independent of retained rows", () => {
	const partition = JSON.stringify([key, null]);
	for (let offset = 0; offset < 1000; offset += 10)
		store.apply({
			partition,
			key,
			checkpoint: String(offset + 10),
			ready: true,
			rows: Array.from({ length: 10 }, (_, i) => {
				const ordinal = offset + i,
					id = String(ordinal);
				return {
					id,
					ordinal,
					source: ordinal,
					hash: id,
					content: {
						kind: "direct" as const,
						item: { kind: "assistant" as const, id, parts: [{ type: "text" as const, text: "🦊".repeat(6000) }] },
					},
				};
			}),
			messages: [],
		});
	const around = store.window({ conversationKey: key, position: { kind: "around", rowId: "500" } });
	expect(around.status).toBe("ready");
	if (around.status !== "ready") throw Error();
	expect(around.window.rows.map((r) => r.id)).toContain("500");
	expect(Buffer.byteLength(JSON.stringify(around))).toBeLessThanOrEqual(512 * 1024);
	expect(around.window.atLatest).toBe(false);
	expect(around.window.readCursor).toBeUndefined();
	store.apply({
		partition,
		key,
		checkpoint: "changed",
		ready: true,
		messages: [],
		rows: [
			{
				id: "500",
				ordinal: 500,
				source: 500,
				hash: "updated",
				content: { kind: "direct", item: { kind: "assistant", id: "500", parts: [{ type: "text", text: "updated" }] } },
			},
		],
	});
	expect(() => store.window({ conversationKey: key, position: { kind: "cursor", cursor: around.window.before! } })).toThrow(
		"History changed",
	);
	expect(() => store.window({ conversationKey: key, position: { kind: "around", rowId: "absent" } })).toThrow("unavailable");
});

it("atomically applies checkpoints, replays stable rows, and updates an earlier tool without adding a row", () => {
	const partition = JSON.stringify([key, null]);
	const row = {
		id: "call",
		ordinal: 5,
		source: 42,
		hash: "pending",
		toolIds: ["call"],
		content: { kind: "direct" as const, item: { kind: "tool" as const, id: "call", tool: "test", args: {}, status: "pending" as const } },
	};
	const batch = { partition, key, checkpoint: "first", ready: true, rows: [row], messages: [] };
	store.apply(batch);
	store.apply(batch);
	expect(store.displayRow(partition, "call")?.revision).toBe(1);
	expect(store.link(partition, "call")).toMatchObject({ source: 42, ordinal: 5 });
	store.apply({
		...batch,
		checkpoint: "second",
		rows: [{ ...row, hash: "succeeded", content: { kind: "direct", item: { ...row.content.item, status: "succeeded", output: "done" } } }],
	});
	expect(store.displayRow(partition, "call")?.ordinal).toBe(5);
	expect(store.displayRow(partition, "call")?.revision).toBe(2);
	expect(() => store.apply({ ...batch, checkpoint: "must roll back", rows: [{ ...row, id: "collision" }] })).toThrow();
	expect(store.checkpoint(partition)).toBe("second");
	expect(store.displayRow(partition, "collision")).toBeUndefined();
});

it("reconstructs large Unicode details, invalidates changed rows, and searches across chunk boundaries", async () => {
	const { historyChunks } = await import("../src/history-projection.ts");
	const partition = JSON.stringify([key, null]),
		text = "label: " + "🦊a".repeat(420000) + "跨界 NEEDLE";
	const chunks = [...historyChunks(text)];
	chunks.forEach((text, part) => {
		expect(Buffer.byteLength(text)).toBeLessThanOrEqual(32768);
		store.stageDetail(partition, "large", part, text);
		store.stageMessage(partition, "large", part, text);
	});
	store.apply({
		partition,
		key,
		checkpoint: "large",
		ready: true,
		rows: [
			{
				id: "large",
				ordinal: 0,
				source: 1,
				hash: "one",
				content: { kind: "large", originalKind: "assistant", preview: "label", detail: "" },
			},
		],
		messages: [{ conversationKey: key, id: "large", senderId: "bot", at: 1, text: "" }],
	});
	const row = store.displayRow(partition, "large")!;
	if (row.content.kind !== "large") throw Error();
	const token = row.content.detail;
	let reconstructed = "",
		part: number | undefined = 0;
	while (part !== undefined) {
		const detail = store.detail(key, row.content.detail, part);
		reconstructed += detail.text;
		part = detail.nextPart;
	}
	expect(reconstructed).toBe(text);
	expect((await store.search("跨界 needle", [key], "owner", undefined, signal())).items[0]?.messageId).toBe("large");
	expect(() => store.detail("bot:other", token, 0)).toThrow("Invalid detail");
	store.apply({
		partition,
		key,
		checkpoint: "changed",
		ready: true,
		rows: [
			{ id: "large", ordinal: 0, source: 1, hash: "two", content: { kind: "direct", item: { kind: "assistant", id: "large", parts: [] } } },
		],
		messages: [],
	});
	expect(() => store.detail(key, row.content.kind === "large" ? row.content.detail : "", 0)).toThrow("History changed");
});

it("rolls back a disk-full batch without advancing its checkpoint", () => {
	const partition = JSON.stringify([key, null]);
	store.apply({ partition, key, rows: [], messages: [], checkpoint: "before", ready: true });
	const pages = (store.db.prepare("PRAGMA page_count").get() as { page_count: number }).page_count;
	store.db.exec(`PRAGMA max_page_count=${pages + 2}`);
	expect(() =>
		store.apply({
			partition,
			key,
			checkpoint: "after",
			ready: true,
			messages: [],
			rows: Array.from({ length: 12 }, (_, i) => ({
				id: String(i),
				ordinal: i,
				source: i,
				hash: String(i),
				content: {
					kind: "direct" as const,
					item: { kind: "assistant" as const, id: String(i), parts: [{ type: "text" as const, text: "large".repeat(5000) }] },
				},
			})),
		}),
	).toThrow();
	expect(store.checkpoint(partition)).toBe("before");
	expect(store.displayRow(partition, "0")).toBeUndefined();
});
