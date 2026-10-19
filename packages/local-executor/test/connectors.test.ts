import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ConnectorSupervisor, connectorEnvironment } from "../src/connectors.ts";
import { connectorToolName, type ConnectorDefinition } from "@openbot/protocol";
let root: string, supervisor: ConnectorSupervisor;
const fixture = resolve("packages/local-executor/test/fixtures/mcp-server.mjs");
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "openbot-mcp-"));
	supervisor = new ConnectorSupervisor(join(root, "processes.sqlite"), "local", root);
});
afterEach(async () => {
	await supervisor.close();
	await rm(root, { recursive: true, force: true });
});
const definition = (mode = "normal", id = "notes"): ConnectorDefinition => ({
	connectorId: id,
	name: "Notes",
	command: process.execPath,
	args: [fixture, mode, join(root, id + ".txt")],
	revision: 1,
	targetId: "local",
});
const invoke = async (name: string, text = "hello", id = "notes", signal = new AbortController().signal) => {
	const tool = supervisor.inspect(id).tools.find((t) => t.name === name)!;
	return supervisor.invoke({ connectorId: id, revision: 1, schemaHash: tool.schemaHash }, connectorToolName(id, name), { text }, signal);
};
it("validates tools and arguments, fences stale identities and stops on disconnect", async () => {
	expect((await supervisor.connect(definition())).state).toBe("connected");
	expect((await invoke("write_note", "saved")).status).toBe("succeeded");
	expect(await readFile(join(root, "notes.txt"), "utf8")).toBe("saved");
	const tool = supervisor.inspect("notes").tools[0]!;
	expect(
		(
			await supervisor.invoke(
				{ connectorId: "notes", revision: 2, schemaHash: tool.schemaHash },
				"mcp__notes__read_note",
				{ text: "x" },
				new AbortController().signal,
			)
		).status,
	).toBe("failed");
	expect(
		(
			await supervisor.invoke(
				{ connectorId: "notes", revision: 1, schemaHash: tool.schemaHash },
				"mcp__notes__read_note",
				{ text: "x", extra: true },
				new AbortController().signal,
			)
		).status,
	).toBe("failed");
	expect(await supervisor.disconnect("notes")).toBe(true);
	expect(supervisor.inspect("notes").state).toBe("disconnected");
});
it("injects one synthetic token only into its connector and redacts echoes and metadata", async () => {
	const secret = "SYNTHETIC_CONNECTOR_SENTINEL_2831";
	await supervisor.connect({ ...definition(), credentialEnv: "FIXTURE_TOKEN" }, secret);
	expect(JSON.stringify(supervisor.inspect("notes"))).not.toContain(secret);
	expect((await invoke("echo_token")).output).toBe("[redacted]");
	expect((await invoke("read_note")).output).toBe("token-present:true");
	await supervisor.connect(definition("normal", "other"));
	expect((await invoke("read_note", "x", "other")).output).toBe("token-present:false");
	expect(Object.values(connectorEnvironment())).not.toContain(secret);
});
it("refuses oversized frames and unsupported schemas without exposing raw server data", async () => {
	expect((await supervisor.connect(definition("oversize"))).state).toBe("needs_attention");
	expect((await supervisor.connect(definition("bad-schema"))).state).toBe("needs_attention");
	await expect(supervisor.connect({ ...definition(), targetId: "remote" })).rejects.toThrow("Invalid connector");
	await expect(supervisor.connect({ ...definition(), credentialEnv: "NODE_OPTIONS" }, "synthetic-token")).rejects.toThrow(
		"Invalid connector",
	);
});
it("records uncertain external effects honestly and never retries the call after response loss", async () => {
	await supervisor.connect(definition());
	expect((await invoke("lose_response")).status).toBe("unknown");
	expect(await readFile(join(root, "notes.txt"), "utf8")).toBe("effect\n");
	expect(supervisor.inspect("notes").state).toBe("needs_attention");
});
it("rejects server sampling requests and invalidates changed catalogs", async () => {
	await supervisor.connect(definition("request"));
	await expect.poll(async () => JSON.parse(await readFile(join(root, "notes.txt"), "utf8")).error?.code).toBe(-32601);
	expect((await invoke("invalidate")).status).toBe("unknown");
	expect(supervisor.inspect("notes").state).toBe("needs_attention");
});
it("cancels a dispatched call as unknown and terminates its supervised process", async () => {
	await supervisor.connect(definition());
	const controller = new AbortController();
	const pending = invoke("wait_forever", "x", "notes", controller.signal);
	setTimeout(() => controller.abort(), 50);
	expect((await pending).status).toBe("unknown");
	expect(await supervisor.disconnect("notes")).toBe(true);
});
it("rechecks queued connect authority and fences a connect that races quiescence", async () => {
	await expect(supervisor.connect(definition(), undefined, () => false)).rejects.toThrow("authority changed");
	expect(supervisor.inspect("notes").state).toBe("disconnected");
	const connecting = supervisor.connect(definition());
	const stopping = supervisor.stopAll();
	await connecting.catch(() => {});
	expect(await stopping).toBe(true);
	expect(supervisor.inspect("notes").state).toBe("disconnected");
});
it("replays durable successful and unknown receipts after disconnect without another external effect", async () => {
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
		await supervisor.connect(definition());
		const call = (tool: string, id: string) => ({
			invocationId: id,
			botId: "bot",
			conversationId: "conv",
			tool: `mcp__notes__${tool}` as const,
			args: { text: "saved" },
			argsDigest: id,
			target: { kind: "local" as const, targetId: "local" },
			grants: [],
			readGrants: [],
			deadline: Date.now() + 60000,
			connector: {
				connectorId: "notes",
				revision: 1,
				schemaHash: supervisor.inspect("notes").tools.find((t) => t.name === tool)!.schemaHash,
			},
		});
		const write = call("write_note", "write"),
			lost = call("lose_response", "lost");
		expect((await executor.invoke(write, () => {})).status).toBe("succeeded");
		expect((await executor.invoke(lost, () => {})).status).toBe("unknown");
		await supervisor.disconnect("notes");
		expect((await executor.invoke(write, () => {})).status).toBe("succeeded");
		expect((await executor.invoke(lost, () => {})).status).toBe("unknown");
		expect(await readFile(join(root, "notes.txt"), "utf8")).toBe("savedeffect\n");
		expect((await executor.invoke({ ...write, argsDigest: "changed" }, () => {})).status).toBe("failed");
	} finally {
		await executor.cancelAll();
		ledger.close();
	}
});
it("reaps a journaled orphan process group on reopen without signaling a reused identity", async () => {
	const { spawn } = await import("node:child_process"),
		{ DatabaseSync } = await import("node:sqlite"),
		{ processStartTime } = await import("../src/ledger.ts");
	const child = spawn(process.execPath, [fixture], { cwd: root, detached: true, stdio: ["pipe", "ignore", "ignore"] });
	const path = join(root, "orphan.sqlite");
	const initial = new ConnectorSupervisor(path, "local", root);
	await initial.close();
	const pid = child.pid!;
	const started = processStartTime(pid)!;
	expect(started).toBeTruthy();
	const write = (identity: string) => {
		const db = new DatabaseSync(path);
		db.prepare("insert or replace into connector_processes values(?,?,?)").run("notes", pid, identity);
		db.close();
	};
	let recovered: ConnectorSupervisor | undefined;
	try {
		write("different-start-identity");
		recovered = new ConnectorSupervisor(path, "local", root);
		expect(() => process.kill(pid, 0)).not.toThrow();
		await recovered.close();
		write(started);
		recovered = new ConnectorSupervisor(path, "local", root);
		await expect
			.poll(() => {
				try {
					process.kill(pid, 0);
					return false;
				} catch {
					return true;
				}
			})
			.toBe(true);
		await recovered.close();
		recovered = undefined;
	} finally {
		await recovered?.close();
		try {
			process.kill(-pid, "SIGKILL");
		} catch {}
		child.stdin.end();
	}
});
