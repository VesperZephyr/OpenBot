import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider, fauxAssistantMessage, type FauxResponseStep } from "@earendil-works/pi-ai/providers/faux";
import { afterEach, expect, it } from "vitest";
import { BotRuntime, type StoredRun } from "../src/index.ts";
import { usageSummary } from "../src/usage.ts";
import { buildConfiguredProviders } from "../src/model-config.ts";

const dirs: string[] = [],
	runtimes: BotRuntime[] = [];
afterEach(async () => {
	for (const rt of runtimes.splice(0)) await rt.close();
	for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
const model = { provider: "faux", modelId: "faux-1" };
const usage = {
	input: 100,
	output: 30,
	cacheRead: 20,
	cacheWrite: 0,
	totalTokens: 150,
	reasoning: 10,
	cost: { input: 0.1, output: 0.2, cacheRead: 0.05, cacheWrite: 0, total: 0.35 },
};
const answer = (text = "Synthetic result") => ({ ...fauxAssistantMessage(text), usage: structuredClone(usage) });
async function open(databasePath?: string, responses: FauxResponseStep[] = [answer()], contextWindow = 128000) {
	if (!databasePath) {
		const dir = await mkdtemp(join(tmpdir(), "openbot-usage-"));
		dirs.push(dir);
		databasePath = join(dir, "data.sqlite");
	}
	const faux = fauxProvider({ models: [{ id: "faux-1", contextWindow, cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0 } }] });
	faux.setResponses(responses);
	const measured: number[] = [];
	const models = createModels();
	models.setProvider({
		...faux.provider,
		streamSimple: (model, context, options) => {
			const stream = faux.provider.streamSimple(model, context, options);
			void stream.result().then((message) => measured.push(message.usage.totalTokens));
			return stream;
		},
	});
	const rt = await BotRuntime.open({ databasePath, models });
	runtimes.push(rt);
	return { rt, databasePath, measured };
}
const run = (id: string, state: StoredRun["state"], extra: Partial<StoredRun> = {}): StoredRun => ({
	runId: id,
	botId: "scout",
	state,
	requestIds: [id],
	createdAt: 1,
	messages: [{ requestId: id, text: "secret task" }],
	inputs: [{ requestId: id, text: "secret task" }],
	...extra,
});
async function begin(rt: BotRuntime, id: string, extra: Partial<StoredRun> = {}) {
	await rt.runsStore().put(run(id, "queued", extra));
	await rt.runsStore().put(run(id, "running", extra));
}
async function finish(rt: BotRuntime, id: string, extra: Partial<StoredRun> = {}) {
	await rt.runsStore().put(run(id, "completed", extra));
}

it("freezes one settled interval, keeps totals across restart/replay/new topic and excludes task contents", async () => {
	const { rt, databasePath } = await open();
	await rt.createBot({ botId: "scout", name: "Scout", model, createdAt: 0 });
	rt.resume();
	await begin(rt, "r1");
	await rt.submitAndWait("scout", "r1", "secret task");
	await finish(rt, "r1");
	const one = await rt.usage("scout");
	expect(one.total.totalTokens).toBeGreaterThan(0);
	expect(one.total.estimatedUsd).toBe(0);
	expect(one.runs[0]?.usage.totalTokens).toBe(one.total.totalTokens);
	expect(one.runs[0]?.references[0]?.kind).toBe("result");
	expect(JSON.stringify(one)).not.toMatch(/secret task|Synthetic result|baseUrl|apiKey/);
	await finish(rt, "r1");
	expect(await rt.usage("scout")).toEqual(one);
	await rt.close();
	runtimes.splice(runtimes.indexOf(rt), 1);
	const second = (await open(databasePath)).rt;
	expect(await second.usage("scout")).toEqual(one);
	second.resume();
	await second.reset("scout");
	await begin(second, "r2", { createdAt: 2 });
	await second.submitAndWait("scout", "r2", "Next");
	await finish(second, "r2", { createdAt: 2 });
	const next = await second.usage("scout");
	expect(next.total.totalTokens).toBe(one.total.totalTokens + next.runs[0]!.usage.totalTokens);
	expect(next.total.estimatedUsd).toBe(0);
});

it("preserves a pending baseline across Host loss, without claiming a price across pricing epochs", async () => {
	const { rt, databasePath } = await open();
	await rt.createBot({ botId: "scout", name: "Scout", model, createdAt: 0 });
	rt.resume();
	await begin(rt, "r");
	await rt.submitAndWait("scout", "r", "Hello");
	const measured = (await rt.usage("scout")).total.totalTokens;
	await rt.close();
	runtimes.splice(runtimes.indexOf(rt), 1);
	const second = (await open(databasePath, [])).rt;
	await second.runsStore().put(run("r", "running"));
	await finish(second, "r");
	const result = await second.usage("scout");
	expect(result.total.totalTokens).toBe(measured);
	expect(result.runs[0]?.usage.totalTokens).toBe(measured);
	expect(result.runs[0]?.usage.estimatedUsd).toBeUndefined();
});

it("keeps legacy intervals unavailable and isolates Bot/channel ledgers", async () => {
	const { rt } = await open(undefined, [answer(), answer(), answer()]);
	await rt.createBot({ botId: "scout", name: "Scout", model, createdAt: 0 });
	await rt.createBot({ botId: "other", name: "Other", model, createdAt: 0 });
	rt.resume();
	await rt.submitAndWait("scout", "legacy", "Old history");
	await finish(rt, "legacy");
	const legacy = (await rt.usage("scout")).total.totalTokens;
	await rt.ensureChannel("scout", "group_usage");
	await begin(rt, "group", { channelId: "group_usage", createdAt: 2 });
	await rt.submitAndWait("scout", "group", "Group task", "group_usage");
	await finish(rt, "group", { channelId: "group_usage", createdAt: 2 });
	await rt.submitAndWait("other", "other", "Other task");
	const result = await rt.usage("scout");
	expect(result.total.totalTokens).toBe(legacy + result.runs[0]!.usage.totalTokens);
	expect(result.total.estimatedUsd).toBeUndefined();
	expect(result.runs.find((r) => r.runId === "legacy")?.usage.available).toBe(false);
	expect(result.runs[0]?.usage.totalTokens).toBeGreaterThan(0);
	expect(result.runs[0]?.conversationKey).toBe("group:group_usage");
	expect(result.runs[0]?.references).toEqual([]);
	expect((await rt.usage("other")).total.totalTokens).toBeGreaterThan(0);
	await expect(rt.usage("missing")).rejects.toThrow();
	await expect(rt.usage("scout", 51)).rejects.toThrow();
	await rt.updateBot("other", { status: "deleted" });
	await expect(rt.usage("other")).rejects.toThrow();
});

it("does not reprice a changed active model and retains accounted totals after detail pruning", async () => {
	const { rt } = await open(undefined, [answer(), answer()]);
	await rt.createBot({ botId: "scout", name: "Scout", model, createdAt: 0 });
	rt.resume();
	await begin(rt, "priced");
	await rt.submitAndWait("scout", "priced", "first");
	await finish(rt, "priced");
	const priced = (await rt.usage("scout")).total;
	for (let i = 0; i < 51; i++) await finish(rt, `empty${i}`, { createdAt: i + 2 });
	expect((await rt.usage("scout")).total).toEqual(priced);
	await begin(rt, "changed", { createdAt: 99 });
	await rt.submitAndWait("scout", "changed", "second");
	await rt.setDefaultModel(model);
	await finish(rt, "changed", { createdAt: 99 });
	expect((await rt.usage("scout")).runs[0]?.usage.estimatedUsd).toBeUndefined();
	expect((await rt.usage("scout")).total.totalTokens).toBeGreaterThan(priced.totalTokens);
});

it("bounds the model projection without adding reasoning twice", () => {
	const models = { "faux/faux-1": usage };
	const summary = usageSummary(models, {}, { modelKey: "faux/faux-1", source: "builtin", priced: true, epoch: "a" }, "a");
	expect(summary.totalTokens).toBe(150);
	expect(summary.output).toBe(30);
	expect(summary.reasoning).toBe(10);
	expect(usageSummary(models, models).available).toBe(false);
	const many = Object.fromEntries(Array.from({ length: 105 }, (_, i) => [`m/${i}`, usage]));
	const all = usageSummary(many);
	expect(all.models).toHaveLength(100);
	expect(all.totalTokens).toBe(15750);
	expect(all.truncated).toBe(true);
});

it("requires explicit full gateway rates, including an explicit zero-price schedule", () => {
	const build = (cost?: object, override?: object) =>
		buildConfiguredProviders(
			JSON.stringify({
				providers: {
					gw: {
						api: "openai-completions",
						baseUrl: "https://example.invalid",
						models: [{ id: "m", ...(cost ? { cost } : {}) }],
						...(override ? { modelOverrides: { m: { cost: override } } } : {}),
					},
				},
			}),
			{ environment: { env: () => undefined, run: async () => "" }, builtins: new Map() },
		);
	expect(build().pricing?.["gw/m"]).toBe(false);
	expect(build(undefined, { input: 1 }).pricing?.["gw/m"]).toBe(false);
	expect(build({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }).pricing?.["gw/m"]).toBe(true);
	expect(build({ input: -1, output: 0, cacheRead: 0, cacheWrite: 0 }).pricing?.["gw/m"]).toBe(false);
});

it("accounts actual Pi compaction requests and settled task intervals exactly once", async () => {
	let compacted = 0;
	const respond: FauxResponseStep = (context) => {
		const first = context.messages[0];
		if (first?.role === "system" && typeof first.content === "string" && first.content.includes("summar")) {
			compacted++;
			return fauxAssistantMessage("Summary of earlier work.");
		}
		return fauxAssistantMessage("Answer. " + "word ".repeat(4000));
	};
	const { rt, measured } = await open(
		undefined,
		Array.from({ length: 16 }, () => respond),
		40000,
	);
	await rt.createBot({ botId: "scout", name: "Scout", model, createdAt: 0 });
	rt.resume();
	for (let i = 0; i < 8; i++) {
		const id = `compact${i}`;
		await begin(rt, id, { createdAt: i });
		await rt.submitAndWait("scout", id, `Question ${i}`);
		await finish(rt, id, { createdAt: i });
	}
	expect(compacted).toBeGreaterThan(0);
	const data = await rt.usage("scout");
	expect(data.total.totalTokens).toBe(measured.reduce((sum, n) => sum + n, 0));
	expect(data.runs.reduce((sum, r) => sum + r.usage.totalTokens, 0)).toBe(data.total.totalTokens);
});

it("settles interrupted usage only after cancellation drains, and keeps a continuation separate", async () => {
	const { rt, databasePath } = await open(undefined, [answer(), answer(), answer()]);
	await rt.createBot({ botId: "scout", name: "Scout", model, createdAt: 0 });
	rt.resume();
	await begin(rt, "interrupted");
	await rt.submitAndWait("scout", "before-stop", "First committed response");
	const before = (await rt.usage("scout")).total.totalTokens;
	const intent = run("interrupted", "needs_attention", { interruption: { reason: "user", requestedAt: 2 } });
	await rt.runsStore().put(intent);
	// A provider may finish committing its usage after interruption intent, before Pi's drain completes.
	await rt.submitAndWait("scout", "late-stop", "Late committed response");
	const drained = (await rt.usage("scout")).runs[0]!.usage.totalTokens;
	expect(drained).toBeGreaterThan(before);
	const settled = { ...intent, interruption: { ...intent.interruption!, settledAt: 3 } };
	await rt.runsStore().put(settled);
	const frozen = (await rt.usage("scout")).runs[0]!.usage;
	expect(frozen.totalTokens).toBe(drained);
	await rt.runsStore().put(settled);
	await begin(rt, "continuation", { createdAt: 4 });
	await rt.submitAndWait("scout", "continuation", "Explicit continuation");
	await finish(rt, "continuation", { createdAt: 4 });
	await rt.runsStore().put(settled);
	const result = await rt.usage("scout");
	expect(result.runs.find((r) => r.runId === "interrupted")!.usage).toEqual(frozen);
	expect(result.total.totalTokens).toBe(drained + result.runs[0]!.usage.totalTokens);
	expect(result.total.estimatedUsd).toBe(0);
	await rt.close();
	runtimes.splice(runtimes.indexOf(rt), 1);
	expect(await (await open(databasePath, [])).rt.usage("scout")).toEqual(result);
});

it("preserves estimates across unchanged configuration reads and invalidates a changed configuration", async () => {
	const { rt } = await open(undefined, [answer(), answer()]);
	const environment = { env: () => undefined, run: async () => "" };
	rt.reloadConfiguredProviders(undefined, environment);
	await rt.createBot({ botId: "scout", name: "Scout", model, createdAt: 0 });
	rt.resume();
	await begin(rt, "same");
	await rt.submitAndWait("scout", "same", "Same configuration");
	rt.reloadConfiguredProviders(undefined, environment);
	await finish(rt, "same");
	expect((await rt.usage("scout")).runs[0]!.usage.estimatedUsd).toBe(0);
	await begin(rt, "changed-config", { createdAt: 2 });
	await rt.submitAndWait("scout", "changed-config", "Changed configuration");
	rt.reloadConfiguredProviders('{"providers":{}}', environment);
	await finish(rt, "changed-config", { createdAt: 2 });
	expect((await rt.usage("scout")).runs[0]!.usage.estimatedUsd).toBeUndefined();
});
