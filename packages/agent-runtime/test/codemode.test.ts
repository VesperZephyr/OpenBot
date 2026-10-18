import { expect, it } from "vitest";
import { APP_CODE_LIMITS, APP_CODE_VERSION, type AppExecution } from "@openbot/protocol";
import { AppSandbox, APP_CATALOG_DIGEST, canResume } from "../src/codemode.ts";
it("rejects changed versions, catalogs, identities and expired absolute deadlines", () => {
	const expected = { sourceDigest: "source", parentCallId: "call", targetId: "mac" };
	const record: AppExecution = {
		...expected,
		executionId: "task",
		botId: "core",
		conversationId: "chat",
		authority: { runId: "old", channelId: "direct", origin: "user", rootRequestId: "request" },
		version: APP_CODE_VERSION,
		catalogDigest: APP_CATALOG_DIGEST,
		limits: APP_CODE_LIMITS,
		admittedAt: 1,
		deadline: 101,
		state: "running",
		children: [],
	};
	expect(canResume(record, expected, 100)).toBe(true);
	for (const patch of [
		{ version: 2 },
		{ catalogDigest: "other" },
		{ sourceDigest: "changed" },
		{ targetId: "other" },
		{ parentCallId: "new" },
		{ deadline: 100 },
		{ state: "cancelled" as const },
	])
		expect(canResume({ ...record, ...patch }, expected, 100)).toBe(false);
});
it("holds two physical worker slots and one per conversation until exit", async () => {
	const a = new AppSandbox("a", Date.now() + 10000),
		b = new AppSandbox("b", Date.now() + 10000),
		c = new AppSandbox("c", Date.now() + 10000),
		same = new AppSandbox("a", Date.now() + 10000);
	const controller = new AbortController();
	const options = {
		startedAt: 1,
		seed: 1,
		tools: [],
		globals: [],
		store: {},
		signal: controller.signal,
		onCall: () => {},
		onIdle: () => {},
	};
	let readyA!: () => void, readyB!: () => void;
	const ready = Promise.all([new Promise<void>((r) => (readyA = r)), new Promise<void>((r) => (readyB = r))]);
	const one = a.start("while(true) {}", { ...options, onStarted: () => readyA() }),
		two = b.start("while(true) {}", { ...options, onStarted: () => readyB() });
	await ready;
	expect((await c.start('text("bad")', options).result).ok).toBe(false);
	expect((await same.start('text("bad")', options).result).ok).toBe(false);
	controller.abort();
	await Promise.all([one.result, two.result]);
	await Promise.all([a.close(), b.close(), c.close(), same.close()]);
}, 15000);
