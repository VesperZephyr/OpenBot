import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ApprovalRecord } from "@openbot/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BotRuntime } from "../src/index.ts";
import { scriptedModels } from "../src/testing.ts";

const record = (approvalId: string, overrides: Partial<ApprovalRecord> = {}): ApprovalRecord => ({
	approvalId,
	botId: "bot",
	callId: approvalId,
	tool: "local_exec",
	args: { command: "echo hi" },
	target: { kind: "local", targetId: "mac" },
	reason: "Runs a command on this Mac",
	createdAt: 1_000,
	state: "pending",
	...overrides,
});

describe("ApprovalStore", () => {
	let directory: string;
	let databasePath: string;
	let runtime: BotRuntime | undefined;

	const open = async (): Promise<BotRuntime> => {
		await runtime?.close();
		runtime = await BotRuntime.open({ databasePath, models: scriptedModels().models });
		return runtime;
	};

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "openbot-approvals-"));
		databasePath = join(directory, "db.sqlite");
	});

	afterEach(async () => {
		await runtime?.close();
		runtime = undefined;
		await rm(directory, { recursive: true, force: true });
	});

	it("keeps records across a reopen of the same database", async () => {
		const store = (await open()).approvals();
		await store.put(record("a"));
		await store.put(record("b", { state: "denied", decision: "deny", decidedAt: 2_000 }));

		const reopened = (await open()).approvals();
		expect(await reopened.get("b")).toEqual(record("b", { state: "denied", decision: "deny", decidedAt: 2_000 }));
		expect((await reopened.pending()).map((r) => r.approvalId)).toEqual(["a"]);
	});

	it("prunes old answered records and keeps pending ones", async () => {
		const store = (await open()).approvals();
		await store.put(record("old", { state: "consumed", decision: "allow_once", decidedAt: 1_000 }));
		await store.put(record("recent", { state: "consumed", decision: "allow_once", decidedAt: 9_000 }));
		await store.put(record("waiting"));
		await store.prune(5_000);
		expect(await store.get("old")).toBeUndefined();
		expect(await store.get("recent")).toBeDefined();
		expect(await store.get("waiting")).toBeDefined();
	});
});
