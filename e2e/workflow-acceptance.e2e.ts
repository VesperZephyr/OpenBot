/** I3: one business workflow through real Desktop/Host/executor and an independent synthetic CRM. */
import { execFileSync } from "node:child_process";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, afterAll, beforeEach, afterEach, expect, it } from "vitest";
import { launchApp, repo, type AppHarness } from "./harness.ts";
import type { ScriptedTurn, ModelRequest } from "./scripted-model.ts";
import { crmFixture, policyCapture, initialInvoices, changedInvoices, referenceUrl } from "./fixtures/crm-workflow.ts";
let h: AppHarness, crm: Awaited<ReturnType<typeof crmFixture>>, core: string, routine: any, skill: any, firstArtifact: string;
let interventions = 0, approvedConnectorCalls = 0, beforeApproved = 0, started = 0, beforeCalls = 0, beforeEffects = 0, beforeInterventions = 0;
let workflowOutcome = "incomplete";
const evidence: object[] = [];
const api = (name: string, params = {}): Promise<any> => h.page().evaluate(({ name, params }) => (window as any).openbot.methods[name](params), { name, params });
const poll = (fn: () => Promise<any>) => expect.poll(fn, { timeout: 20000 });
const button = (name: string) => h.page().getByRole("button", { name, exact: true });
const snapshot = () => api("conversations.snapshot", { botId: core });
const detail = () => api("routines.get", { routineId: routine.routineId });
const profile = async () => (await api("connectors.list"))[0];
const connector = async (action = "connect") => { const p = await profile(); interventions++; return api(`connectors.${action}`, { connectorId: p.connectorId, expectedRevision: p.revision, requestId: crypto.randomUUID() }); };
const script = (...turns: ScriptedTurn[]) => h.model.script(...turns.map(t => ({ ...t, usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } })));
const finishChat = async (text: string) => { await h.page().getByText(text, { exact: true }).waitFor(); await poll(async () => (await snapshot()).run).toBeUndefined(); };
const approve = async (tool: string, unattended = false, decision = "Allow once") => {
	const read = unattended ? async () => (await detail()).snapshot : snapshot;
	await poll(async () => (await read())?.approvals[0]?.tool).toBe(tool);
	const approval = (await read()).approvals[0];
	if (unattended) { expect(approval.binding.origin).toBe("unattended"); expect(approval.deadline - approval.createdAt).toBe(600000); }
	interventions++;
	if (tool.startsWith("mcp__") && decision === "Allow once") approvedConnectorCalls++;
	await h.page().locator(unattended ? ".routine-result .approval" : ".approval").getByRole("button", { name: decision, exact: true }).click();
	return approval;
};
const captureAccounts = (request: ModelRequest) => {
	const tool = request.messages.filter(m => m.role === "tool").at(-1);
	const text = typeof tool?.content === "string" ? tool.content : JSON.stringify(tool?.content);
	const data = /\{"accounts":\[[^\n]+\]\}/.exec(text ?? "")?.[0];
	expect(data).toBeDefined();
	const captured = JSON.parse(data!);
	expect(captured.accounts).toEqual(crm.accounts);
	return { path: "crm-snapshot.json", content: JSON.stringify(captured) };
};
const readAndReport = (): ScriptedTurn[] => [
	{ tool: "tool_search", args: { query: "list_accounts update_account", limit: 2 } },
	{ tool: "mcp__crm__list_accounts", args: {} },
	{ tool: "local_write", args: captureAccounts },
	{ tool: "local_read", args: { path: "invoices.csv" } },
	{ tool: "local_read", args: { path: "policy-capture.md" } },
	{ tool: "local_exec", args: { command: "node crm-report.mjs", description: "Calculate receivables from current sources" } },
	{ tool: "artifact_publish", args: { path: "receivables.md" } },
];
const selectRoutine = async () => { await h.page().getByRole("button", {name:/^Settings/}).click(); await button("Routines").click(); await h.page().getByRole("button", { name: /Receivables review/ }).click(); };
const runRoutine = async () => {
	const previous = (await detail()).history[0]?.occurrenceId;
	await button("Test run").click(); await button("Run now").click(); interventions++;
	await poll(async () => (await detail()).history[0]?.occurrenceId).not.toBe(previous);
};
const result = async () => { await poll(async () => (await detail()).history[0]?.published).toBe(true); return (await detail()).history[0]; };
beforeAll(async () => {
	h = await launchApp("workflow-acceptance", { prepare: async root => {
		crm = await crmFixture(root);
		await writeFile(join(root, "workspace/invoices.csv"), initialInvoices);
		await writeFile(join(root, "workspace/policy-capture.md"), policyCapture);
		await copyFile(join(repo, "e2e/fixtures/crm-report.mjs"), join(root, "workspace/crm-report.mjs"));
		return { NODE_EXTRA_CA_CERTS: crm.certPath, OPENBOT_TAVILY_BASE_URL: crm.searchUrl };
	} });
	h.page().setDefaultTimeout(12000);
	await api("settings.update", { defaultModel: { provider: "scripted", modelId: "scripted" } });
	core = (await api("bots.list")).find((b: any) => b.kind === "core").botId;
	await api("connectors.install", { connectorId: "crm", name: "Synthetic CRM", transport: "https", endpoint: crm.endpoint, auth: "bearer", requestId: "i3-crm" });
	await api("connectors.credential.set", { connectorId: "crm", expectedRevision: (await profile()).revision, value: crm.state.token });
	await connector();
	await api("credentials.set", { providerId: "search:tavily", apiKey: "SYNTHETIC_I3_SEARCH" });
});
beforeEach(() => { workflowOutcome = "incomplete"; beforeApproved = approvedConnectorCalls; started = Date.now(); beforeCalls = crm.state.requests.filter(r => r.rpc === "tools/call").length; beforeEffects = crm.effects.length; beforeInterventions = interventions; });
afterEach(async ({ task }) => {
	if (!h) return;
	if (task.result?.state === "fail") await h.shot("failure");
	const usage = await api("usage.get", { botId: core });
	evidence.push({ scenario: task.name, check: task.result?.state, workflowOutcome, connectorRetryRequests: Math.max(0, crm.state.requests.filter(r => r.rpc === "tools/call").length - beforeCalls - (approvedConnectorCalls - beforeApproved)), elapsedMs: Date.now() - started, interventions: interventions - beforeInterventions, toolRequests: crm.state.requests.filter(r => r.rpc === "tools/call").length - beforeCalls, effects: crm.effects.length - beforeEffects, cumulativeTokens: usage.total.totalTokens ?? null, cumulativeEstimatedUsd: usage.total.estimatedUsd ?? null });
	await writeFile(join(h.run, "evidence.json"), JSON.stringify({ candidate: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(), mode: "scripted", scenarios: evidence }, null, 2));
});
afterAll(async () => {
	if (h) { await connector("remove").catch(() => {}); await h.close(); }
	await crm?.close();
});
it("joins CRM and captured research, denies a wrong update, confirms the correction and reviews a reusable skill", async () => {
	script({ tool: "web_search", args: { query: "receivables policy", count: 1 } }, ...readAndReport(),
		{ tool: "mcp__crm__update_account", args: { accountId: "boreal", expectedVersion: 1, risk: "high" } },
		{ text: "Partial: report saved; the proposed CRM update was denied. No CRM change was applied." });
	await h.send("Review invoices against CRM and the captured policy. Research the reference and propose a risk update.");
	await approve("mcp__crm__list_accounts"); await approve("local_exec");
	await approve("mcp__crm__update_account", false, "Deny");
	await finishChat("Partial: report saved; the proposed CRM update was denied. No CRM change was applied.");
	expect(crm.effects).toEqual([]);
	expect(crm.searchRequests).toBe(1);
	expect(JSON.stringify(h.model.requests)).toContain(referenceUrl);
	expect(JSON.stringify(h.model.requests[0]?.messages.filter(m => m.role === "system" || m.role === "developer"))).toContain("Search with tool_search");
	expect(JSON.parse(await readFile(join(h.workspace, "receivables.json"), "utf8"))).toEqual({ total: 2000, overdue: 1200, proposed: [{ accountId: "atlas", expectedVersion: 1, risk: "high" }] });
	firstArtifact = (await snapshot()).items.find((i: any) => i.tool === "artifact_publish").artifact.artifactId;
	expect((await api("artifacts.preview", { artifactId: firstArtifact })).text).toContain("$1200");
	script({ tool: "mcp__crm__update_account", args: { accountId: "atlas", expectedVersion: 1, risk: "high" } }, { text: "Atlas is now high risk; one CRM update is confirmed." });
	interventions++;
	await h.send("Correction: only Atlas exceeds 30 days. Update Atlas at version 1, not Boreal.");
	await poll(async () => (await snapshot()).approvals[0]?.args).toEqual({ accountId: "atlas", expectedVersion: 1, risk: "high" });
	await h.shot("01-corrected-approval-en");
	await approve("mcp__crm__update_account");
	await finishChat("Atlas is now high risk; one CRM update is confirmed.");
	expect(crm.effects).toEqual([{ accountId: "atlas", expectedVersion: 1, risk: "high" }]);
	script({ tool: "skill_save", args: { action: "save", name: "receivables-review", expectedRevision: 0, document: {
		name: "receivables-review", description: "Review receivables against current CRM and source policy", inputs: "invoices.csv, policy-capture.md, current CRM accounts", requirements: "Connected CRM and readable source files",
		steps: "Read current accounts, search supporting material, read full source text, calculate overdue amounts, publish a report, then propose only accounts more than 30 days overdue. CORRECTED_METHOD_I3: check account IDs and record versions.",
		validation: "Recalculate totals from invoice rows. Never use a search snippet as the full policy. Never retry an unknown write.", output: "Artifact report plus separately confirmed, partial or unknown CRM status", approvalBoundaries: "Exact connector and command approvals remain required. A report or a saved skill never grants permission."
	} } }, { text: "The corrected receivables procedure is saved for reviewable reuse." });
	await h.send("Save the corrected method as a reusable skill.");
	await h.page().locator(".approval .skill-review").waitFor();
	expect((await api("skills.list"))).toHaveLength(0);
	await h.shot("02-skill-review-en");
	await approve("skill_save");
	await finishChat("The corrected receivables procedure is saved for reviewable reuse.");
	skill = (await api("skills.list"))[0];
	expect(skill.revision).toBe(1);
	workflowOutcome = "completed";
}, 90000);
it("pins the corrected skill, reads changed inputs and survives Host loss with one routine report and one new effect", async () => {
	await writeFile(join(h.workspace, "invoices.csv"), changedInvoices);
	await h.page().getByRole("button", {name:/^Settings/}).click(); await button("Routines").click(); await button("New routine").click();
	await h.page().getByLabel("Routine name", { exact: true }).fill("Receivables review");
	await h.page().getByLabel("Workflow", { exact: true }).fill("Read current CRM and invoices.csv, apply policy-capture.md, calculate and publish receivables.md. Propose exact versioned updates and report partial or unknown outcomes honestly.");
	await h.page().getByLabel("Frequency", { exact: true }).selectOption("weekly");
	await h.page().getByLabel(/receivables-review/).check();
	await button("Review routine").click(); await button("Confirm routine change").click(); interventions++;
	await poll(async () => (await api("routines.list")).routines.length).toBe(1);
	routine = (await api("routines.list")).routines[0];
	expect(routine.skills).toEqual([{ name: skill.name, revision: skill.revision, sha256: skill.sha256 }]);
	await selectRoutine();
	const requestStart = h.model.requests.length;
	script(...readAndReport(), { tool: "tool_search", args: { query: "update_account", limit: 1 } }, { tool: "mcp__crm__update_account", args: { accountId: "boreal", expectedVersion: 1, risk: "high" } }, { text: "Receivables: $2500 overdue. Boreal was updated once; Atlas was already high risk." });
	await runRoutine(); await approve("mcp__crm__list_accounts", true);
	await poll(async () => (await detail()).snapshot?.approvals[0]?.tool).toBe("local_exec");
	const pending = (await detail()).snapshot.approvals[0];
	await h.crashHost();
	await poll(async () => (await detail()).snapshot?.approvals[0]?.approvalId).toBe(pending.approvalId);
	expect((await detail()).snapshot.approvals[0].deadline).toBe(pending.deadline);
	expect((await profile()).state).toBe("disconnected");
	await connector();
	await approve("local_exec", true); await approve("mcp__crm__update_account", true);
	const occurrence = await result();
	expect(occurrence.state).toBe("completed");
	expect(occurrence.artifacts).toHaveLength(1);
	expect(JSON.stringify(h.model.requests[requestStart]?.messages)).toContain("CORRECTED_METHOD_I3");
	expect(JSON.parse(await readFile(join(h.workspace, "receivables.json"), "utf8"))).toEqual({ total: 2500, overdue: 2500, proposed: [{ accountId: "boreal", expectedVersion: 1, risk: "high" }] });
	expect(crm.effects).toHaveLength(2);
	expect(crm.effects[1]).toEqual({ accountId: "boreal", expectedVersion: 1, risk: "high" });
	await h.page().locator(".routine-result").scrollIntoViewIfNeeded(); await h.shot("03-routine-result-en");
	const usage = (await api("usage.get", { botId: core })).total;
	await h.relaunch();
	expect((await snapshot()).items.filter((i: any) => i.routine?.occurrenceId === occurrence.occurrenceId)).toHaveLength(1);
	expect((await api("usage.get", { botId: core })).total).toEqual(usage);
	expect((await api("artifacts.preview", { artifactId: firstArtifact })).text).toContain("$1200");
	expect((await api("artifacts.preview", { artifactId: occurrence.artifacts[0].artifactId })).text).toContain("$2500");
	expect(crm.effects).toHaveLength(2);
	await connector(); await selectRoutine();
	workflowOutcome = "completed";
}, 90000);
it("retains partial reports on rate limiting and revoked auth without automatic tool retries", async () => {
	for (const mode of ["rate", "auth"]) {
		const calls = crm.state.requests.filter(r => r.rpc === "tools/call").length;
		const text = `Partial: the report is available, but the CRM update is unconfirmed (${mode}). Reconnect explicitly after resolving the connector issue.`;
		script({ tool: "artifact_publish", args: { path: "receivables.md" } }, { tool: "tool_search", args: { query: "update_account", limit: 1 } }, { tool: "mcp__crm__update_account", args: { accountId: "atlas", expectedVersion: 2, risk: "normal" } }, { text });
		await runRoutine();
		await poll(async () => (await detail()).snapshot?.approvals[0]?.tool).toBe("mcp__crm__update_account");
		crm.state.mode = mode; crm.state.retry = "3";
		await approve("mcp__crm__update_account", true);
		const occurrence = await result();
		expect(occurrence.report).toContain("Partial:"); expect(occurrence.artifacts).toHaveLength(1);
		expect(crm.effects).toHaveLength(2);
		expect(crm.state.requests.filter(r => r.rpc === "tools/call")).toHaveLength(calls + 1);
		await api("settings.update", { language: "zh-CN" });
		await button("编辑定时任务").waitFor();
		await h.page().locator(".routine-result > .markdown").getByText(text, { exact: true }).waitFor();
		await h.page().locator(".routine-result").scrollIntoViewIfNeeded(); await h.shot(`04-${mode}-partial-zh`);
		await api("settings.update", { language: "en" });
		await button("Edit routine").waitFor();
		crm.state.mode = "normal";
		if (mode === "rate") await poll(async () => Date.now() >= (await profile()).retryAt).toBe(true);
		await connector();
	}
	workflowOutcome = "partial";
});
it("preserves an unknown remote effect and one attention report after response loss and restart", async () => {
	const calls = crm.state.requests.filter(r => r.rpc === "tools/call").length;
	script({ tool: "artifact_publish", args: { path: "receivables.md" } }, { tool: "tool_search", args: { query: "update_account", limit: 1 } }, { tool: "mcp__crm__update_account", args: { accountId: "atlas", expectedVersion: 2, risk: "normal" } }, { text: "Unknown: the CRM response was lost. The report remains available. Inspect the record before any new write; do not retry." });
	await runRoutine();
	crm.loseNextResponse(); await approve("mcp__crm__update_account", true);
	const occurrence = await result();
	expect(occurrence.state).toBe("needs_attention");
	expect(occurrence.artifacts).toHaveLength(1);
	await poll(async () => {
		const result = await api("conversations.window", { conversationKey: `bot:${core}`, occurrenceId: occurrence.occurrenceId, position: { kind: "latest" } });
		return result.status === "ready" ? result.window.rows.find((row: any) => row.content.kind === "direct" && row.content.item.tool === "mcp__crm__update_account")?.content.item.status : undefined;
	}).toBe("interrupted");
	expect(crm.effects).toHaveLength(3);
	await h.page().locator(".routine-result").scrollIntoViewIfNeeded(); await h.shot("05-unknown-en");
	const requests = h.model.requests.length;
	await h.relaunch();
	expect(crm.effects).toHaveLength(3);
	expect(crm.state.requests.filter(r => r.rpc === "tools/call")).toHaveLength(calls + 1);
	expect(h.model.requests).toHaveLength(requests);
	workflowOutcome = "unknown";
	expect((await snapshot()).items.filter((i: any) => i.routine?.occurrenceId === occurrence.occurrenceId)).toHaveLength(1);
	expect((await detail()).history[0].state).toBe("needs_attention");
	const persisted = JSON.stringify({ snapshot: await snapshot(), detail: await detail(), requests: h.model.requests });
	expect(persisted).not.toContain(crm.state.token);
	expect(await readFile(join(h.dataDirectory, "logs/host.log"), "utf8")).not.toContain(crm.state.token);
	expect(await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(w => !w.isVisible() && !w.isFocused()))).toBe(true);
});
