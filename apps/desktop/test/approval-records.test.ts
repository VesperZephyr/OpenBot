import { afterEach, describe, expect, it } from "vitest";
import type { PendingApproval } from "@openbot/protocol";
import { hasPendingApproval } from "../src/renderer/src/composer-approval";
import {
	approvalChoices,
	forgetApproval,
	rememberApproval,
	rememberTaskConversation,
	resetApprovalRecords,
	retireApprovalRecords,
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

	it("clears a conversation when its run ends or a later user message arrives", () => {
		rememberApproval(record({ approvalId: "kept", conversationId: "chat", decision: "allow_once", at: 50 }));
		retireApprovalRecords({ conversationId: "chat", runActive: true, latestUserAt: 40 });
		expect(settledApprovals("chat", [])).toHaveLength(1);
		retireApprovalRecords({ conversationId: "chat", runActive: true, latestUserAt: 60 });
		expect(settledApprovals("chat", [])).toEqual([]);
		rememberApproval(record({ approvalId: "done", conversationId: "chat", decision: "deny", at: 70 }));
		retireApprovalRecords({ conversationId: "chat", runActive: false });
		expect(settledApprovals("chat", [])).toEqual([]);
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
