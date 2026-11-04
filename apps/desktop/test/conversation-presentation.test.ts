import { describe, expect, it } from "vitest";
import { conversationPresence } from "../src/renderer/src/conversation-status";
import { botGreeting, conversationExamples } from "../src/renderer/src/examples";
import { activityWorkingLabel } from "../src/shared/i18n";

describe("conversation presentation", () => {
	it("derives header status only from approvals, live work and idle", () => {
		expect(conversationPresence({ approvals: 0, live: false, pending: 0 })).toBe("idle");
		expect(conversationPresence({ approvals: 0, live: true, pending: 0, runState: "running" })).toBe("working");
		expect(conversationPresence({ approvals: 1, live: true, pending: 1, runState: "running" })).toBe("awaiting_approval");
		expect(conversationPresence({ approvals: 0, live: false, pending: 1, runState: "queued" })).toBe("working");
	});

	it("takes at most three examples from instructions and skills, and hides when there are none", () => {
		expect(conversationExamples("Help with the weekly review.", [])).toEqual([]);
		expect(
			conversationExamples('Standing note.\nExample: Summarize my notes\n- Example: Draft the reply\n"Check the two figures"', [
				{ description: "Summarize my notes" },
				{ description: "List open questions" },
			]),
		).toEqual(["Check the two figures", "Summarize my notes", "Draft the reply"]);
		expect(botGreeting("You are the user's personal assistant. Reply in their language.")).toBe(
			"You are the user's personal assistant.",
		);
		expect(botGreeting("")).toBe("");
	});

	it("uses Working and 工作中 for the working label", () => {
		expect(activityWorkingLabel("en")).toBe("Working");
		expect(activityWorkingLabel("zh-CN")).toBe("工作中");
	});
});