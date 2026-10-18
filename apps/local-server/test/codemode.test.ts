import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { BotRuntime } from "@openbot/agent-runtime";
import { scriptedModels, SCRIPTED_MODEL } from "@openbot/agent-runtime/testing";
import { TOOL_CATALOG } from "@openbot/protocol";
import { AppCapabilities } from "../../../packages/server-core/src/app-capabilities.ts";
import { ToolRouter, type ToolCall } from "@openbot/tool-router";
let runtime: BotRuntime | undefined, root: string;
afterEach(async () => {
	await runtime?.close();
	runtime = undefined;
	if (root) await rm(root, { recursive: true, force: true });
});
async function setup(code: string, block = false) {
	root = await mkdtemp(join(tmpdir(), "openbot-code-"));
	const model = scriptedModels({ tool: "codemode", args: { code } }, "Done");
	let app!: AppCapabilities;
	const seen: ToolCall[] = [];
	const router = new ToolRouter({
		target: { kind: "local", targetId: "mac" },
		policy: { decide: async (c) => app.authorize(c), grants: async () => ({ read: [], readwrite: [] }) },
		approvals: { request: async () => "deny" },
		executor: {
			invoke: async () => {
				throw Error("Unexpected executor");
			},
		},
		hostTools: Object.fromEntries(
			TOOL_CATALOG.filter((d) => d.capability === "app.read").map((d) => [
				d.name,
				async (_a: unknown, _s: unknown, c: ToolCall) => {
					seen.push(c);
					if (block && c.tool === "app_groups_list")
						await new Promise<void>((_resolve, reject) => {
							c.signal.addEventListener("abort", () => reject(c.signal.reason), { once: true });
							if (c.signal.aborted) reject(c.signal.reason);
						});
					return app.invokeTool(c);
				},
			]),
		),
	});
	const open = async () => {
		runtime = await BotRuntime.open({
			databasePath: join(root, "db"),
			models: model.models,
			tools: { definitions: TOOL_CATALOG, invoke: (c) => router.invoke(c), admitOrchestration: (c) => router.admitOrchestration(c) },
		});
		app = new AppCapabilities(runtime, "mac", async () => false);
	};
	await open();
	const core = (await runtime!.ensureCoreBot(1)).botId;
	await runtime!.setDefaultModel(SCRIPTED_MODEL);
	await runtime!
		.runsStore()
		.put({ runId: "run", botId: core, state: "running", origin: "user", requestIds: ["request"], messages: [], inputs: [], createdAt: 1 });
	return {
		core,
		seen,
		model,
		app,
		router,
		reopen: async () => {
			block = false;
			await open();
		},
		run: () => runtime!.submitAndWait(core, "request", "Inspect my application"),
	};
}
it("admits a parent without holding the leaf lock, routes two nested reads and retains only selected output", async () => {
	const h = await setup(
		"const [bots,groups]=await Promise.all([tools.app_bots_list({}),tools.app_groups_list({})]);text({bots:bots.value.items.length,groups:groups.value.items.length});",
	);
	await h.run();
	const item = (await runtime!.snapshot(h.core)).items.find((i) => i.kind === "tool");
	expect(item).toMatchObject({
		status: "succeeded",
		output: expect.stringContaining('{"bots":1,"groups":0}'),
		execution: { state: "succeeded", authority: { runId: "run" }, children: [{ state: "succeeded" }, { state: "succeeded" }] },
	});
	expect(h.seen).toHaveLength(2);
	expect(h.seen.every((c) => c.appExecutionId && c.runId === "run")).toBe(true);
	expect((await h.app.invokeTool({ ...h.seen[0]!, signal: new AbortController().signal })).status).toBe("failed");
	await runtime!.close();
	runtime = await BotRuntime.open({ databasePath: join(root, "db"), models: h.model.models });
	expect((await runtime.snapshot(h.core)).items.find((i) => i.kind === "tool")).toMatchObject({
		execution: { state: "succeeded", children: [{ state: "succeeded" }, { state: "succeeded" }] },
	});
}, 15000);
it("excludes management, recursion, Node and models from the actual sandbox catalog", async () => {
	const h = await setup("text([typeof process,typeof require,typeof fetch,typeof models,ALL_TOOLS.map(t=>t.name)]);");
	await h.run();
	const item = (await runtime!.snapshot(h.core)).items.find((i) => i.kind === "tool");
	expect(item).toMatchObject({ status: "succeeded" });
	expect(JSON.stringify(item)).toContain("undefined");
	expect(h.seen).toHaveLength(0);
}, 15000);
it("rejects wider source options and bounds bridge floods before Host allocation", async () => {
	const h = await setup('// @options: {"timeout_ms":60001}\ntext("unsafe");');
	await h.run();
	expect((await runtime!.snapshot(h.core)).items.find((i) => i.kind === "tool")).toMatchObject({ status: "failed" });
	expect(h.seen).toHaveLength(0);
	h.model.answer({ tool: "codemode", args: { code: "for(let i=0;i<100000;i++) {try {tools.app_bots_list({});}catch{}}" } }, "Done");
	await runtime!.submitAndWait(h.core, "flood", "Flood");
	expect(h.seen.length).toBeLessThanOrEqual(8);
	expect((await runtime!.snapshot(h.core)).items.filter((i) => i.kind === "tool").at(-1)).toMatchObject({
		status: "failed",
		execution: { state: "failed" },
	});
}, 15000);
it("stops an infinite VM and releases its physical worker", async () => {
	const h = await setup("while(true) {}");
	const pending = h.run();
	await vi.waitFor(async () =>
		expect((await runtime!.snapshot(h.core)).items.some((i) => i.kind === "tool" && i.execution?.state === "running")).toBe(true),
	);
	await runtime!.cancel(h.core);
	await pending;
	expect((await runtime!.snapshot(h.core)).items.find((i) => i.kind === "tool")).toMatchObject({ execution: { state: "cancelled" } });
}, 15000);

it("resumes with original parent, children and deadline; a replacement Run cannot authorize old work", async () => {
	const h = await setup("const b=await tools.app_bots_list({});await tools.app_groups_list({});text(b.value.items.length);", true);
	const observed: unknown[] = [];
	const stop = await runtime!.observe(h.core, (s) => observed.push(s));
	const pending = h.run().catch(() => undefined);
	await vi.waitFor(() => expect(h.seen.length).toBe(2));
	await vi.waitFor(() => expect(JSON.stringify(observed)).toContain("app_groups_list"));
	stop();
	const before = (await runtime!.snapshot(h.core)).items.find((i) => i.kind === "tool");
	if (before?.kind !== "tool") throw Error("Missing parent");
	await runtime!.close();
	runtime = undefined;
	await pending;
	await h.reopen();
	const old = (await runtime!.runsStore().get("run"))!;
	await runtime!.runsStore().put({ ...old, state: "completed" });
	await runtime!.runsStore().put({ ...old, runId: "replacement", requestIds: ["replacement"] });
	runtime!.resume();
	await vi.waitFor(async () => expect((await runtime!.snapshot(h.core)).items.find((i) => i.kind === "tool")?.status).toBe("failed"));
	const after = (await runtime!.snapshot(h.core)).items.find((i) => i.kind === "tool");
	expect(after).toMatchObject({
		execution: { executionId: before.execution!.executionId, deadline: before.execution!.deadline, authority: { runId: "run" } },
	});
	expect(h.seen.filter((c) => c.tool === "app_bots_list")).toHaveLength(1);
	expect(h.seen.every((c) => c.runId === "run")).toBe(true);
}, 15000);
it("replays a suspended read with stable child identity and does not repeat finished reads", async () => {
	const h = await setup("const b=await tools.app_bots_list({});await tools.app_groups_list({});text(b.value.items.length);", true);
	const observed: unknown[] = [];
	const stop = await runtime!.observe(h.core, (s) => observed.push(s));
	const pending = h.run().catch(() => undefined);
	await vi.waitFor(() => expect(h.seen.length).toBe(2));
	await vi.waitFor(() => expect(JSON.stringify(observed)).toContain("app_groups_list"));
	stop();
	const before = (await runtime!.snapshot(h.core)).items.find((i) => i.kind === "tool");
	if (before?.kind !== "tool") throw Error("Missing parent");
	await runtime!.close();
	runtime = undefined;
	await pending;
	await h.reopen();
	runtime!.resume();
	await vi.waitFor(async () => expect((await runtime!.snapshot(h.core)).items.find((i) => i.kind === "tool")?.status).toBe("succeeded"));
	const after = (await runtime!.snapshot(h.core)).items.find((i) => i.kind === "tool");
	expect(after).toMatchObject({
		execution: {
			executionId: before.execution!.executionId,
			deadline: before.execution!.deadline,
			state: "succeeded",
			children: before.execution!.children.map((c) => ({ ...c, state: "succeeded" })),
		},
	});
	expect(h.seen.filter((c) => c.tool === "app_bots_list")).toHaveLength(1);
	expect(new Set(h.seen.filter((c) => c.tool === "app_groups_list").map((c) => c.callId)).size).toBe(1);
}, 15000);
it.each([
	'await import("node:fs")',
	'await tools.codemode({code:"text(1)"})',
	'await tools.local_exec({command:"echo unsafe"})',
	'await tools.bot_create({name:"Unauthorized"})',
])(
	"rejects unavailable sandbox capability: %s",
	async (code) => {
		const h = await setup(code);
		await h.run();
		expect(h.seen).toHaveLength(0);
		expect((await runtime!.snapshot(h.core)).items.find((i) => i.kind === "tool")).toMatchObject({ status: "failed" });
	},
	15000,
);
it("rejects a model calling a tools-only application read directly", async () => {
	const h = await setup('text("ready");');
	await h.run();
	h.model.answer({ tool: "app_bots_list", args: {} }, "Done");
	await runtime!.submitAndWait(h.core, "guess", "Read the roster");
	expect(h.seen).toHaveLength(0);
	expect((await runtime!.snapshot(h.core)).items.filter((i) => i.kind === "tool").at(-1)).toMatchObject({ status: "failed" });
}, 15000);
