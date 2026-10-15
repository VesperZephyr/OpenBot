/**
 * End-to-end coding tools: an approved command that outlives the foreground moves to the background, the Run goes on
 * with its task ID, and `task_output` reads the final output. The yield threshold is shortened to 1.5 seconds.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AppHarness, createBot, launchApp } from "./harness.ts";
import type { ModelRequest } from "./scripted-model.ts";

let h: AppHarness;

/** The task ID in the last tool result the app sent to the model. */
function lastTaskId(request: ModelRequest): string {
	const taskId = /as task (task_[0-9a-f]+)/.exec(JSON.stringify(request.messages.at(-1)))?.[1];
	if (taskId === undefined) throw new Error("The last tool result names no task");
	return taskId;
}

beforeAll(async () => {
	h = await launchApp("coding-tools", { env: { OPENBOT_EXEC_YIELD_MS: "1500" } });
	await createBot(h, "Coder");
}, 90_000);

afterAll(async () => {
	await h?.close();
});

describe("coding tools", () => {
	it("a long command moves to the background and task_output reads its result", async () => {
		h.model.script(
			{ tool: "local_exec", args: { command: "sleep 3; echo done", description: "Slow job" } },
			{ tool: "task_output", args: (request) => ({ taskId: lastTaskId(request), wait_seconds: 30 }) },
			{ text: "The slow job finished." },
		);
		await h.send("Run the slow job");
		const card = h.page().getByRole("group", { name: "Approval request" });
		await card.getByRole("button", { name: "Allow once" }).click();

		// The command's call ends when it yields, so the row shows its task while the command still runs.
		const row = h.page().locator(".tool-card", { hasText: "Slow job" });
		await row.locator(".tool-task").waitFor({ timeout: 15_000 });
		expect(await row.locator(".tool-task").textContent()).toMatch(/task_[0-9a-f]+/);
		await h.shot("01-backgrounded");

		await h.page().locator(".tool-card.tool-succeeded", { hasText: "Checked task" }).waitFor({ timeout: 30_000 });
		await h.page().getByText("The slow job finished.").waitFor();
		const result = JSON.stringify(h.model.requests.at(-1)?.messages.at(-1));
		expect(result).toContain("done");
		expect(result).toContain("exited with code 0");
		await h.shot("02-task-output");
	});
});
