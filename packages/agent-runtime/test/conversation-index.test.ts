import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { ConversationSnapshot, TranscriptItem } from "@openbot/protocol";
import { BotRuntime } from "../src/index.ts";
import { directProjection, groupProjection, previewText } from "../src/conversation-index.ts";
import { scriptedModels } from "../src/testing.ts";
let root: string, runtime: BotRuntime;
const open = () => BotRuntime.open({ databasePath: join(root, "db"), models: scriptedModels("Reply.").models });
const message = (id: string, kind: "user" | "assistant", text = id): TranscriptItem => ({
	id,
	kind,
	parts: [{ type: "text", text }],
	at: 42,
});
const snapshot = (items: readonly TranscriptItem[], botId = "a"): ConversationSnapshot => ({ botId, items, approvals: [] });
const row = async (key = "bot:a") => (await runtime.conversationIndex().list()).find((r) => r.conversationKey === key)!;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "openbot-index-"));
	runtime = await open();
	await runtime.ensureCoreBot(1);
	for (const botId of ["a", "b"]) await runtime.createBot({ botId, name: botId, createdAt: 1 });
});
afterEach(async () => {
	await runtime.close();
	await rm(root, { recursive: true, force: true });
});
it("keeps late read acknowledgements behind new incoming messages across reopen", async () => {
	const first = [message("1", "user"), message("2", "assistant")];
	await runtime.conversationIndex().projectDirect(snapshot(first));
	const seen = (await row()).incomingCount;
	await runtime.conversationIndex().projectDirect(snapshot([...first, message("3", "assistant", "Newer")]));
	await runtime.conversationIndex().markRead("bot:a", seen);
	expect(await row()).toMatchObject({ incomingCount: 2, readThrough: 1, unreadCount: 1, latest: { text: "Newer" } });
	await runtime.close();
	runtime = await open();
	expect(await row()).toMatchObject({ incomingCount: 2, readThrough: 1, unreadCount: 1 });
	await runtime.conversationIndex().markRead("bot:a", 0);
	await runtime.conversationIndex().projectDirect(snapshot(first));
	expect(await row()).toMatchObject({ incomingCount: 2, readThrough: 1, unreadCount: 1, latest: { text: "Newer" } });
	for (const invalid of [-1, 3, 1.5, Number.MAX_SAFE_INTEGER + 1])
		await expect(runtime.conversationIndex().markRead("bot:a", invalid)).rejects.toThrow("Invalid reading position");
});
it("outgoing text updates preview without marking previous replies read; replay and stream fragments are inert", async () => {
	const items = [message("1", "assistant", "**你好** [report](https://example.test)\n\n" + "🦊".repeat(200))];
	await runtime.conversationIndex().projectDirect(snapshot(items));
	const before = await row();
	expect(Array.from(before.latest!.text)).toHaveLength(160);
	expect(before.latest!.text).toMatch(/^你好 report 🦊/);
	for (let n = 0; n < 4; n++)
		await runtime
			.conversationIndex()
			.projectDirect({ ...snapshot(items), live: { state: "running", partial: [{ type: "text", text: `token ${n}` }] } });
	expect(await row()).toEqual(before);
	await runtime.conversationIndex().projectDirect(snapshot([...items, message("2", "user", "Next request")]));
	expect(await row()).toMatchObject({
		incomingCount: 1,
		readThrough: 0,
		unreadCount: 1,
		latest: { senderId: "user", text: "Next request" },
	});
});
it("backfills legacy history as read and excludes reasoning, tools, errors and coordination noise", async () => {
	const items: TranscriptItem[] = [
		message("1", "assistant", "Old reply"),
		{ kind: "assistant", id: "2", parts: [], thinking: "private reasoning" },
		{ kind: "assistant", id: "3", parts: [], error: "failure" },
		{ kind: "tool", id: "call", tool: "local_read", args: {}, status: "succeeded", output: "private output" },
	];
	await runtime.conversationIndex().projectDirect(snapshot(items, "legacy"));
	expect(await row("bot:legacy")).toMatchObject({ incomingCount: 1, readThrough: 1, unreadCount: 0, latest: { text: "Old reply" } });
	expect(directProjection(snapshot(items)).messageCount).toBe(1);
	expect(groupProjection([{ postId: "handoff", kind: "handoff", senderId: "a", text: "Work", at: 1, recipientIds: ["b"] }])).toEqual({
		incomingCount: 0,
		messageCount: 0,
	});
	expect(previewText("# Heading\n```ts\nconst answer = 42;\n```\n<b>Done</b>")).toBe("Heading const answer = 42; Done");
	expect(previewText("**Done**: `report_final.md`, PRIVATE_B22_OK and *notes* with __emphasis__")).toBe(
		"Done: report_final.md, PRIVATE_B22_OK and notes with emphasis",
	);
});
it("publishes group summaries atomically, deduplicates replies and keeps channels independent", async () => {
	await runtime
		.groups()
		.change(
			{
				requestId: "create",
				action: "create",
				groupId: "group_g",
				expectedRevision: 0,
				fields: { name: "Group", objective: "Research", memberIds: ["a", "b"], leadBotId: "a" },
			},
			1,
		);
	await runtime.groups().post("group_g", "request", "Check", ["a"], 2);
	const delivery = (await runtime.groups().deliveries())[0]!;
	await runtime.groups().finish(delivery.deliveryId, "completed", "Group answer", 3);
	await runtime.groups().finish(delivery.deliveryId, "completed", "Duplicate", 4);
	await runtime.groups().post("group_g", "request", "Check", ["a"], 5);
	expect(await row("group:group_g")).toMatchObject({
		incomingCount: 1,
		unreadCount: 1,
		latest: { text: "Group answer", senderId: "a", at: 3 },
	});
	expect(await row()).toMatchObject({ incomingCount: 0, unreadCount: 0 });
	await runtime.close();
	runtime = await open();
	await runtime.groups().backfillIndex();
	expect(await row("group:group_g")).toMatchObject({ incomingCount: 1, unreadCount: 1 });
	await runtime.groups().change({ requestId: "dissolve", action: "dissolve", groupId: "group_g", expectedRevision: 1 }, 6);
	await runtime.conversationIndex().markRead("group:group_g", 1);
	expect(await row("group:group_g")).toMatchObject({ unreadCount: 0, latest: { text: "Group answer" } });
});
