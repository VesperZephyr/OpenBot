import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { launchApp, type AppHarness } from "./harness.ts";
import { expectedReport, invoiceCsv, reviewSkill, triageSkill } from "./fixtures/role-memory.ts";
import type { BotSummary, SkillRef, SkillVersion } from "../packages/protocol/src/index.ts";

let h: AppHarness, finance: BotSummary, reviewer: BotSummary, triage: SkillVersion, latest: SkillVersion, review: SkillVersion;
const ref = ({ name, revision, sha256 }: SkillRef): SkillRef => ({ name, revision, sha256 });
async function send(bot: BotSummary, requestId: string, text: string, answer: string) {
	await h.api("messages.submit", { botId: bot.botId, requestId, text });
	await expect.poll(async () => JSON.stringify(await h.api("conversations.snapshot", { botId: bot.botId }))).toContain(answer);
}
beforeAll(async () => {
	h = await launchApp("role-memory-workflow", { prepare: async root => { await writeFile(join(root, "workspace/invoices.csv"), invoiceCsv); return {}; } });
	await h.api("settings.update", { defaultModel: { provider: "scripted", modelId: "scripted" } });
	finance = await h.api("bots.create", { requestId: "finance", name: "Finance" });
	reviewer = await h.api("bots.create", { requestId: "reviewer", name: "Reviewer" });
	triage = await h.api("skills.save", { requestId: "triage", name: triageSkill().name, expectedRevision: 0, document: triageSkill() });
	review = await h.api("skills.save", { requestId: "review", name: reviewSkill.name, expectedRevision: 0, document: reviewSkill });
	finance = await h.api("bots.update", { botId: finance.botId, expectedRevision: finance.revision, defaultSkills: [ref(triage)] });
	reviewer = await h.api("bots.update", { botId: reviewer.botId, expectedRevision: reviewer.revision, defaultSkills: [ref(review)] });
}, 90_000);
afterEach(async ({ task }) => { if (task.result?.state === "fail") await h.shot("failure"); });
afterAll(async () => { await h?.close(); });

it("combines a corrected memory with the original role method after a new topic and restart", async () => {
	h.model.script({ tool: "memory_update", args: { action: "replace", section: "Collection policy", content: "USD; unpaid invoices strictly over 14 days. FINANCE_ONLY_72.", expectedRevision: 0 } }, { text: "Initial policy remembered." });
	await send(finance, "learn", "Remember our collection policy", "Initial policy remembered.");
	const memory = await h.api("bots.memory.get", { botId: finance.botId });
	expect(memory.notes[0].original).toMatchObject({ kind: "model", botId: finance.botId, requestIds: ["learn"] });
	await h.api("bots.memory.note", { botId: finance.botId, requestId: "correct", action: "edit", scope: "bot", expectedRevision: memory.revision, noteId: memory.notes[0].id, content: "USD; unpaid invoices strictly over 20 days. FINANCE_ONLY_72." });
	latest = await h.api("skills.save", { requestId: "triage-v2", name: triageSkill().name, expectedRevision: 1, document: triageSkill(2) });
	await h.api("conversations.reset", { botId: finance.botId }); await h.relaunch();
	h.model.script({ tool: "local_read", args: { path: "invoices.csv" } }, { tool: "local_write", args: { path: "report.json", content: JSON.stringify({ ...expectedReport(20), method_revision: "triage-v1" }) } }, { text: "Corrected report delivered." });
	await send(finance, "report", "Produce the collections report", "Corrected report delivered.");
	const input = JSON.stringify(h.model.requests.at(-1)?.messages);
	expect(input).toContain("strictly over 20 days"); expect(input).not.toContain("strictly over 14 days");
	expect(input).toContain("triage-v1"); expect(input).not.toContain("triage-v2");
	expect(input).toContain("Attached task-selected revisions take precedence");
	expect(input).toContain("This exact revision is pinned for this task");
	expect(JSON.parse(await readFile(join(h.workspace, "report.json"), "utf8"))).toMatchObject(expectedReport(20));
});

it("gives the reviewer shared context and its own method without the analyst's local note", async () => {
	await h.api("memory.shared.update", { expectedRevision: 0, content: "## Report audience\nNORTHSTAR_SHARED_99; concise Chinese summaries." });
	const firstRequest = h.model.requests.length;
	h.model.script({ tool: "local_read", args: { path: "report.json" } }, { tool: "local_write", args: { path: "review.json", content: JSON.stringify({ passed: true, checked_overdue_total: 1600 }) } }, { text: "Independent review delivered." });
	await send(reviewer, "review", "Review report.json independently", "Independent review delivered.");
	const input = JSON.stringify(h.model.requests[firstRequest]?.messages);
	expect(input).toContain("NORTHSTAR_SHARED_99"); expect(input).toContain("review-v1");
	expect(input).not.toContain("FINANCE_ONLY_72"); expect(input).not.toContain("triage-v1");
	expect(JSON.parse(await readFile(join(h.workspace, "review.json"), "utf8"))).toEqual({ passed: true, checked_overdue_total: 1600 });
});

it("loads group methods explicitly and preserves the completed review chain through restart", async () => {
	await h.api("groups.change", { action: "create", requestId: "group-create", groupId: "group_acceptance", expectedRevision: 0, fields: { name: "Collections team", objective: "Calculate and review", memberIds: [finance.botId, reviewer.botId], leadBotId: finance.botId } });
	let groupInput = "";
	h.model.script(
		{ tool: "bot_delegate", args: { botId: finance.botId, task: "Create a collections report and ask Reviewer to verify", expectedResult: "Reviewed result" } }, { text: "Finance assigned." },
		{ tool: "skill_load", args: request => { groupInput = JSON.stringify(request.messages); return ref(latest); } },
		{ tool: "local_write", args: { path: "team-report.json", content: JSON.stringify({ ...expectedReport(20), method_revision: "triage-v2" }) } },
		{ tool: "bot_delegate", args: { botId: reviewer.botId, task: "Independently review team-report.json", expectedResult: "Verified totals" } }, { text: "Review requested." },
		{ tool: "skill_load", args: ref(review) }, { tool: "local_read", args: { path: "team-report.json" } },
		{ text: "Verified: overdue total 1600 USD." }, { text: "Finance delivered the reviewed report." }, { text: "The team report is complete." },
	);
	await h.api("groups.send", { groupId: "group_acceptance", requestId: "group-work", text: "Calculate and independently review the collections report" });
	await expect.poll(async () => (await h.api("groups.snapshot", { groupId: "group_acceptance" })).roots[0]?.state, { timeout: 20_000 }).toBe("completed");
	expect(groupInput).toContain("FINANCE_ONLY_72"); expect(groupInput).not.toContain("NORTHSTAR_SHARED_99"); expect(groupInput).not.toContain("triage-v1");
	const before = await h.api("groups.snapshot", { groupId: "group_acceptance" });
	expect(before.tasks.map((task: any) => task.origin)).toEqual(["user", "peer", "peer", "result", "result"]);
	await h.page().locator(".group-nav").filter({ hasText: "Collections team" }).click(); await h.shot("01-reviewed-group");
	const requests = h.model.requests.length; await h.relaunch();
	expect((await h.api("groups.snapshot", { groupId: "group_acceptance" })).posts).toEqual(before.posts);
	expect(h.model.requests.length).toBe(requests);
});
