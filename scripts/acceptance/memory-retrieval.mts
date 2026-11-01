/** Opt-in B27c product comparison. All state and provider evidence stay in the ignored isolated app directory. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import { launchApp, repo, type AppHarness } from "../../e2e/harness.ts";
import { BotRuntime } from "../../packages/agent-runtime/src/index.ts";
import { scriptedModels } from "../../packages/agent-runtime/src/testing.ts";
import { notes, render, tasks } from "../../docs/research/fixtures/b27c-retrieval.mjs";

const { values } = parseArgs({ options: { run: { type: "boolean" }, provider: { type: "string" }, model: { type: "string" }, config: { type: "string" }, name: { type: "string" } } });
if (!values.run || !values.provider || !values.model) {
 console.log("node scripts/acceptance/memory-retrieval.mts --run --provider <configured-provider> --model <configured-model> [--config <models.json>] [--name <evidence-directory>]"); process.exit(0);
}
const name = values.name ?? `memory-retrieval-real-${Date.now()}`;
assert.match(name, /^[a-z0-9-]+$/);
const require = createRequire(join(repo, "packages/server-core/package.json"));
const config = require("jsonc-parser").parse(await readFile(resolve(values.config ?? join(homedir(), ".openbot/models.json")), "utf8"));
const provider = config.providers?.[values.provider], model = provider?.models?.find((m: any) => m.id === values.model);
assert(model && (model.api ?? provider.api) === "anthropic-messages", "This bounded comparison supports configured anthropic-messages models");
assert(!Object.keys(provider.headers ?? {}).length && !Object.keys(model.headers ?? {}).length, "Custom headers need runner review");
const upstream = new URL(model.baseUrl ?? provider.baseUrl); assert.equal(upstream.protocol, "https:");
model.maxTokens = 768;
const evaluation = [...tasks,
 { id: "holdout-review-en", kind: "recall", prompt: "When is the owner review for Project A-17?", expected: /21.*November|November.*21|11月21/ },
 { id: "holdout-delivery-zh", kind: "recall", prompt: "按记忆我们现在把货物送到哪一个仓库？", expected: /Maple/ },
];
const requests: any[] = [], rows: any[] = [];
let h: AppHarness | undefined, phase = "setup", trial: { id: string; first: number; sensitivity: boolean } | undefined;
let transportFailed = false, mainRequests = 0, sensitivityRequests = 0;
const pause = (ms: number) => new Promise(done => setTimeout(done, ms));
const proxy = createServer(async (request, response) => {
 let record: any;
 try {
  assert(!transportFailed && trial, "No retry after a failed transport or outside a trial");
  assert.equal(request.method, "POST"); assert.equal(new URL(request.url!, "http://localhost").pathname, "/v1/messages");
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of request) { bytes += chunk.length; assert(bytes <= 8 * 1024 * 1024); chunks.push(chunk); }
  const body = Buffer.concat(chunks), input = JSON.parse(body.toString());
  assert.equal(input.model, values.model); assert(input.max_tokens <= 768);
  assert(requests.length - trial.first < 4, "At most three retrieval rounds per trial");
  assert(trial.sensitivity ? ++sensitivityRequests <= 10 : ++mainRequests <= 70, "Provider request budget exhausted");
  record = { trial: trial.id, input, started: Date.now(), usage: {}, events: [] }; requests.push(record);
  const headers: Record<string, string> = { "content-type": "application/json" };
  for (const key of ["authorization", "x-api-key", "anthropic-version", "anthropic-beta"]) if (typeof request.headers[key] === "string") headers[key] = request.headers[key];
  const abort = new AbortController(); response.on("close", () => abort.abort());
  const result = await fetch(upstream.href.replace(/\/$/, "") + request.url, { method: "POST", redirect: "error", headers, body, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(60_000)]) });
  record.status = result.status; assert(result.ok && result.body, "Provider returned an error; no retry");
  response.writeHead(result.status, { "content-type": result.headers.get("content-type") ?? "text/event-stream" });
  let pending = ""; const decoder = new TextDecoder();
  for await (const chunk of result.body as any) {
   response.write(chunk); pending += decoder.decode(chunk, { stream: true });
   const lines = pending.split("\n"); pending = lines.pop()!;
   for (const line of lines) if (line.startsWith("data: ")) {
    const event = JSON.parse(line.slice(6)); record.events.push(event);
    Object.assign(record.usage, event.message?.usage ?? event.usage ?? {});
    if (event.type === "error") transportFailed = true;
   }
  }
  record.elapsedMs = Date.now() - record.started; response.end();
 } catch (error) {
  console.error(JSON.stringify({phase, preflight: !record, failure: error instanceof assert.AssertionError ? error.message : "Transport failed"}));
  transportFailed = true;
  if (record) record.failure = "Provider/transport/budget failure; no retry";
  if (!response.headersSent) response.writeHead(400); response.end("Bounded acceptance stopped; no retry");
 }
});
await new Promise<void>(done => proxy.listen(0, "127.0.0.1", done));
provider.baseUrl = `http://127.0.0.1:${(proxy.address() as any).port}`; model.baseUrl = provider.baseUrl;
const api = (method: string, params: object = {}) => h!.api(method, params);
async function save() {
 if (!h) return;
 await writeFile(join(h.run, "product-comparison.json"), JSON.stringify({ candidate: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(), workingDiff: execFileSync("git", ["diff", "--stat"], { cwd: repo, encoding: "utf8" }).trim(), provider: values.provider, model: values.model, limits: { main: 70, sensitivity: 10, outputPerRequest: 768, retrievalRounds: 3, retries: 0 }, phase, transportFailed, mainRequests, sensitivityRequests, rows, requests }, null, 2), { mode: 0o600 });
}
async function placement(botId: string, arm: string) {
 for (const scope of ["bot", "shared"] as const) {
  let memory = await api(scope === "bot" ? "bots.memory.get" : "memory.shared.get", scope === "bot" ? { botId } : {});
  for (const note of memory.notes.filter((n: any) => n.status === "active")) {
   const expected = notes.find((n: any) => n.scope === scope && n.heading === note.heading)!;
   const value = arm === "selective" ? expected.placement : "always";
   if ((note.placement ?? "always") === value) continue;
   const result = await api("bots.memory.note", { botId, scope, noteId: note.id, action: "placement", placement: value, expectedRevision: memory.revision, requestId: `${phase}-${scope}-${note.id}-${value}` });
   memory = result[scope === "bot" ? "local" : "shared"];
  }
 }
}
async function run(task: any, arm: string, sensitivity = false, warm = false) {
 const botId = sensitivity ? "sensitivity" : "fixture";
 phase = `${sensitivity ? "sensitivity-" : warm ? "warm-" : ""}${task.id}-${arm}`;
 await placement(botId, arm);
 if (!warm) await api("conversations.reset", { botId });
 trial = { id: phase, first: requests.length, sensitivity };
 const begin = Date.now(); console.log(JSON.stringify({ phase, state: "started" }));
 await api("messages.submit", { botId, requestId: phase, text: task.prompt });
 let snapshot: any;
 const deadline = Date.now() + 240_000;
 do {
  snapshot = await api("conversations.snapshot", { botId });
  if (snapshot.approvals.length) {
   for (const approval of snapshot.approvals) await api("approvals.decide", { approvalId: approval.approvalId, decision: "deny" });
   throw Error("Unexpected approval proposal");
  }
  if (transportFailed || (!snapshot.run && snapshot.items.some((i: any) => i.kind === "assistant" || i.error))) break;
  await pause(100);
 } while (Date.now() < deadline);
 if (snapshot.run) { await api("runs.cancel", { runId: snapshot.run.runId }); throw Error("Trial timed out"); }
 const generated = snapshot.items.filter((i: any) => i.kind === "assistant").at(-1);
 const answer = generated?.parts?.filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n") ?? "";
 const inputs = requests.slice(trial.first), calls = inputs.flatMap(r => r.events.filter((e: any) => e.type === "content_block_start" && e.content_block.type === "tool_use").map((e: any) => e.content_block.name));
 const tokens = inputs.reduce((sum, r) => ({ input: sum.input + (r.usage.input_tokens ?? 0) + (r.usage.cache_read_input_tokens ?? 0) + (r.usage.cache_creation_input_tokens ?? 0), output: sum.output + (r.usage.output_tokens ?? 0), cacheRead: sum.cacheRead + (r.usage.cache_read_input_tokens ?? 0), cacheWrite: sum.cacheWrite + (r.usage.cache_creation_input_tokens ?? 0) }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
 const row = { task: task.id, kind: task.kind, arm, sensitivity, warm, answer, automaticPass: !generated?.error && task.expected.test(answer) && (!task.forbidden || !task.forbidden.test(answer)), error: generated?.error, calls, requests: inputs.length, tokens, elapsedMs: Date.now() - begin };
 rows.push(row); await save(); console.log(JSON.stringify(row));
 assert(!transportFailed && !generated?.error, "Trial failed; no provider retry");
 trial = undefined;
}
try {
 h = await launchApp(name, { prepare: async root => {
  await writeFile(join(root, "home/models.json"), JSON.stringify(config), { mode: 0o600 });
  await mkdir(join(root, "data"), { recursive: true });
  const runtime = await BotRuntime.open({ databasePath: join(root, "data/openbot.sqlite"), models: scriptedModels().models });
  try {
   for (const botId of ["fixture", "sensitivity"]) {
    await runtime.createBot({ botId, name: botId, model: { provider: values.provider!, modelId: values.model! }, createdAt: 1 });
    const local = notes.filter((n: any) => n.scope === "bot" && n.status === "active");
    if (botId === "fixture") await runtime.setMemory(botId, render(local), 0);
    else {
     const call = { runId: "synthetic-learning", conversationId: await runtime.conversationKey(botId) };
     const run = { runId: call.runId, botId, state: "running" as const, origin: "user" as const, requestIds: ["synthetic-source"], createdAt: 1, messages: [{ requestId: "synthetic-source", text: "Synthetic fixture learning" }], inputs: [{ requestId: "synthetic-source", text: "Synthetic fixture learning" }] };
     await runtime.runsStore().put(run);
     for (const [i, n] of local.entries()) await runtime.editMemory(botId, { action: "replace", section: n.heading, content: n.content, expectedRevision: i }, `learn-${i}`, call);
     await runtime.runsStore().put({ ...run, state: "completed" });
     assert((await runtime.memoryState(botId)).notes.every(n => n.original.kind === "model" && !n.protected));
    }
   }
   await runtime.setSharedMemory(render(notes.filter((n: any) => n.scope === "shared" && n.status === "active")) + "\n\n## Retired project\nRetired", 0);
   const shared = await runtime.sharedMemory();
   await runtime.changeMemoryNote({ botId: "fixture", scope: "shared", action: "forget", noteId: shared.notes.find(n => n.heading === "Retired project")!.id, expectedRevision: shared.revision, requestId: "forget-retired" });
  } finally { await runtime.close(); }
  return {};
 } });
 await api("settings.update", { defaultModel: { provider: values.provider, modelId: values.model } });
 for (const [i, task] of evaluation.entries()) {
  for (const arm of i % 2 ? ["selective", "all-loaded"] : ["all-loaded", "selective"]) {
   await run(task, arm);
   if (i === 0) await run(task, arm, false, true);
  }
 }
 for (const task of evaluation.filter(t => ["cross-zh", "paraphrase-zh"].includes(t.id))) for (const arm of ["all-loaded", "selective"]) await run(task, arm, true);
 phase = "finished-requires-manual-answer-review";
 await save();
 const failed = rows.filter(r => !r.automaticPass);
 const value = evaluation.filter(t => t.kind === "irrelevant").map(t => {
  const pair = rows.filter(r => r.task === t.id && !r.warm && !r.sensitivity), all = pair.find(r => r.arm === "all-loaded"), selective = pair.find(r => r.arm === "selective");
  return { task: t.id, saving: all.tokens.input - selective.tokens.input, passed: selective.calls.every((n: string) => !n.startsWith("memory_")) && selective.requests === 1 && all.requests === 1 && all.tokens.input - selective.tokens.input >= 1000 };
 });
 console.log(JSON.stringify({ preliminaryFailures: failed.map(r => `${r.task}/${r.arm}`), value }));
 if (failed.length || value.some(v => !v.passed)) process.exitCode = 1;
} catch (error) {
 phase = `stopped: ${error instanceof assert.AssertionError ? error.message : error instanceof Error ? error.message : "runner failure"}`;
 console.error(phase); process.exitCode = 1;
} finally {
 await save(); await h?.close();
 if (h) await rm(join(h.run, "home/models.json"), { force: true });
 proxy.closeAllConnections(); await new Promise<void>(done => proxy.close(() => done()));
}
