import { afterEach, describe, expect, it } from "vitest";
import type { PendingApproval } from "@openbot/protocol";
import { hasPendingApproval } from "../src/renderer/src/composer-approval";
import {
	approvalChoices,
	approvalRecordSnapshot,
	clearConversationApprovals,
	forgetApproval,
	mergeApprovalRecords,
	rememberApproval,
	rememberTaskConversation,
	resetApprovalRecords,
	settledApprovals,
	type SettledApproval,
} from "../src/renderer/src/approval-records";

function record(patch: Partial<SettledApproval> & Pick<SettledApproval, "approvalId" | "conversationId" | "decision">): SettledApproval {
	return {
		botId: "bot",
		callId: patch.approvalId,
		action: patch.decision,
		detail: patch.decision,
		at: 10,
		...patch,
	};
}

function approval(conversationId: string | undefined): Pick<PendingApproval, "conversationId"> {
	return conversationId === undefined ? {} : { conversationId };
}

afterEach(() => {
	resetApprovalRecords();
});

describe("approval records", () => {
	it("records allow and deny separately, and forgetApproval rolls back a failed decide", () => {
		rememberApproval(record({ approvalId: "allow", conversationId: "chat", decision: "allow_once" }));
		rememberApproval(record({ approvalId: "deny", conversationId: "chat", decision: "deny" }));
		expect(settledApprovals("chat", []).map((item) => item.decision)).toEqual(["allow_once", "deny"]);
		forgetApproval("deny");
		expect(settledApprovals("chat", []).map((item) => item.approvalId)).toEqual(["allow"]);
		forgetApproval("allow");
		expect(settledApprovals("chat", [])).toEqual([]);
	});

	it("filters records by conversation and does not show every record when LocalTasks omits conversationId", () => {
		rememberApproval(record({ approvalId: "chat", conversationId: "chat", decision: "allow_once" }));
		rememberApproval(record({ approvalId: "task", conversationId: "task-conversation", decision: "deny" }));
		expect(settledApprovals("task-conversation", []).map((item) => item.approvalId)).toEqual(["task"]);
		expect(settledApprovals(undefined, [])).toEqual([]);
		expect(rememberTaskConversation("task_1", [])).toBeUndefined();
		expect(rememberTaskConversation("task_1", [approval("task-conversation")])).toBe("task-conversation");
		expect(rememberTaskConversation("task_1", [])).toBe("task-conversation");
	});

	it("merges host decisions for one conversation and keeps the richer memory row", () => {
		rememberApproval(record({ approvalId: "live", conversationId: "chat", decision: "allow_once", action: "Keep a note", at: 20 }));
		const merged = mergeApprovalRecords(
			"chat",
			approvalRecordSnapshot(),
			[
				{ approvalId: "live", decision: "allow_once", at: 20, tool: "local_exec", conversationId: "chat" },
				{ approvalId: "stored", decision: "deny", at: 10, tool: "local_exec", conversationId: "chat" },
				{ approvalId: "other", decision: "allow_once", at: 30, tool: "local_exec", conversationId: "other" },
			],
			[],
		);
		expect(merged.map((item) => item.approvalId)).toEqual(["stored", "live"]);
		expect(merged[1]?.action).toBe("Keep a note");
		expect(merged[0]?.decision).toBe("deny");
		expect(mergeApprovalRecords(undefined, approvalRecordSnapshot(), [], [])).toEqual([]);
	});

	it("maps a stored always_allow decision to always_allow", () => {
		const merged = mergeApprovalRecords(
			"chat",
			[],
			[{ approvalId: "stored", decision: "always_allow", at: 10, tool: "local_exec", conversationId: "chat" }],
			[],
		);
		expect(merged).toMatchObject([{ approvalId: "stored", decision: "always_allow", action: "local_exec" }]);
	});

	it("keeps the latest 32 records after the run ends", () => {
		for (let i = 0; i < 40; i++) rememberApproval(record({ approvalId: `a${i}`, conversationId: "chat", decision: "allow_once", at: i }));
		const kept = settledApprovals("chat", []);
		expect(kept).toHaveLength(32);
		expect(kept[0]?.approvalId).toBe("a8");
		expect(kept[31]?.approvalId).toBe("a39");
		expect(settledApprovals("chat", []).some((item) => item.approvalId === "a0")).toBe(false);
	});

	it("clears a deleted conversation's records and leaves the others", () => {
		rememberApproval(record({ approvalId: "chat-row", conversationId: "chat", decision: "allow_once" }));
		rememberApproval(record({ approvalId: "other-row", conversationId: "other", decision: "deny" }));
		expect(rememberTaskConversation("task-chat", [approval("chat")])).toBe("chat");
		expect(rememberTaskConversation("task-chat-again", [approval("chat")])).toBe("chat");
		expect(rememberTaskConversation("task-other", [approval("other")])).toBe("other");
		clearConversationApprovals(undefined);
		expect(settledApprovals("chat", []).map((item) => item.approvalId)).toEqual(["chat-row"]);
		expect(rememberTaskConversation("task-chat", [])).toBe("chat");
		clearConversationApprovals("chat");
		expect(settledApprovals("chat", [])).toEqual([]);
		expect(settledApprovals("other", []).map((item) => item.approvalId)).toEqual(["other-row"]);
		expect(rememberTaskConversation("task-chat", [])).toBeUndefined();
		expect(rememberTaskConversation("task-chat-again", [])).toBeUndefined();
		expect(rememberTaskConversation("task-other", [])).toBe("other");
		expect(rememberTaskConversation("task-later", [])).toBeUndefined();
		expect(rememberTaskConversation("task-later", [approval("chat-next")])).toBe("chat-next");
		expect(rememberTaskConversation("task-chat", [])).toBeUndefined();
	});

	it("disables every approval choice while always-allow is in flight and marks that choice as loading", () => {
		const choices = approvalChoices("always_allow");
		expect(choices.allow.disabled).toBe(true);
		expect(choices.deny.disabled).toBe(true);
		expect(choices.always.disabled).toBe(true);
		expect(choices.always.loading).toBe(true);
		expect(choices.allow.loading).toBe(false);
		expect(choices.deny.loading).toBe(false);
		expect(approvalChoices(null).allow.disabled).toBe(false);
	});
});

describe("composer approval", () => {
	const state = {
		conversations: { atlas: { approvals: [{}] }, idle: { approvals: [] } },
		groupSnapshots: {
			team: { tasks: [{ conversation: { approvals: [{}] } }, { conversation: { approvals: [] } }] },
			quiet: { tasks: [{ conversation: { approvals: [] } }] },
		},
	};

	it("keeps Send secondary while a direct chat or a group task is waiting for approval", () => {
		expect(hasPendingApproval("bot:atlas", state)).toBe(true);
		expect(hasPendingApproval("bot:idle", state)).toBe(false);
		expect(hasPendingApproval("group:team", state)).toBe(true);
		expect(hasPendingApproval("group:quiet", state)).toBe(false);
		expect(hasPendingApproval("task:separate", state)).toBe(false);
	});
});
