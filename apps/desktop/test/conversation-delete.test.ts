import { afterEach, describe, expect, it } from "vitest";
import {
	approvalRecordSnapshot,
	rememberApproval,
	rememberTaskConversation,
	resetApprovalRecords,
	settledApprovals,
	type SettledApproval,
} from "../src/renderer/src/approval-records";
import {
	awaitingNewChat,
	conversationKeyOf,
	directChatVisible,
	freshConversationSummary,
	planConversationDelete,
} from "../src/renderer/src/conversation-delete";
import {
	beginIdentityDraft,
	identityDraftSnapshot,
	patchIdentityDraft,
	resetIdentityDraft,
} from "../src/renderer/src/features/details/identity-draft";

function record(approvalId: string, conversationId: string, decision: SettledApproval["decision"]): SettledApproval {
	return { approvalId, conversationId, botId: "bot", callId: approvalId, decision, action: decision, detail: decision, at: 10 };
}

const entries = [
	{ key: "bot:core" as const, core: true },
	{ key: "bot:ada" as const },
	{ key: "bot:bee" as const },
];

afterEach(() => {
	resetApprovalRecords();
	resetIdentityDraft();
});

describe("conversation delete", () => {
	it("requires confirmation before removing a conversation or its approval records", () => {
		rememberApproval(record("ada-row", "ada-chat", "allow_once"));
		rememberApproval(record("bee-row", "bee-chat", "deny"));
		const cancelled = planConversationDelete({
			confirmed: false,
			deletedKey: "bot:ada",
			conversationId: "ada-chat",
			entries,
			view: { kind: "bot", botId: "ada" },
			lastChat: { kind: "bot", botId: "ada" },
		});
		expect(cancelled.deleted).toBe(false);
		expect(cancelled.entries.map((entry) => entry.key)).toEqual(["bot:core", "bot:ada", "bot:bee"]);
		expect(cancelled.view).toEqual({ kind: "bot", botId: "ada" });
		expect(settledApprovals("ada-chat", []).map((item) => item.approvalId)).toEqual(["ada-row"]);
		expect(settledApprovals("bee-chat", []).map((item) => item.approvalId)).toEqual(["bee-row"]);
		expect(rememberTaskConversation("task-ada", [{ conversationId: "ada-chat" }])).toBe("ada-chat");
		const stillThere = planConversationDelete({
			confirmed: false,
			deletedKey: "bot:ada",
			conversationId: "ada-chat",
			entries,
			view: { kind: "bot", botId: "ada" },
			lastChat: { kind: "bot", botId: "ada" },
		});
		expect(stillThere.deleted).toBe(false);
		expect(rememberTaskConversation("task-ada", [])).toBe("ada-chat");
	});

	it("removes the conversation, clears only its approval records, and leaves the open chat when another chat was selected", () => {
		rememberApproval(record("ada-row", "ada-chat", "allow_once"));
		rememberApproval(record("bee-row", "bee-chat", "deny"));
		const removed = planConversationDelete({
			confirmed: true,
			deletedKey: "bot:ada",
			conversationId: "ada-chat",
			entries,
			view: { kind: "bot", botId: "bee" },
			lastChat: { kind: "bot", botId: "bee" },
		});
		expect(removed.deleted).toBe(true);
		expect(removed.entries.map((entry) => entry.key)).toEqual(["bot:core", "bot:bee"]);
		expect(removed.view).toEqual({ kind: "bot", botId: "bee" });
		expect(settledApprovals("ada-chat", [])).toEqual([]);
		expect(settledApprovals("bee-chat", []).map((item) => item.approvalId)).toEqual(["bee-row"]);
		expect(approvalRecordSnapshot().map((item) => item.approvalId)).toEqual(["bee-row"]);
	});

	it("moves a deleted selection to a remaining conversation, or home when none remain", () => {
		const moved = planConversationDelete({
			confirmed: true,
			deletedKey: "bot:ada",
			conversationId: "ada-chat",
			entries,
			view: { kind: "bot", botId: "ada" },
			lastChat: { kind: "settings" },
		});
		expect(moved.view).toEqual({ kind: "bot", botId: "core" });
		expect(moved.lastChat).toEqual({ kind: "settings" });
		const home = planConversationDelete({
			confirmed: true,
			deletedKey: "bot:ada",
			conversationId: "ada-chat",
			entries: [{ key: "bot:ada" }],
			view: { kind: "bot", botId: "ada" },
			lastChat: { kind: "bot", botId: "ada" },
		});
		expect(home.view).toEqual({ kind: "home" });
		expect(home.lastChat).toEqual({ kind: "home" });
		expect(home.entries).toEqual([]);
	});

	it("leaves identity drafts for other bots untouched", () => {
		const bot = (botId: string, name: string) => ({ botId, name, role: "", instructions: "", revision: 1 });
		beginIdentityDraft(bot("ada", "Ada"));
		beginIdentityDraft(bot("bee", "Bee"));
		patchIdentityDraft("bee", { name: "Bee draft" });
		planConversationDelete({
			confirmed: true,
			deletedKey: "bot:ada",
			conversationId: "ada-chat",
			entries,
			view: { kind: "bot", botId: "ada" },
			lastChat: { kind: "bot", botId: "ada" },
		});
		expect(identityDraftSnapshot("bee")).toMatchObject({ name: "Bee draft" });
		expect(identityDraftSnapshot("ada")).toMatchObject({ name: "Ada" });
	});

	it("keeps a deleted specialist discoverable for a new chat, without restoring its approvals or other drafts", () => {
		rememberApproval(record("ada-row", "ada-chat", "allow_once"));
		rememberApproval(record("bee-row", "bee-chat", "deny"));
		const bot = (botId: string, name: string) => ({ botId, name, role: "", instructions: "", revision: 1 });
		beginIdentityDraft(bot("ada", "Ada"));
		beginIdentityDraft(bot("bee", "Bee"));
		patchIdentityDraft("bee", { name: "Bee draft" });
		const summaries = {
			"bot:ada": { deleted: true as const },
			"bot:bee": {},
			"bot:core": {},
		};
		planConversationDelete({
			confirmed: true,
			deletedKey: "bot:ada",
			conversationId: "ada-chat",
			entries,
			view: { kind: "bot", botId: "ada" },
			lastChat: { kind: "bot", botId: "ada" },
		});
		expect(directChatVisible({ status: "active" }, summaries, "ada")).toBe(false);
		expect(awaitingNewChat({ status: "active", kind: "specialist" }, summaries, "ada")).toBe(true);
		expect(awaitingNewChat({ status: "hidden", kind: "specialist" }, summaries, "ada")).toBe(true);
		expect(directChatVisible({ status: "active" }, summaries, "bee")).toBe(true);
		expect(awaitingNewChat({ status: "active", kind: "specialist" }, summaries, "bee")).toBe(false);
		expect(awaitingNewChat({ status: "hidden", kind: "specialist" }, summaries, "bee")).toBe(false);
		expect(awaitingNewChat({ status: "active", kind: "core" }, { "bot:core": { deleted: true } }, "core")).toBe(false);
		expect(directChatVisible({ status: "deleted" }, summaries, "ada")).toBe(false);
		const fresh = freshConversationSummary({
			conversationKey: "bot:ada" as const,
			incomingCount: 2,
			readThrough: 0,
			unreadCount: 2,
			deleted: true as const,
			latest: { id: "2", senderId: "ada", text: "Kept", at: 10 },
		});
		expect("deleted" in fresh).toBe(false);
		expect("latest" in fresh).toBe(false);
		expect(fresh.unreadCount).toBe(0);
		expect(fresh.readThrough).toBe(2);
		expect(fresh.incomingCount).toBe(2);
		expect(settledApprovals("ada-chat", [])).toEqual([]);
		expect(settledApprovals("bee-chat", []).map((item) => item.approvalId)).toEqual(["bee-row"]);
		expect(identityDraftSnapshot("bee")).toMatchObject({ name: "Bee draft" });
		expect(identityDraftSnapshot("ada")).toMatchObject({ name: "Ada" });
	});

	it("drops a deleted conversation from task lookups when the same bot key starts a new chat", () => {
		rememberApproval(record("ada-row", "ada-chat", "allow_once"));
		rememberApproval(record("bee-row", "bee-chat", "deny"));
		expect(rememberTaskConversation("task-ada", [{ conversationId: "ada-chat" }])).toBe("ada-chat");
		expect(rememberTaskConversation("task-ada-shared", [{ conversationId: "ada-chat" }])).toBe("ada-chat");
		expect(rememberTaskConversation("task-bee", [{ conversationId: "bee-chat" }])).toBe("bee-chat");
		const deletedKey = "bot:ada" as const;
		expect(conversationKeyOf({ kind: "bot", botId: "ada" })).toBe(deletedKey);
		const removed = planConversationDelete({
			confirmed: true,
			deletedKey,
			conversationId: "ada-chat",
			entries,
			view: { kind: "bot", botId: "ada" },
			lastChat: { kind: "bot", botId: "ada" },
		});
		expect(removed.deleted).toBe(true);
		expect(settledApprovals("ada-chat", [])).toEqual([]);
		expect(settledApprovals("bee-chat", []).map((item) => item.approvalId)).toEqual(["bee-row"]);
		expect(approvalRecordSnapshot()).toHaveLength(1);
		expect(conversationKeyOf({ kind: "bot", botId: "ada" })).toBe(deletedKey);
		expect(rememberTaskConversation("task-ada", [])).toBeUndefined();
		expect(rememberTaskConversation("task-ada-shared", [])).toBeUndefined();
		expect(rememberTaskConversation("task-later", [])).toBeUndefined();
		expect(rememberTaskConversation("task-bee", [])).toBe("bee-chat");
		expect(rememberTaskConversation("task-later", [{ conversationId: "ada-next" }])).toBe("ada-next");
		expect(rememberTaskConversation("task-ada", [])).toBeUndefined();
		expect(rememberTaskConversation("task-bee", [])).toBe("bee-chat");
		expect(settledApprovals("bee-chat", []).map((item) => item.approvalId)).toEqual(["bee-row"]);
		expect(settledApprovals(undefined, [])).toEqual([]);
	});
});
