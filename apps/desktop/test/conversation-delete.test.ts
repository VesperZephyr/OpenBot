import { afterEach, describe, expect, it } from "vitest";
import {
	approvalRecordSnapshot,
	rememberApproval,
	resetApprovalRecords,
	settledApprovals,
	type SettledApproval,
} from "../src/renderer/src/approval-records";
import { planConversationDelete } from "../src/renderer/src/conversation-delete";
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
});
