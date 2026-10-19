import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BotRuntime } from "@openbot/agent-runtime";
import { scriptedModels } from "@openbot/agent-runtime/testing";
import { CONNECTOR_CREDENTIAL_PREFIX, type ConnectorConnection, type ConnectorControl } from "@openbot/protocol";
import { ApprovalBook, MemorySecretStore } from "../src/index.ts";
import { Connectors } from "../src/connectors.ts";
let root: string, runtime: BotRuntime, service: Connectors, secrets: MemorySecretStore;
const tool = {
	name: "write_note",
	description: "Write",
	inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
	schemaHash: "a".repeat(64),
};
const request = vi.fn(
	async (_id: string, op: ConnectorControl): Promise<ConnectorConnection> => ({
		connectorId: op.action === "connect" ? op.definition.connectorId : op.connectorId,
		state: op.action === "connect" ? "connected" : "disconnected",
		tools: op.action === "connect" ? [tool] : [],
	}),
);
const install = { requestId: "install", connectorId: "notes", name: "Notes", command: "/usr/bin/true", args: [] };
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "openbot-connector-host-"));
	runtime = await BotRuntime.open({ databasePath: join(root, "pi.sqlite"), models: scriptedModels("Done").models });
	secrets = new MemorySecretStore();
	request.mockClear();
	service = new Connectors({
		runtime,
		targetId: "mac",
		port: { request },
		secrets,
		approvals: new ApprovalBook(() => {}),
		assertAllowed: () => {},
		change: (fn) => fn(),
		publish: async () => {},
		changed: () => {},
	});
	await service.start();
});
afterEach(async () => {
	await service.close();
	await runtime.close();
	await rm(root, { recursive: true, force: true });
});
it("persists config before connecting, deduplicates operations and fences revision and removed IDs", async () => {
	expect(await service.install(install)).toMatchObject({ revision: 1, state: "connected" });
	expect(await service.install(install)).toMatchObject({ revision: 1 });
	expect(request).toHaveBeenCalledTimes(1);
	await expect(service.install({ ...install, name: "Changed" })).rejects.toThrow("identity changed");
	await expect(service.disconnect({ connectorId: "notes", requestId: "stale", expectedRevision: 0 })).rejects.toThrow("Reload");
	await service.remove({ connectorId: "notes", requestId: "remove", expectedRevision: 1 });
	expect(await service.list()).toEqual([]);
	expect((await runtime.connectors().get("notes"))?.removed).toBe(true);
	expect(service.resolve("mcp__notes__write_note")).toBeDefined();
	await expect(service.install({ ...install, requestId: "reinstall" })).rejects.toThrow("Reload");
});
it("starts disconnected with retained metadata and never replays a lost connect response", async () => {
	request.mockRejectedValueOnce(Error("transport lost"));
	expect(await service.install(install)).toMatchObject({ state: "needs_attention" });
	expect(await service.install(install)).toMatchObject({ revision: 1 });
	expect(request).toHaveBeenCalledTimes(1);
	await service.connect({ connectorId: "notes", requestId: "connect", expectedRevision: 1 });
	await service.close();
	await runtime.close();
	runtime = await BotRuntime.open({ databasePath: join(root, "pi.sqlite"), models: scriptedModels("Done").models });
	const before = request.mock.calls.length;
	service = new Connectors({
		runtime,
		targetId: "mac",
		port: { request },
		secrets,
		approvals: new ApprovalBook(() => {}),
		assertAllowed: () => {},
		change: (fn) => fn(),
		publish: async () => {},
		changed: () => {},
	});
	await service.start();
	expect(await service.list()).toMatchObject([{ state: "disconnected", revision: 2, tools: [tool] }]);
	expect(request).toHaveBeenCalledTimes(before);
});
it("keeps credential values out of persisted state and profiles and disconnects before replacement", async () => {
	const secret = "SYNTHETIC_HOST_CONNECTOR_8321";
	await service.install({ ...install, credentialEnv: "FIXTURE_TOKEN" });
	await service.credential({ connectorId: "notes", expectedRevision: 1, value: secret });
	expect(request.mock.calls.at(-1)?.[1]).toEqual({ action: "disconnect", connectorId: "notes" });
	expect(await secrets.getApiKey(CONNECTOR_CREDENTIAL_PREFIX + "notes")).toBe(secret);
	expect(JSON.stringify(await runtime.connectors().list())).not.toContain(secret);
	expect(JSON.stringify(await service.list())).not.toContain(secret);
	await service.connect({ connectorId: "notes", expectedRevision: 2, requestId: "reconnect" });
	expect(request.mock.calls.at(-1)?.[1]).toMatchObject({ action: "connect", credential: secret });
	await service.remove({ connectorId: "notes", expectedRevision: 3, requestId: "remove" });
	expect(await secrets.getApiKey(CONNECTOR_CREDENTIAL_PREFIX + "notes")).toBeUndefined();
});
it("requires matching current Run and captured tool identity, independently of annotation claims", async () => {
	await service.install(install);
	const run = { botId: "bot", state: "running", runId: "run" };
	vi.spyOn(runtime, "runsStore").mockReturnValue({ get: async () => run } as any);
	vi.spyOn(runtime, "conversationKey").mockResolvedValue("1");
	const call = {
		signal: new AbortController().signal,
		tool: "mcp__notes__write_note",
		botId: "bot",
		conversationId: "1",
		callId: "call",
		runId: "run",
		target: { kind: "local" as const, targetId: "mac" },
		args: { text: "approved" },
		connector: { connectorId: "notes", revision: 1, schemaHash: tool.schemaHash },
	};
	expect(await service.prepare(call)).toEqual({ kind: "ask", reason: "Use this connector tool" });
	for (const change of [
		{ botId: "other" },
		{ conversationId: "2" },
		{ connector: { ...call.connector, revision: 2 } },
		{ connector: { ...call.connector, schemaHash: "b" } },
		{ args: { text: 3 } },
		{ target: { kind: "local" as const, targetId: "other" } },
	])
		expect((await service.prepare({ ...call, ...change })).kind).toBe("deny");
	await service.disconnect({ connectorId: "notes", expectedRevision: 1, requestId: "stop" });
	expect((await service.prepare(call)).kind).toBe("deny");
});
it("keeps failed removal visible across restart and allows cleanup without reviving its identity", async () => {
	await service.install({ ...install, credentialEnv: "FIXTURE_TOKEN" });
	await secrets.setApiKey(CONNECTOR_CREDENTIAL_PREFIX + "notes", "SYNTHETIC_REMOVE_8192");
	request.mockRejectedValueOnce(Error("stop response lost"));
	await service.remove({ connectorId: "notes", expectedRevision: 1, requestId: "remove" });
	expect(await service.list()).toMatchObject([{ removed: true, state: "needs_attention" }]);
	await service.close();
	await runtime.close();
	runtime = await BotRuntime.open({ databasePath: join(root, "pi.sqlite"), models: scriptedModels("Done").models });
	service = new Connectors({
		runtime,
		targetId: "mac",
		port: { request },
		secrets,
		approvals: new ApprovalBook(() => {}),
		assertAllowed: () => {},
		change: (fn) => fn(),
		publish: async () => {},
		changed: () => {},
	});
	await service.start();
	expect(await service.list()).toMatchObject([{ removed: true, state: "needs_attention" }]);
	await expect(service.connect({ connectorId: "notes", expectedRevision: 2, requestId: "revive" })).rejects.toThrow("cannot reconnect");
	await service.remove({ connectorId: "notes", expectedRevision: 2, requestId: "cleanup" });
	expect(await service.list()).toEqual([]);
	expect(await secrets.getApiKey(CONNECTOR_CREDENTIAL_PREFIX + "notes")).toBeUndefined();
});
it("persists HTTPS definitions, routes only bearer credentials and never permits endpoint edits through reconnect", async () => {
	const input = {
		requestId: "https-install",
		connectorId: "https",
		name: "HTTPS",
		transport: "https" as const,
		endpoint: "https://service.example/mcp",
		auth: "bearer" as const,
	};
	await service.install(input);
	await service.credential({ connectorId: "https", expectedRevision: 1, value: "SYNTHETIC_BEARER_TOKEN" });
	await service.connect({ connectorId: "https", expectedRevision: 2, requestId: "https-connect" });
	expect(request.mock.calls.at(-1)?.[1]).toMatchObject({
		action: "connect",
		definition: { endpoint: input.endpoint, transport: "https", auth: "bearer", revision: 3 },
		credential: "SYNTHETIC_BEARER_TOKEN",
	});
	expect(JSON.stringify(await runtime.connectors().get("https"))).not.toContain("SYNTHETIC_BEARER_TOKEN");
	await service.install({ ...input, connectorId: "public", requestId: "public-install", auth: "none" });
	expect(request.mock.calls.at(-1)?.[1]).not.toHaveProperty("credential");
	await expect(service.credential({ connectorId: "public", expectedRevision: 1, value: "not-allowed-token" })).rejects.toThrow(
		"does not use a credential",
	);
	await expect(service.install({ ...input, endpoint: "https://other.example/mcp", requestId: "https-replace" })).rejects.toThrow("Reload");
	await service.close();
	await runtime.close();
	runtime = await BotRuntime.open({ databasePath: join(root, "pi.sqlite"), models: scriptedModels("Done").models });
	expect(await runtime.connectors().get("https")).toMatchObject({
		transport: "https",
		endpoint: input.endpoint,
		auth: "bearer",
		revision: 3,
	});
});

it("restores an HTTPS reconnect cooldown on startup through inspection only", async () => {
	await service.install({
		requestId: "install-https",
		connectorId: "https",
		name: "HTTPS",
		transport: "https",
		endpoint: "https://service.example/mcp",
		auth: "none",
	});
	await service.close();
	const retryAt = Date.now() + 60000;
	request.mockClear();
	request.mockResolvedValueOnce({ connectorId: "https", state: "disconnected", tools: [], retryAt });
	service = new Connectors({
		runtime,
		targetId: "mac",
		port: { request },
		secrets,
		approvals: new ApprovalBook(() => {}),
		assertAllowed: () => {},
		change: (fn) => fn(),
		publish: async () => {},
		changed: () => {},
	});
	await service.start();
	expect(request.mock.calls.map((call) => call[1])).toEqual([{ action: "inspect", connectorId: "https" }]);
	expect((await service.list())[0]).toMatchObject({ state: "disconnected", retryAt });
});
