import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { BotRuntime } from "@openbot/agent-runtime";
import { scriptedModels, SCRIPTED_MODEL } from "@openbot/agent-runtime/testing";
import { TOOL_CATALOG, PROTOCOL_VERSION, type PendingApproval, type TranscriptItem } from "@openbot/protocol";
import { ApprovalBook, HostService, MemorySecretStore } from "@openbot/server-core";
import { ToolRouter, type ToolCall } from "@openbot/tool-router";

let runtime: BotRuntime, service: HostService, book: ApprovalBook, root: string;
afterEach(async () => {
	await service?.stop();
	await runtime?.close();
	if (root) await rm(root, { recursive: true, force: true });
});
const pause = (signal: AbortSignal) =>
	new Promise<never>((_, reject) => {
		signal.addEventListener("abort", () => reject(signal.reason), { once: true });
		if (signal.aborted) reject(signal.reason);
	});
async function setup(code: string) {
	root = await mkdtemp(join(tmpdir(), "openbot-code-management-"));
	const model = scriptedModels({ tool: "codemode", args: { code } }, "Done");
	const seen: ToolCall[] = [];
	let hook: (phase: string, call: ToolCall) => Promise<void> = async () => {};
	let core = "",
		router: ToolRouter;
	const open = async () => {
		book = new ApprovalBook(() => {});
		router = new ToolRouter({
			closeAppManagement: (c) => service.closeAppManagement(c),
			target: { kind: "local", targetId: "mac" },
			policy: {
				decide: async (c, d) =>
					d.capability === "bot.management"
						? service.management.prepare(c)
						: d.capability === "group.management"
							? service.groups.prepare(c)
							: service.capabilities.authorize(c),
				grants: async () => ({ read: [], readwrite: [] }),
			},
			approvals: {
				request: async (a, s) => {
					const verdict = await book.request(a, s);
					await hook("after-decision", seen.findLast((c) => c.callId === a.callId)!);
					return verdict;
				},
			},
			executor: {
				invoke: async () => {
					throw Error("Unexpected executor");
				},
			},
			hostTools: Object.fromEntries(
				TOOL_CATALOG.filter((d) => d.destination === "host").map((d) => [
					d.name,
					async (_a, _s, c) =>
						d.capability === "bot.management"
							? service.manageBots(c)
							: d.capability === "group.management"
								? service.manageGroups(c)
								: service.capabilities.invokeTool(c),
				]),
			),
		});
		runtime = await BotRuntime.open({
			databasePath: join(root, "db"),
			models: model.models,
			tools: {
				definitions: TOOL_CATALOG,
				admitOrchestration: (c) => router.admitOrchestration(c),
				invoke: async (c) => {
					seen.push(c);
					await hook("before-proposal", c);
					const result = await router.invoke(c);
					await hook("after-result", c);
					return result;
				},
			},
		});
		service = new HostService({
			runtime,
			secrets: new MemorySecretStore(),
			status: { protocolVersion: PROTOCOL_VERSION, hostVersion: "test", nodeVersion: "test", targetId: "mac", startedAt: 0 },
			dataDirectory: root,
			workspace: root,
			approvals: book,
			emit: () => {},
			modelConfig: {
				path: join(root, "models.json"),
				read: async () => undefined,
				write: async () => {},
				environment: { env: () => undefined, run: async () => "" },
			},
		});
		await book.start(runtime.approvals());
	};
	await open();
	core = (await runtime.ensureCoreBot(1)).botId;
	await runtime.setDefaultModel(SCRIPTED_MODEL);
	await runtime
		.runsStore()
		.put({ runId: "run", botId: core, state: "running", origin: "user", requestIds: ["request"], messages: [], inputs: [], createdAt: 1 });
	return {
		core,
		seen,
		model,
		get router() {
			return router;
		},
		setHook: (h: typeof hook) => {
			hook = h;
		},
		run: () => runtime.submitAndWait(core, "request", "Manage the requested Bots and groups"),
		pending: async () => {
			await vi.waitFor(() => expect(book.forBot(core)).toHaveLength(1));
			return book.forBot(core)[0]!;
		},
		approve: async () => {
			await vi.waitFor(() => expect(book.forBot(core)).toHaveLength(1));
			const a = book.forBot(core)[0]!;
			await book.decide(a.approvalId, "allow_once");
			return a;
		},
		reopen: async () => {
			await service.stop();
			await runtime.close();
			await open();
		},
		parent: async () => (await runtime.snapshot(core)).items.find((i) => i.kind === "tool") as Extract<TranscriptItem, { kind: "tool" }>,
	};
}
const create = 'const b=await tools.app_bots_create({name:"Helper"});if(!b.ok) throw Error("Create failed");text(b.value.bot.botId);';
it("composes approved Bot and group lifecycle with exact nested receipts and revisioned structured results", async () => {
	const h = await setup(
		`const b=await tools.app_bots_create({name:"Helper"});const id=b.value.bot.botId;const roster=await tools.app_bots_list({});const core=roster.value.items.find(b=>b.kind==="core").botId;const g=await tools.app_groups_create({name:"Studio",objective:"Research",memberIds:[core,id],leadBotId:core});const info=await tools.app_bots_inspect({botId:id});const edit=await tools.app_bots_update({botId:id,expectedRevision:info.value[0].revision,role:"Reviewer"});const gi=await tools.app_groups_inspect({groupId:g.value.groupId});const u=await tools.app_groups_update({groupId:g.value.groupId,expectedRevision:gi.value[0].revision,name:"Review",objective:"Check",memberIds:[core,id],leadBotId:id});await tools.app_groups_dissolve({groupId:g.value.groupId,expectedRevision:u.value.revision});await tools.app_bots_delete({botId:id,expectedRevision:edit.value.bot.revision});text({bot:id,group:g.value.groupId});`,
	);
	const running = h.run();
	const approvals: PendingApproval[] = [];
	for (let i = 0; i < 6; i++) approvals.push(await h.approve());
	await running;
	expect(approvals.every((a) => !a.alwaysAllowOptions && a.deadline)).toBe(true);
	expect(new Set(approvals.map((a) => a.approvalId)).size).toBe(6);
	const parent = await h.parent();
	expect(parent.execution?.state, JSON.stringify(parent)).toBe("succeeded");
	expect(parent.execution?.children.filter((c) => c.object)).toHaveLength(6);
	expect((await runtime.management().list()).filter((r) => r.result)).toHaveLength(3);
	expect((await runtime.groups().list())[0]?.status).toBe("dissolved");
	expect((await runtime.listBots()).filter((b) => b.kind === "specialist")[0]?.status).toBe("deleted");
	expect(parent.execution!.deadline - parent.execution!.admittedAt).toBeLessThanOrEqual(600000);
}, 15000);
it("denial latches admission even with caught failures and queued calls; committed objects remain", async () => {
	const h = await setup(
		'await tools.app_bots_create({name:"Kept"});try{await tools.app_bots_create({name:"Denied"});}catch{}try{await tools.app_bots_create({name:"Forbidden retry"});}catch{}text("finished");',
	);
	const running = h.run();
	await h.approve();
	const denied = await h.pending();
	await book.decide(denied.approvalId, "deny");
	await running;
	expect((await runtime.listBots()).map((b) => b.name)).toEqual(["OpenBot", "Kept"]);
	expect((await h.parent()).execution).toMatchObject({ managementClosed: true, state: "failed" });
	expect(h.seen.filter((c) => c.tool === "app_bots_create")).toHaveLength(2);
	expect(book.forBot(h.core)).toHaveLength(0);
}, 15000);
it.each(["before-proposal", "waiting", "after-decision", "after-result", "after-child"])(
	"reconciles restart at %s without duplicating mutations or extending deadline",
	async (phase) => {
		const h = await setup(create + "await tools.app_groups_list({});");
		let reached = false;
		if (phase !== "waiting")
			h.setHook(async (p, c) => {
				if (
					phase === "after-child" ? p === "before-proposal" && c.tool === "app_groups_list" : p === phase && c.tool === "app_bots_create"
				) {
					reached = true;
					await pause(c.signal);
				}
			});
		const running = h.run().catch(() => {});
		if (phase !== "before-proposal") {
			await h.pending();
			if (phase !== "waiting") await h.approve();
			else reached = true;
		}
		await vi.waitFor(() => expect(reached).toBe(true));
		const before = (await h.parent()).execution!;
		h.setHook(async () => {});
		await h.reopen();
		await running;
		runtime.resume();
		if (["before-proposal", "waiting"].includes(phase)) await h.approve();
		await vi.waitFor(async () => expect((await h.parent()).status).toBe("succeeded"));
		expect((await h.parent()).execution?.deadline).toBe(before.deadline);
		expect((await runtime.listBots()).filter((b) => b.kind === "specialist")).toHaveLength(1);
		expect((await runtime.management().list()).filter((r) => r.result)).toHaveLength(1);
		expect(new Set(h.seen.filter((c) => c.tool === "app_bots_create").map((c) => c.callId)).size).toBe(1);
	},
	15000,
);
it.each(["revision", "run", "approval", "stop"])(
	"rejects %s changes during the exact approval wait",
	async (change) => {
		const h = await setup('await tools.app_bots_update({botId:"helper",expectedRevision:1,role:"Model edit"});');
		await runtime.createBot({ botId: "helper", name: "Helper", createdAt: 1 });
		const running = h.run();
		const approval = await h.pending();
		if (change === "revision") await runtime.updateBot("helper", { role: "User edit" });
		if (change === "run") await runtime.runsStore().put({ ...(await runtime.runsStore().get("run"))!, state: "cancelled" });
		if (change === "approval")
			h.setHook(async (p) => {
				if (p === "after-decision") {
					const a = (await runtime.approvals().get(approval.approvalId))!;
					await runtime.approvals().put({ ...a, args: { botId: "helper", expectedRevision: 1, role: "Substituted" } });
				}
			});
		if (change === "stop") await runtime.cancel(h.core);
		else await book.decide(approval.approvalId, "allow_once");
		await running;
		expect((await runtime.getBot("helper"))?.role).not.toBe("Model edit");
		expect((await runtime.management().list()).some((p) => p.result)).toBe(false);
	},
	15000,
);
it("rejects forged actors, ancestry, targets, args and Core changes at the Host gateway", async () => {
	const h = await setup(create);
	const running = h.run();
	await h.pending();
	const call = h.seen[0]!;
	await runtime.createBot({ botId: "specialist", name: "Worker", createdAt: 1 });
	for (const patch of [
		{ botId: "specialist" },
		{ conversationId: "forged" },
		{ runId: "forged" },
		{ appExecutionId: "forged" },
		{ target: { kind: "local" as const, targetId: "elsewhere" } },
		{ callId: "forged" },
		{ executionDeadline: Date.now() + 999999 },
		{ args: { ...call.args, actorId: h.core } },
		{ args: { ...call.args, origin: "user" } },
		{ tool: "app_bots_delete", args: { botId: h.core, expectedRevision: 1 } },
		{ tool: "app_settings_update", args: {} },
	]) {
		expect((await service.management.prepare({ ...call, ...patch, signal: new AbortController().signal })).kind).toBe("deny");
	}
	await book.decide(book.forBot(h.core)[0]!.approvalId, "deny");
	await running;
	expect((await runtime.listBots()).filter((b) => b.kind === "specialist")).toHaveLength(1);
}, 15000);
it("expires waiting approval and blocks a late decision without a side effect", async () => {
	const h = await setup('// @options: {"timeout_ms":600}\n' + create);
	const running = h.run();
	const a = await h.pending();
	await running;
	expect(await book.decide(a.approvalId, "allow_once")).toBe(false);
	expect(await runtime.listBots()).toHaveLength(1);
	expect((await h.parent()).execution?.error).toBe("Application execution expired");
}, 15000);
it("blocks queued mutations after a denial even when all failures are caught", async () => {
	const h = await setup(
		'await Promise.allSettled([tools.app_bots_create({name:"Denied"}),tools.app_bots_create({name:"Queued"})]);try{await tools.app_bots_create({name:"Later"});}catch{}',
	);
	const running = h.run();
	const a = await h.pending();
	await book.decide(a.approvalId, "deny");
	await running;
	expect(await runtime.listBots()).toHaveLength(1);
	expect(book.forBot(h.core)).toHaveLength(0);
	expect(await runtime.management().list()).toHaveLength(1);
}, 15000);
it.each([false, true])(
	"latches an uncertain delivery and reconciles atomic receipts (committed=%s)",
	async (committed) => {
		const h = await setup(
			'try{await tools.app_bots_create({name:"First"});}catch{}try{await tools.app_bots_create({name:"Must not run"});}catch{}',
		);
		h.setHook(async (phase, c) => {
			if (c.tool === "app_bots_create" && phase === (committed ? "after-result" : "before-proposal"))
				throw Error("Injected delivery failure");
		});
		const running = h.run();
		if (committed) await h.approve();
		await running;
		const parent = await h.parent();
		expect(parent.execution?.managementClosed).toBe(true);
		expect(parent.execution?.state).toBe(committed ? "failed" : "needs_attention");
		expect((await runtime.listBots()).filter((b) => b.kind === "specialist")).toHaveLength(committed ? 1 : 0);
		if (committed) expect(parent.execution?.children[0]).toMatchObject({ state: "succeeded", object: { kind: "bot", revision: 1 } });
		expect(h.seen).toHaveLength(1);
	},
	15000,
);
it("publishes the first nested approval ancestry before the child settles", async () => {
	const h = await setup(create);
	const observed: TranscriptItem[][] = [];
	const stop = await runtime.observe(h.core, (s) => observed.push([...s.items]));
	const running = h.run();
	await h.pending();
	await vi.waitFor(() =>
		expect(
			observed.some((items) =>
				items.some(
					(i) => i.kind === "tool" && i.execution?.children.some((c) => c.capability === "app_bots_create" && c.state === "running"),
				),
			),
		).toBe(true),
	);
	await h.approve();
	await running;
	stop();
}, 15000);
it("cannot modify Core or discover management aliases as a Specialist", async () => {
	const h = await setup(
		'const roster=await tools.app_bots_list({});const core=roster.value.items.find(b=>b.kind==="core");text(await tools.app_bots_delete({botId:core.botId,expectedRevision:core.revision}));',
	);
	await h.run();
	expect(await runtime.getBot(h.core)).toMatchObject({ kind: "core", status: "active" });
	expect(book.forBot(h.core)).toHaveLength(0);
	await runtime.createBot({ botId: "worker", name: "Worker", createdAt: 1 });
	h.model.answer({ tool: "codemode", args: { code: 'await tools.app_bots_create({name:"Forged"});' } }, "Done");
	await runtime.submitAndWait("worker", "specialist", "Manage Bots");
	expect(await runtime.listBots()).toHaveLength(2);
	expect((await runtime.snapshot("worker")).items.find((i) => i.kind === "tool")).toMatchObject({ status: "failed" });
}, 15000);
