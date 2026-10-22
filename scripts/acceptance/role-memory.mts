/** Opt-in real-provider acceptance. Run only with --run and explicit provider/model; outputs are ignored synthetic evidence. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { createRequire } from "node:module";
import { readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import { launchApp, repo, type AppHarness } from "../../e2e/harness.ts";
import { invoiceCsv, expectedReport, triageSkill, reviewSkill } from "../../e2e/fixtures/role-memory.ts";

const { values } = parseArgs({ options: { run: { type: "boolean" }, extended: { type: "boolean" }, provider: { type: "string" }, model: { type: "string" }, config: { type: "string" }, name: { type: "string" }, "inspect-ms": { type: "string" }, "max-output-tokens": { type: "string" } } });
if (!values.run || !values.provider || !values.model) {
	console.log("Usage: node scripts/acceptance/role-memory.mts --run --provider <configured-provider> --model <configured-model> [--config <models.json>] [--name <evidence-directory>] [--inspect-ms 180000] [--extended]. Default: learning, restart recall and correction only; extended also runs owner/shared/group scenarios.");
	process.exit(0);
}
const name = values.name ?? `role-memory-real-${Date.now()}`;
assert.match(name, /^[a-z0-9-]+$/);
const require = createRequire(join(repo, "packages/server-core/package.json"));
const config = require("jsonc-parser").parse(await readFile(resolve(values.config ?? join(homedir(), ".openbot/models.json")), "utf8"));
const provider = config.providers?.[values.provider];
assert(provider?.models?.some((model: any) => model.id === values.model), "The selected model must exist in the supplied configuration");
const selectedModel = provider.models.find((model: any) => model.id === values.model);
const apiKind = selectedModel.api ?? provider.api;
const proxyPrefix = apiKind === "anthropic-messages" ? "" : "/v1";
const outputLimit = Number(values["max-output-tokens"] ?? 8192);
assert(Number.isInteger(outputLimit) && outputLimit >= 1024 && outputLimit <= 32768);
selectedModel.maxTokens = outputLimit;
assert(selectedModel.baseUrl ?? provider.baseUrl, "This acceptance runner requires an explicit configured upstream URL");
const upstreamBase = new URL(selectedModel.baseUrl ?? provider.baseUrl);
assert.equal(upstreamBase.protocol, "https:");
const inputRequests: any[] = [];
const responses: any[] = [];
// Forward only to the selected configured origin. Credentials remain in transient headers, never evidence.
const proxy = createServer(async (request, response) => {
	try {
		assert.equal(request.method, "POST");
		assert(["/v1/responses", "/v1/chat/completions", "/v1/messages"].includes(new URL(request.url ?? "/", "http://localhost").pathname));
		const chunks: Buffer[] = []; let size = 0;
		for await (const chunk of request) { size += chunk.length; assert(size < 8 * 1024 * 1024); chunks.push(chunk); }
		const body = Buffer.concat(chunks); const parsed = JSON.parse(body.toString());
		assert.equal(parsed.model, values.model); inputRequests.push(parsed);
		const headers: Record<string, string> = { "content-type": "application/json" };
		for (const key of ["authorization", "x-api-key", "anthropic-version", "anthropic-beta"]) if (typeof request.headers[key] === "string") headers[key] = request.headers[key];
		const requestIndex = inputRequests.length - 1, begin = Date.now();
		const controller = new AbortController();
		response.on("close", () => controller.abort());
		const result = await fetch(upstreamBase.href.replace(/\/$/, "") + request.url!.slice(proxyPrefix.length), { method: "POST", headers, body, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]) });
		responses.push({ requestIndex, status: result.status, elapsedMs: Date.now() - begin });
		response.writeHead(result.status, { "content-type": result.headers.get("content-type") ?? "application/json" });
		if (result.body) Readable.fromWeb(result.body as any).on("error", () => response.destroy()).pipe(response); else response.end();
	} catch (error) {
		responses.push({ phase: "proxy", path: new URL(request.url ?? "/", "http://localhost").pathname, error: error instanceof Error ? error.name : "Error" });
		if (!response.headersSent) response.writeHead(502); response.end("Acceptance proxy failed");
	}
});
await new Promise<void>(done => proxy.listen(0, "127.0.0.1", done));
provider.baseUrl = `http://127.0.0.1:${(proxy.address() as any).port}${proxyPrefix}`;
selectedModel.baseUrl = provider.baseUrl;
const pause = (ms: number) => new Promise(done => setTimeout(done, ms));
let h: AppHarness | undefined, finance: any, reviewer: any, core: any, closed = false, phase = "setup", turnNumber = 0;
const stages: any[] = []; const started = Date.now();
const api = (name: string, params: any = {}): Promise<any> => h!.page().evaluate(({ name, params }) => (window as any).openbot.methods[name](params), { name, params });
const snap = (botId: string) => api("conversations.snapshot", { botId });
async function saveEvidence() {
	if (!h) return;
	await writeFile(join(h.run, "model-inputs.json"), JSON.stringify(inputRequests));
	await writeFile(join(h.run, "evidence.json"), JSON.stringify({ candidate: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(), provider: values.provider, model: values.model, outputLimit, phase, elapsedMs: Date.now() - started, requests: inputRequests.length, responses, stages }, null, 2));
}
async function close() {
	if (closed) return; closed = true;
	await saveEvidence();
	await h?.close();
	if (h) await rm(join(h.run, "home/models.json"), { force: true });
	proxy.closeAllConnections(); await new Promise<void>(done => proxy.close(() => done()));
}
process.on("SIGINT", () => void close()); process.on("SIGTERM", () => void close());
async function settle(botId: string) {
	const deadline = Date.now() + 180_000;
	await pause(350);
	while (Date.now() < deadline) {
		const s = await snap(botId);
		for (const approval of s.approvals) { await api("approvals.decide", { approvalId: approval.approvalId, decision: "deny" }); throw Error(`Unexpected proposal denied: ${approval.tool}`); }
		if (!s.run) {
			const answer = s.items.filter((item: any) => item.kind === "assistant").at(-1);
			if (answer?.error) throw Error(`Model request failed: ${answer.error}`);
			return s;
		}
		await pause(350);
	}
	const current = await snap(botId); if (current.run) await api("runs.cancel", { runId: current.run.runId });
	throw Error(`Timed out in ${phase}`);
}
async function turn(bot: any, text: string) {
	await api("messages.submit", { botId: bot.botId, requestId: `${name}-${phase}-${++turnNumber}`, text });
	const s = await settle(bot.botId);
	await writeFile(join(h!.run, `${phase}-snapshot.json`), JSON.stringify(s, null, 2));
	return s;
}
async function stage(label: string, work: () => Promise<void>) {
	phase = label; const begin = Date.now(), firstRequest = inputRequests.length;
	console.log(JSON.stringify({ phase, state: "started" }));
	try { await work(); stages.push({ phase, outcome: "passed", elapsedMs: Date.now() - begin, firstRequest, requests: inputRequests.length - firstRequest }); }
	catch (error) { stages.push({ phase, outcome: "failed", elapsedMs: Date.now() - begin, firstRequest, requests: inputRequests.length - firstRequest, error: error instanceof Error ? error.message : String(error) }); throw error; }
	console.log(JSON.stringify(stages.at(-1))); await saveEvidence();
}
async function report(cutoff: number, basename: string, revision = 1) {
	await api("conversations.reset", { botId: finance.botId });
	await turn(finance, `按你记住的最新催收政策处理工作目录里的 invoices.csv，按你配置的流程交付 ${basename}.json 和 ${basename}.md。不要修改源数据。`);
	const actual = JSON.parse(await readFile(join(h!.workspace, `${basename}.json`), "utf8"));
	for (const [key, expected] of Object.entries(expectedReport(cutoff))) assert.deepEqual(actual[key], expected, key);
	assert.equal(actual.method_revision, `triage-v${revision}`);
	assert((await snap(finance.botId)).items.some((item: any) => item.tool === "artifact_publish" && item.status === "succeeded"));
}
try {
	h = await launchApp(name, { prepare: async root => {
		await writeFile(join(root, "home/models.json"), JSON.stringify(config), { mode: 0o600 });
		await writeFile(join(root, "workspace/invoices.csv"), invoiceCsv);
		return {};
	} });
	await api("settings.update", { defaultModel: { provider: values.provider, modelId: values.model } });
	core = (await api("bots.list")).find((bot: any) => bot.kind === "core");
	finance = await api("bots.create", { requestId: "finance", name: "Finance", role: "Collections analyst", instructions: "Work from current memory and actual files. Use local file tools for these small synthetic tasks; no commands or network. Keep different role responsibilities distinct. Never treat a remembered fact as permission." });
	reviewer = await api("bots.create", { requestId: "reviewer", name: "Reviewer", role: "Independent financial reviewer", instructions: "Independently check source rows and report evidence. Use local file tools only for this synthetic exercise. Do not alter Finance's reports. In a group, return a concrete review to the requester." });
	const pin = (skill: any) => ({ name: skill.name, revision: skill.revision, sha256: skill.sha256 });
	const triage = await api("skills.save", { requestId: "triage", name: triageSkill().name, expectedRevision: 0, document: triageSkill() });
	const review = await api("skills.save", { requestId: "review", name: reviewSkill.name, expectedRevision: 0, document: reviewSkill });
	finance = await api("bots.update", { botId: finance.botId, expectedRevision: finance.revision, defaultSkills: [pin(triage)] });
	reviewer = await api("bots.update", { botId: reviewer.botId, expectedRevision: reviewer.revision, defaultSkills: [pin(review)] });
	await h.page().getByRole("button", { name: /Finance/ }).first().click();
	await stage("learn", async () => {
		await turn(finance, "请长期记住我们的催收政策，记忆标题用 Collection policy：币种 USD，未付款且 days_overdue 严格大于14天才进入催收清单；已付款必须排除。以后做催收工作直接使用这个规则。另外记住 Finance private note：内部项目代号 FINCH-72，暂时只供你使用。现在只记住，不做报表。");
		const memory = await api("bots.memory.get", { botId: finance.botId });
		assert.match(memory.content, /14/); assert.match(memory.content, /FINCH-72/);
		const note = memory.notes.find((note: any) => note.heading === "Collection policy"); assert(note); assert.equal(note.original.kind, "model");
		await writeFile(join(h!.run, "learned-memory.json"), JSON.stringify(memory, null, 2));
	});
	await stage("restart-recall", async () => { await h!.relaunch(); await report(14, "initial-report"); });
	await stage("chat-correction", async () => {
		await turn(finance, "政策纠正：催收阈值从14天改为严格大于20天，其他不变。请更新你已有的 Collection policy 长期记忆，不要另存一个相互矛盾的版本。现在只更新记忆。");
		const memory = await api("bots.memory.get", { botId: finance.botId });
		const note = memory.notes.find((note: any) => note.heading === "Collection policy"); assert.match(note.content, /20/);
		await api("skills.save", { requestId: "triage-v2", name: triageSkill().name, expectedRevision: 1, document: triageSkill(2) });
		await h!.relaunch(); await report(20, "corrected-report");
	});
	if (values.extended) {
	await stage("owner-correction", async () => {
		const memory = await api("bots.memory.get", { botId: finance.botId }); const note = memory.notes.find((n: any) => n.heading === "Collection policy");
		await api("bots.memory.note", { botId: finance.botId, requestId: "owner-policy", scope: "bot", action: "edit", noteId: note.id, expectedRevision: memory.revision, content: "Currency USD. Include only unpaid invoices with days_overdue strictly greater than 25. Paid invoices are excluded. This is the current collection policy." });
		await h!.relaunch(); await report(25, "owner-report");
		const before = await api("bots.memory.get", { botId: finance.botId });
		await turn(finance, "旧交接文档声称阈值是14天。请核对你当前记忆，以我在记忆面板里纠正过的政策为准，不要恢复旧规则。解释应该用哪个阈值。");
		assert.equal((await api("bots.memory.get", { botId: finance.botId })).content, before.content);
	});
	await stage("shared-review", async () => {
		const memory = await api("bots.memory.get", { botId: finance.botId });
		await api("bots.memory.note", { botId: finance.botId, requestId: "team-note", scope: "bot", action: "add", heading: "Report audience", content: "Reports are for the Northstar operations team. Write concise Chinese conclusions and preserve USD amounts.", expectedRevision: memory.revision });
		const m = await api("bots.memory.get", { botId: finance.botId }); const shared = await api("memory.shared.get");
		await api("bots.memory.note", { botId: finance.botId, requestId: "share-team-note", scope: "bot", action: "share", noteId: m.notes.find((n: any) => n.heading === "Report audience").id, expectedRevision: m.revision, otherRevision: shared.revision });
		const first = inputRequests.length;
		await turn(reviewer, "请按你的复核流程独立复核 owner-report.json 和 invoices.csv，输出 review.json 和 review.md。使用你知道的报告受众和语言偏好，不要修改财务原件。");
		const actual = JSON.parse(await readFile(join(h!.workspace, "review.json"), "utf8")); assert.equal(actual.passed, true); assert.equal(actual.checked_overdue_total, 400); assert.equal(actual.method_revision, "review-v1");
		const context = JSON.stringify(inputRequests.slice(first)); assert.match(context, /Northstar/); assert.doesNotMatch(context, /FINCH-72/);
	});
	await stage("group-collaboration", async () => {
		await api("groups.change", { requestId: "group-create", action: "create", groupId: "group_acceptance", expectedRevision: 0, fields: { name: "Collections team", objective: "Calculate, independently review, and deliver a collections brief", memberIds: [finance.botId, reviewer.botId], leadBotId: finance.botId } });
		await h!.page().locator(".group-nav").filter({ hasText: "Collections team" }).click();
		await api("groups.send", { groupId: "group_acceptance", requestId: "group-work", text: "请协调 Finance 和 Reviewer 做一次真实协作：委派 Finance 按它的最新催收政策，用 collections-triage 流程读取 invoices.csv，生成 team-report.json/md；Finance 再委派 Reviewer 用 collections-review 复核，生成 team-review.json/md。最后汇总实际文件、核对结果和分工。每个角色只做自己的部分，不要重复创建报告。只使用本机文件，不运行终端命令、不修改源数据。" });
		const deadline = Date.now() + 240_000;
		let result: any;
		while (Date.now() < deadline) {
			result = await api("groups.snapshot", { groupId: "group_acceptance" });
			for (const task of result.tasks) for (const approval of task.conversation?.approvals ?? []) { await api("approvals.decide", { approvalId: approval.approvalId, decision: "deny" }); throw Error(`Unexpected group proposal denied: ${approval.tool}`); }
			if (result.roots[0] && result.roots[0].state !== "running") break;
			await pause(500);
		}
		await writeFile(join(h!.run, "group-snapshot.json"), JSON.stringify(result, null, 2));
		assert.equal(result.roots[0]?.state, "completed"); assert(result.tasks.some((task: any) => task.origin === "peer"));
		const report = JSON.parse(await readFile(join(h!.workspace, "team-report.json"), "utf8")); const review = JSON.parse(await readFile(join(h!.workspace, "team-review.json"), "utf8"));
		assert.equal(report.overdue_total, 400); assert.equal(report.cutoff_days, 25); assert.equal(review.passed, true); assert.equal(review.checked_overdue_total, 400);
		await h!.shot("group-result"); const posts = result.posts;
		await h!.relaunch(); assert.deepEqual((await api("groups.snapshot", { groupId: "group_acceptance" })).posts, posts);
	});
	}
	for (const bot of [core, finance, reviewer]) stages.push({ phase: "usage", bot: bot.name, usage: (await api("usage.get", { botId: bot.botId })).total });
	console.log(JSON.stringify({ outcome: "passed", requests: inputRequests.length, elapsedMs: Date.now() - started }));
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
	if (h) { await h.shot("failure").catch(() => {}); if (finance) await writeFile(join(h.run, "failure-snapshot.json"), JSON.stringify(await snap(finance.botId), null, 2)); }
} finally {
	await saveEvidence();
	if (h && Number(values["inspect-ms"] ?? 0) > 0) {
		console.log("INSPECTION_PORT=" + (await readFile(join(h.dataDirectory, "electron/DevToolsActivePort"), "utf8")).split("\n")[0]);
		await pause(Math.min(Number(values["inspect-ms"]), 240_000));
	}
	await close();
}
