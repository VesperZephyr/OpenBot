/** Opt-in real-provider acceptance. Run only with --run and explicit provider/model; isolated Bots produce ignored local evidence. */
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

const { values } = parseArgs({
	options: {
		run: { type: "boolean" },
		provider: { type: "string" },
		model: { type: "string" },
		config: { type: "string" },
		name: { type: "string" },
		"inspect-ms": { type: "string" },
		"max-output-tokens": { type: "string" },
	},
});
if (!values.run || !values.provider || !values.model) {
	console.log(
		"Usage: node scripts/acceptance/unattended-reliability.mts --run --provider <configured-provider> --model <configured-model> [--config <models.json>] [--name <evidence-directory>] [--inspect-ms 180000]. Runs two bounded live-source group reports and their summary; maximum 8 upstream requests, 2048 output tokens per request.",
	);
	process.exit(0);
}
const name = values.name ?? `unattended-real-${Date.now()}`;
assert.match(name, /^[a-z0-9-]+$/);
const require = createRequire(join(repo, "packages/server-core/package.json"));
const config = require("jsonc-parser").parse(await readFile(resolve(values.config ?? join(homedir(), ".openbot/models.json")), "utf8"));
const provider = config.providers?.[values.provider];
assert(
	provider?.models?.some((model: any) => model.id === values.model),
	"The selected model must exist in the supplied configuration",
);
const selectedModel = provider.models.find((model: any) => model.id === values.model);
const apiKind = selectedModel.api ?? provider.api;
const proxyPrefix = apiKind === "anthropic-messages" ? "" : "/v1";
const outputLimit = Number(values["max-output-tokens"] ?? 2048);
assert(Number.isInteger(outputLimit) && outputLimit >= 1024 && outputLimit <= 2048);
selectedModel.maxTokens = outputLimit;
assert(selectedModel.baseUrl ?? provider.baseUrl, "This acceptance runner requires an explicit configured upstream URL");
const upstreamBase = new URL(selectedModel.baseUrl ?? provider.baseUrl);
assert.equal(upstreamBase.protocol, "https:");
const inputRequests: any[] = [];
const credentialInput = provider.apiKey;
assert(typeof credentialInput === "string" && credentialInput.length, "A configured key or key helper is required");
const { modelConfigFile } = await import("../../apps/local-server/src/model-config-file.ts");
const environment = modelConfigFile("unused", process.env).environment;
const credential = credentialInput.startsWith("!")
	? await environment.run(credentialInput.slice(1))
	: credentialInput.startsWith("$")
		? environment.env(credentialInput.slice(1))
		: credentialInput;
assert(credential, "Configured credential is unavailable");
provider.apiKey = "acceptance-proxy";
const responses: any[] = [];
// Forward only to the selected configured origin. Credentials remain in transient headers, never evidence.
const proxy = createServer(async (request, response) => {
	try {
		assert.equal(request.method, "POST");
		assert(["/v1/responses", "/v1/chat/completions", "/v1/messages"].includes(new URL(request.url ?? "/", "http://localhost").pathname));
		const chunks: Buffer[] = [];
		let size = 0;
		for await (const chunk of request) {
			size += chunk.length;
			assert(size < 8 * 1024 * 1024);
			chunks.push(chunk);
		}
		const body = Buffer.concat(chunks);
		const parsed = JSON.parse(body.toString());
		assert.equal(parsed.model, values.model);
		if (inputRequests.length >= 8) {
			response.writeHead(400);
			response.end("Acceptance inference budget reached");
			return;
		}
		inputRequests.push(parsed);
		const headers: Record<string, string> = { "content-type": "application/json" };
		for (const key of ["authorization", "x-api-key", "anthropic-version", "anthropic-beta"])
			if (typeof request.headers[key] === "string") headers[key] = request.headers[key];
		if (apiKind === "anthropic-messages") headers["x-api-key"] = credential;
		else headers.authorization = `Bearer ${credential}`;
		const requestIndex = inputRequests.length - 1,
			begin = Date.now();
		const controller = new AbortController();
		response.on("close", () => controller.abort());
		const result = await fetch(upstreamBase.href.replace(/\/$/, "") + request.url!.slice(proxyPrefix.length), {
			method: "POST",
			headers,
			body,
			signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]),
		});
		responses.push({ requestIndex, status: result.status, elapsedMs: Date.now() - begin });
		response.writeHead(result.status, { "content-type": result.headers.get("content-type") ?? "application/json" });
		if (result.body)
			Readable.fromWeb(result.body as any)
				.on("error", () => response.destroy())
				.pipe(response);
		else response.end();
	} catch (error) {
		responses.push({
			phase: "proxy",
			path: new URL(request.url ?? "/", "http://localhost").pathname,
			error: error instanceof Error ? error.name : "Error",
		});
		if (!response.headersSent) response.writeHead(502);
		response.end("Acceptance proxy failed");
	}
});
await new Promise<void>((done) => proxy.listen(0, "127.0.0.1", done));
provider.baseUrl = `http://127.0.0.1:${(proxy.address() as any).port}${proxyPrefix}`;
selectedModel.baseUrl = provider.baseUrl;
const isolatedConfig = { providers: { [values.provider]: { ...provider, models: [selectedModel] } } };
let h: AppHarness | undefined;
const api = (method: string, params: any = {}): Promise<any> =>
	h!.page().evaluate(({ method, params }) => (window as any).openbot.methods[method](params), { method, params });

const { BotRuntime } = await import("../../packages/agent-runtime/src/index.ts");
const { scriptedModels } = await import("../../packages/agent-runtime/src/testing.ts");
const groupId = "group_reliable_acceptance";
const sources = [
	{ name: "Domestic Hunter", url: "https://www.codebuddy.cn/docs/workbuddy/Changelog" },
	{ name: "International Hunter", url: "https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md" },
];
const results: any[] = [];
let passed = false;
try {
	h = await launchApp(name, {
		debugPort: 9347,
		env: { OPENBOT_MAX_ACTIVE_RUNS: "1" },
		prepare: async (root) => {
			await writeFile(join(root, "home/models.json"), JSON.stringify(isolatedConfig), { mode: 0o600 });
			return {};
		},
	});
	assert.deepEqual((await api("settings.get")).modelConfig.errors, [], "Invalid acceptance model configuration");
	await api("settings.update", { defaultModel: { provider: values.provider, modelId: values.model } });
	const core = (await api("bots.list")).find((b: any) => b.kind === "core");
	const bots = [];
	for (const [i, source] of sources.entries())
		bots.push(
			await api("bots.create", {
				requestId: `bot-${i}`,
				name: source.name,
				instructions: "Use only the requested official source. Do not use commands, change settings or contact anyone.",
			}),
		);
	const groupFields = {
		name: "Reliability radar",
		objective: "Bounded real-source acceptance",
		memberIds: [core.botId, ...bots.map((b) => b.botId)],
		leadBotId: core.botId,
	};
	await api("groups.change", { action: "create", requestId: "group", groupId, expectedRevision: 0, fields: groupFields });
	const base = { schedule: { kind: "interval", minutes: 60 }, catchUpHours: 24, skills: [], reportTo: { groupId, groupRevision: 1 } };
	const routines = [];
	for (const [i, source] of sources.entries())
		routines.push(
			await api("routines.change", {
				action: "create",
				requestId: `routine-${i}`,
				botId: bots[i].botId,
				fields: {
					...base,
					name: source.name,
					instructions: `This is a bounded acceptance report, not a complete daily scan. Use web_fetch exactly once to read ${source.url}, with max_chars 6000. Give a concise Chinese report with latest visible version, up to two changes and this exact source link. Distinguish latest listed from released today; report unavailable or unknown dates honestly. Do not use any other tool, write files or contact anyone.`,
				},
			}),
		);
	const summary = await api("routines.change", {
		action: "create",
		requestId: "summary",
		botId: core.botId,
		fields: {
			...base,
			name: "Daily comparison",
			instructions:
				"Use only the Host-confirmed source reports. Do not call tools. In Chinese, summarize both reports briefly, retain each primary source URL, and state any unknown release dates. This is acceptance evidence, not proof of complete daily coverage.",
			reportInputs: { sources: routines.map((r) => ({ routineId: r.routineId, revision: 1 })), windowHours: 24, waitMinutes: 5 },
		},
	});
	const broken = await api("routines.change", {
		action: "create",
		requestId: "broken",
		botId: bots[0].botId,
		fields: { ...base, name: "Fault isolation probe", instructions: "Never admitted" },
	});
	await h.relaunch(async () => {
		const runtime = await BotRuntime.open({ databasePath: join(h!.dataDirectory, "openbot.sqlite"), models: scriptedModels().models });
		try {
			await runtime.routines().change((state) => {
				const due = Date.now() + 7000;
				for (const r of Object.values(state.routines)) state.routines[r.routineId] = { ...r, anchor: due - 3600000, nextAt: due };
				state.routines[broken.routineId] = {
					...state.routines[broken.routineId]!,
					schedule: { kind: "daily", time: "07:00", timezone: "Invalid/Zone" },
				};
			});
		} finally {
			await runtime.close();
		}
	});
	await h.app().evaluate(({ powerMonitor }) => powerMonitor.emit("lock-screen"));
	const deadline = Date.now() + 300000;
	while (!inputRequests.length) {
		assert(Date.now() < deadline, "No scheduled admission");
		assert.equal((await api("groups.snapshot", { groupId })).posts.length, 0, "Scheduled run failed before requesting the model");
		await new Promise((r) => setTimeout(r, 250));
	}
	// Rename while an actual provider request is in progress.
	await api("groups.change", {
		action: "update",
		requestId: "rename-group",
		groupId,
		expectedRevision: 1,
		fields: { ...groupFields, name: "Reliability radar renamed" },
	});
	const original = routines[0];
	const { name: _name, instructions, schedule, catchUpHours, skills, reportTo } = original;
	await api("routines.change", {
		action: "update",
		requestId: "rename-source",
		routineId: original.routineId,
		expectedRevision: 1,
		fields: { name: "Domestic Hunter renamed", instructions, schedule, catchUpHours, skills, reportTo },
	});
	for (;;) {
		const snapshot = await api("groups.snapshot", { groupId });
		if (snapshot.posts.length === 3) {
			results.push(...snapshot.posts);
			break;
		}
		assert(Date.now() < deadline, "Scheduled chain deadline exceeded");
		for (const routine of [...routines, summary]) {
			const detail = await api("routines.get", { routineId: routine.routineId });
			if (detail.snapshot?.approvals?.length) {
				for (const approval of detail.snapshot.approvals)
					await api("approvals.decide", { approvalId: approval.approvalId, decision: "deny" });
				throw Error("Unexpected approval denied");
			}
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	assert(results.every((p) => p.routine?.state === "completed" && !p.routine.test));
	assert.deepEqual(results.find((p) => p.routine.routineId === summary.routineId).routine.inputs, { ready: 2, total: 2 });
	for (const [i, source] of sources.entries()) {
		const detail = await api("routines.get", {
			routineId: routines[i].routineId,
			occurrenceId: results.find((p) => p.routine.routineId === routines[i].routineId).routine.occurrenceId,
		});
		assert(detail.snapshot.items.some((item: any) => item.tool === "web_fetch" && item.status === "succeeded"));
		assert(results.find((p) => p.routine.routineId === routines[i].routineId).text.includes(source.url));
	}
	assert.equal((await api("lifecycle.get")).blocked, false);
	assert((await api("routines.list")).scheduler.faults.some((f: any) => f.routineId === broken.routineId));
	await h.page().locator(".group-nav").filter({ hasText: "Reliability radar renamed" }).click();
	await h.page().locator(".routine-report-label").first().waitFor();
	await h.shot("real-scheduled-chain");
	console.log(
		JSON.stringify({ stage: "reports", reports: 3, inputs: "2/2", requests: inputRequests.length, locked: true, renamedDuringRun: true }),
	);
	await h.app().evaluate(({ powerMonitor }) => powerMonitor.emit("unlock-screen"));
	await h.app().evaluate(({ powerMonitor }) => powerMonitor.emit("suspend"));
	while ((await api("lifecycle.get")).transitioning) await new Promise((r) => setTimeout(r, 100));
	await h.app().evaluate(({ powerMonitor }) => powerMonitor.emit("resume"));
	while ((await api("lifecycle.get")).blocked) {
		assert(Date.now() < deadline);
		await new Promise((r) => setTimeout(r, 100));
	}
	const requestsBefore = inputRequests.length;
	const current = (await api("routines.get", { routineId: broken.routineId })).routine;
	await api("routines.change", {
		action: "update",
		requestId: "repair",
		routineId: broken.routineId,
		expectedRevision: current.revision,
		fields: { ...base, schedule: { kind: "interval", minutes: 120 }, name: "Repaired probe", instructions: "Not due during acceptance" },
	});
	const recoveryDeadline = Date.now() + 65000;
	while ((await api("routines.list")).scheduler.faults.length) {
		assert(Date.now() < recoveryDeadline);
		await new Promise((r) => setTimeout(r, 500));
	}
	await h.relaunch();
	assert.deepEqual((await api("groups.snapshot", { groupId })).posts, results);
	assert.equal(inputRequests.length, requestsBefore);
	await h.page().locator(".group-nav").filter({ hasText: "Reliability radar renamed" }).click();
	await h.shot("real-restarted-chain");
	await writeFile(join(h.run, "reports.json"), JSON.stringify(results, null, 2));
	passed = true;
	console.log(
		JSON.stringify({
			result: "passed",
			requests: inputRequests.length,
			reports: 3,
			inputs: "2/2",
			wake: "automatic",
			restart: "no duplicates",
			fault: "recovered",
		}),
	);
	if (values["inspect-ms"]) await new Promise((r) => setTimeout(r, Math.min(300000, Number(values["inspect-ms"]))));
} finally {
	if (h) {
		await writeFile(
			join(h.run, "evidence.json"),
			JSON.stringify({ passed, model: values.model, requests: inputRequests.length, responses, results }, null, 2),
		);
		try {
			await h.close();
		} finally {
			await rm(join(h.run, "home/models.json"), { force: true });
		}
	}
	proxy.closeAllConnections();
	await new Promise<void>((r) => proxy.close(() => r()));
}
