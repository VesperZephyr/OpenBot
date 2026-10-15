import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BotRuntime } from "@openbot/agent-runtime";
import { scriptedModels } from "@openbot/agent-runtime/testing";
import { type PendingApproval, PROTOCOL_VERSION, toolDefinition } from "@openbot/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalBook, decide, HostService, loadPolicy, MemorySecretStore } from "../src/index.ts";

describe("Always allow and grants", () => {
	let root: string;
	let workspace: string;
	let outside: string;
	let runtime: BotRuntime;
	let book: ApprovalBook;
	let service: HostService;

	beforeEach(async () => {
		root = await realpath(await mkdtemp(join(tmpdir(), "openbot-always-")));
		workspace = join(root, "workspace");
		outside = join(root, "outside");
		await mkdir(workspace);
		await mkdir(join(outside, "notes"), { recursive: true });
		runtime = await BotRuntime.open({ databasePath: join(root, "db.sqlite"), models: scriptedModels().models });
		book = new ApprovalBook(() => {});
		service = new HostService({
			runtime,
			secrets: new MemorySecretStore(),
			status: { protocolVersion: PROTOCOL_VERSION, hostVersion: "test", nodeVersion: "test", targetId: "mac", startedAt: 0 },
			dataDirectory: root,
			modelConfig: { path: join(root, "models.json"), read: async () => undefined, environment: { env: () => undefined, run: async () => "" } },
			approvals: book,
			workspace,
			emit: () => {},
		});
		await service.start();
	});

	afterEach(async () => {
		await service.stop();
		await runtime.close();
		await rm(root, { recursive: true, force: true });
	});

	/** What the router does: decide under the current policy, and record an approval when policy asks. */
	const ask = async (callId: string, tool: string, args: Record<string, unknown>) => {
		const decision = decide({ tool, args }, toolDefinition(tool)!, await loadPolicy(runtime.policy(), workspace));
		if (decision.kind !== "ask") return { decision };
		const approval: PendingApproval = {
			approvalId: `approval:1:${callId}`,
			botId: "bot",
			callId,
			tool,
			args,
			target: { kind: "local", targetId: "mac" },
			reason: decision.reason,
			createdAt: 1,
			...(decision.alwaysAllowOptions === undefined ? {} : { alwaysAllowOptions: decision.alwaysAllowOptions }),
		};
		const verdict = book.request(approval, new AbortController().signal);
		// The book shows a request once its record is committed.
		await vi.waitFor(() => expect(book.forBot("bot").some((pending) => pending.callId === callId)).toBe(true));
		return { decision, approval, verdict };
	};

	it("saves the chosen rule in the same step that answers the card; deleting the rule asks again", async () => {
		const first = await ask("c1", "local_exec", { command: "make test" });
		const option = first.approval!.alwaysAllowOptions!.find((candidate) => candidate.label === "make test")!;
		await service.handle("approvals.decide", { approvalId: first.approval!.approvalId, decision: { kind: "always_allow", scope: option.scope } });
		expect(await first.verdict).toEqual({ kind: "always_allow", scope: option.scope });
		const { rules } = await service.handle("policy.get", {});
		expect(rules.map(({ program, exact }) => ({ program, exact }))).toEqual([{ program: "make", exact: "make test" }]);

		expect((await ask("c2", "local_exec", { command: "make test" })).decision).toEqual({ kind: "allow" });
		await service.handle("policy.rules.delete", { id: rules[0]!.id });
		expect((await ask("c3", "local_exec", { command: "make test" })).decision.kind).toBe("ask");
	});

	it("refuses an Always allow scope the card did not offer", async () => {
		const first = await ask("c1", "local_exec", { command: "make test" });
		await expect(
			service.handle("approvals.decide", {
				approvalId: first.approval!.approvalId,
				decision: { kind: "always_allow", scope: { kind: "command", rule: { program: "rm" } } },
			}),
		).rejects.toThrow("does not offer");
		expect((await service.handle("policy.get", {})).rules).toEqual([]);
		expect(book.forBot("bot")).toHaveLength(1);
	});

	it("granting a folder settles other waiting calls it covers", async () => {
		const target = join(outside, "notes", "a.md");
		const first = await ask("c1", "local_read", { path: target });
		const second = await ask("c2", "local_list", { path: join(outside, "notes") });
		const folder = first.approval!.alwaysAllowOptions![0]!;
		expect(folder.scope).toEqual({ kind: "folder", path: join(outside, "notes"), access: "read" });
		await service.handle("approvals.decide", { approvalId: first.approval!.approvalId, decision: { kind: "always_allow", scope: folder.scope } });
		expect(await second.verdict).toBe("allow_once");
		expect((await service.handle("grants.list", {})).map((grant) => [grant.path, grant.access])).toEqual([[join(outside, "notes"), "read"]]);
	});

	it("revoking a grant re-checks pending approvals that relied on it", async () => {
		await service.handle("grants.add", { path: outside, access: "readwrite" });
		const [grant] = await service.handle("grants.list", {});
		// The card offers rules because the output goes into a granted folder.
		const pending = await ask("c1", "local_exec", { command: `npm test > ${join(outside, "log.txt")}` });
		expect(pending.approval!.alwaysAllowOptions?.map((option) => option.label)).toEqual([`npm test`, "npm test *"]);
		expect((await ask("c2", "local_exec", { command: "ls", cwd: outside })).decision).toEqual({ kind: "allow" });

		await service.handle("grants.revoke", { id: grant!.id });
		expect(await service.handle("grants.list", {})).toEqual([]);
		// Those rules would no longer match, so the card stops offering them.
		expect(book.forBot("bot")[0]!.alwaysAllowOptions).toBeUndefined();
		expect((await ask("c3", "local_exec", { command: "ls", cwd: outside })).decision.kind).toBe("ask");
		expect((await ask("c4", "local_read", { path: join(outside, "notes", "a.md") })).decision.kind).toBe("ask");
		expect(book.forBot("bot").map((approval) => approval.callId)).toEqual(["c1", "c3", "c4"]);
	});

	it("Never denies a waiting command", async () => {
		const first = await ask("c1", "local_exec", { command: "make test" });
		await service.handle("policy.update", { commandSetting: "never" });
		expect(await first.verdict).toBe("deny");
	});

	it("grants.add refuses anything but an existing absolute folder", async () => {
		await expect(service.handle("grants.add", { path: "relative", access: "read" })).rejects.toThrow("absolute");
		await expect(service.handle("grants.add", { path: join(outside, "missing"), access: "read" })).rejects.toThrow("not a folder");
	});
});
