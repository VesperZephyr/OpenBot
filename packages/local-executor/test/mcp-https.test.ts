import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConnectorSupervisor } from "../src/connectors.ts";
import { McpHttps, retryAfter } from "../src/mcp-https.ts";
import { httpsFixture } from "./fixtures/mcp-https.ts";
import type { ConnectorDefinition } from "@openbot/protocol";
let root: string, fixture: Awaited<ReturnType<typeof httpsFixture>>, supervisor: ConnectorSupervisor;
const definition = (revision = 1): Extract<ConnectorDefinition, { transport: "https" }> => ({
	connectorId: "https",
	name: "HTTPS fixture",
	transport: "https",
	endpoint: fixture.endpoint,
	auth: "bearer",
	revision,
	targetId: "local",
});
const connect = (revision = 1) => supervisor.connect(definition(revision), fixture.state.token);
const invoke = (name: string, signal = new AbortController().signal, revision = 1) =>
	supervisor.invoke(
		{ connectorId: "https", revision, schemaHash: supervisor.inspect("https").tools.find((t) => t.name === name)!.schemaHash },
		`mcp__https__${name}`,
		{ text: "confirmed effect" },
		signal,
	);
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "openbot-https-"));
	fixture = await httpsFixture(root);
	supervisor = new ConnectorSupervisor(join(root, "connectors.sqlite"), "local", root, () => {}, fixture.cert);
});
afterEach(async () => {
	vi.restoreAllMocks();
	await supervisor.close();
	await fixture.close();
	await rm(root, { recursive: true, force: true });
});
it.each(["normal", "sse", "server-request", "session-echo"])(
	"negotiates %s, binds session/version/auth and redacts credentials",
	async (mode) => {
		fixture.state.mode = mode;
		expect((await connect()).state).toBe("connected");
		expect((await invoke("write_note")).status).toBe("succeeded");
		expect((await invoke("echo_token")).output).toBe("[redacted]");
		expect(fixture.state.writes).toEqual(["confirmed effect"]);
		expect(fixture.state.requests.filter((r) => r.rpc === "initialize")[0]).toMatchObject({ authorized: true });
		expect(fixture.state.requests.filter((r) => r.rpc === "initialize")[0]?.session).toBeUndefined();
		for (const req of fixture.state.requests.filter((r) => r.rpc && r.rpc !== "initialize"))
			expect(req).toMatchObject({ session: "fixture-private-session-1", version: "2025-11-25", authorized: true });
		expect(JSON.stringify(supervisor.inspect("https"))).not.toContain(fixture.state.token);
		expect(JSON.stringify(supervisor.inspect("https"))).not.toContain("fixture-private-session");
	},
);
it.each(["bad-schema", "bad-json", "bad-utf8", "wrong-id", "oversize", "sse-events", "auth", "expired"])(
	"fails closed on %s without exposing a response body",
	async (mode) => {
		fixture.state.mode = mode;
		const state = await connect();
		expect(state.state).toBe("needs_attention");
		expect(state.tools).toEqual([]);
		expect(JSON.stringify(state)).not.toContain(fixture.state.token);
	},
);
it("does not follow redirects or forward a credential to a second origin", async () => {
	const other = await httpsFixture(root);
	try {
		fixture.state.mode = "redirect";
		fixture.state.redirect = other.endpoint;
		expect((await connect()).error).toContain("redirects are blocked");
		expect(other.state.requests).toEqual([]);
	} finally {
		await other.close();
	}
});
it("requires valid TLS and does not inject credentials for public endpoints", async () => {
	const session = new McpHttps(fixture.endpoint, fixture.state.token, () => {});
	await expect(session.request("initialize", {}, 1000)).rejects.toThrow("TLS certificate");
	await session.stop();
	expect(fixture.state.requests).toHaveLength(0);
	expect(
		(
			await supervisor.connect(
				{ ...definition(), endpoint: fixture.endpoint.replace("/mcp", "/public"), auth: "none" },
				"must-not-send-this-token",
			)
		).state,
	).toBe("connected");
	expect(fixture.state.requests.every((r) => !r.authorized)).toBe(true);
});
it("honors Retry-After without automatic retry, including across executor reopen", async () => {
	fixture.state.mode = "rate";
	fixture.state.retry = "60";
	const state = await connect();
	const count = fixture.state.requests.length;
	expect(state.retryAt).toBeGreaterThan(Date.now() + 58000);
	expect((await connect(2)).retryAt).toBe(state.retryAt);
	await supervisor.close();
	supervisor = new ConnectorSupervisor(join(root, "connectors.sqlite"), "local", root, () => {}, fixture.cert);
	expect((await connect(3)).retryAt).toBe(state.retryAt);
	expect(fixture.state.requests).toHaveLength(count);
	fixture.state.mode = "normal";
	vi.spyOn(Date, "now").mockReturnValue(state.retryAt! + 1);
	expect((await connect(4)).state).toBe("connected");
});
it("parses bounded retry metadata and defaults malformed values", () => {
	expect(retryAfter("2", 10000)).toBe(12000);
	expect(retryAfter("Thu, 01 Jan 1970 00:00:20 GMT", 10000)).toBe(20000);
	expect(retryAfter("0", 10000)).toBe(11000);
	for (const value of [undefined, "invalid", "1.5", "-1", "9".repeat(100)]) expect(retryAfter(value, 10000)).toBe(70000);
});
it.each(["auth", "expired", "rate"])("a dispatched call receiving %s remains unknown and never retries", async (mode) => {
	await connect();
	fixture.state.mode = mode;
	expect((await invoke("write_note")).status).toBe("unknown");
	expect(supervisor.inspect("https").state).toBe("needs_attention");
	expect(fixture.state.requests.filter((r) => r.rpc === "tools/call")).toHaveLength(1);
});
it("starts a new explicit session after expiration and fences old revisions", async () => {
	await connect();
	const hash = supervisor.inspect("https").tools[0]!.schemaHash;
	fixture.state.mode = "expired";
	await invoke("read_note");
	fixture.state.mode = "normal";
	await connect(2);
	expect(fixture.state.sessions).toBe(2);
	expect(fixture.state.requests.filter((r) => r.rpc === "initialize").every((r) => !r.session)).toBe(true);
	expect(
		(
			await supervisor.invoke(
				{ connectorId: "https", revision: 1, schemaHash: hash },
				"mcp__https__read_note",
				{ text: "old" },
				new AbortController().signal,
			)
		).status,
	).toBe("failed");
});
it("invalidates changed catalogs and aborts cancellation without claiming remote rollback", async () => {
	await connect();
	expect((await invoke("invalidate")).status).toBe("unknown");
	await connect();
	const controller = new AbortController();
	const pending = invoke("wait_forever", controller.signal);
	await expect.poll(() => fixture.state.requests.filter((r) => r.rpc === "tools/call").length).toBe(2);
	controller.abort();
	expect((await pending).status).toBe("unknown");
	await supervisor.disconnect("https");
	expect(fixture.state.cancelled).toBeGreaterThan(0);
	expect(fixture.state.deleted).toBeGreaterThan(0);
	expect(supervisor.inspect("https").state).toBe("disconnected");
});
it("bounds header/body waits and quiesces a pending handshake", async () => {
	fixture.state.mode = "wait";
	const session = new McpHttps(fixture.endpoint, fixture.state.token, () => {}, fixture.cert);
	const started = Date.now();
	await expect(session.request("initialize", {}, 50)).rejects.toThrow();
	await session.stop();
	expect(Date.now() - started).toBeLessThan(1500);
	const pending = connect();
	await expect.poll(() => fixture.state.requests.length).toBe(2);
	expect(await supervisor.stopAll()).toBe(true);
	expect((await pending).state).toBe("needs_attention");
});
it("preserves unknown write receipts after reconnect with exactly one external effect", async () => {
	const { LocalExecutor, ReceiptLedger } = await import("../src/index.ts");
	const ledger = ReceiptLedger.open(join(root, "receipts.sqlite"));
	const executor = new LocalExecutor({
		targetId: "local",
		workspace: root,
		ledger,
		connectors: supervisor,
		artifactsDirectory: join(root, "artifacts"),
	});
	try {
		await connect();
		const call = {
			invocationId: "lost",
			botId: "bot",
			conversationId: "conv",
			tool: "mcp__https__lose_response" as const,
			args: { text: "one write" },
			argsDigest: "lost",
			target: { kind: "local" as const, targetId: "local" },
			grants: [],
			readGrants: [],
			deadline: Date.now() + 60000,
			connector: {
				connectorId: "https",
				revision: 1,
				schemaHash: supervisor.inspect("https").tools.find((t) => t.name === "lose_response")!.schemaHash,
			},
		};
		expect((await executor.invoke(call, () => {})).status).toBe("unknown");
		await connect(2);
		expect((await executor.invoke(call, () => {})).status).toBe("unknown");
		expect(fixture.state.writes).toEqual(["one write"]);
	} finally {
		await executor.cancelAll();
		ledger.close();
	}
});

it("does not downgrade a dispatched tool when its nested server-response POST cannot be sent", async () => {
	await connect();
	fixture.state.mode = "oversize-request";
	expect((await invoke("read_note")).status).toBe("unknown");
	expect(fixture.state.requests.filter((r) => r.rpc === "tools/call")).toHaveLength(1);
});

it("invalidates a session with an unsupported tool result instead of admitting more calls", async () => {
	await connect();
	fixture.state.mode = "bad-result";
	expect((await invoke("read_note")).status).toBe("unknown");
	expect(supervisor.inspect("https").state).toBe("needs_attention");
});
