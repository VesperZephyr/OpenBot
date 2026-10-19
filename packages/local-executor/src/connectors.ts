/** Executor-owned MCP sessions. The Host supplies reviewed definitions; only this process receives connector tokens. */
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
	CONNECTOR_LIMITS,
	boundedConnectorJson,
	connectorToolName,
	validConnectorArguments,
	validConnectorDefinition,
	validConnectorSchema,
	isConnectorToolName,
	type ConnectorBinding,
	type ConnectorConnection,
	type ConnectorDefinition,
	type ConnectorTool,
	type ToolOutcome,
} from "@openbot/protocol";
import { killOrphanGroup, processStartTime } from "./ledger.ts";
import { McpError, McpStdio } from "./mcp-stdio.ts";
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const canonical = (value: unknown): string =>
	JSON.stringify(value, (_key, item) =>
		object(item)
			? Object.fromEntries(
					Object.keys(item)
						.sort()
						.map((key) => [key, item[key]]),
				)
			: item,
	);
type Entry = {
	definition: ConnectorDefinition;
	connection: ConnectorConnection;
	session: McpStdio;
	credential?: string;
	valid: boolean;
	epoch: number;
};
type ProcessRow = { connector_id: string; pgid: number; started: string };
export function connectorEnvironment(credentialEnv?: string, credential?: string): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const key of ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL"])
		if (process.env[key] !== undefined) env[key] = process.env[key];
	if (credentialEnv && credential) env[credentialEnv] = credential;
	return env;
}
export class ConnectorSupervisor {
	readonly #db: DatabaseSync;
	readonly #entries = new Map<string, Entry>();
	readonly #targetId: string;
	readonly #workspace: string;
	readonly #changed: (id: string) => void;
	#closed = false;
	#generation = 0;
	#line: Promise<unknown> = Promise.resolve();
	#serial<T>(work: () => Promise<T>): Promise<T> {
		const next = this.#line.catch(() => {}).then(work);
		this.#line = next;
		return next;
	}
	constructor(path: string, targetId: string, workspace: string, changed: (id: string) => void = () => {}) {
		this.#targetId = targetId;
		this.#workspace = workspace;
		this.#changed = changed;
		this.#db = new DatabaseSync(path);
		this.#db.exec(
			"pragma journal_mode=wal; pragma synchronous=full; create table if not exists connector_processes(connector_id text primary key,pgid integer not null,started text not null)",
		);
		for (const row of this.#db.prepare("select * from connector_processes").all() as ProcessRow[]) killOrphanGroup(row.pgid, row.started);
	}
	inspect(id: string): ConnectorConnection {
		return this.#entries.get(id)?.connection ?? { connectorId: id, state: "disconnected", tools: [] };
	}
	connect(definition: ConnectorDefinition, credential?: string, authorized: () => boolean = () => true): Promise<ConnectorConnection> {
		const generation = this.#generation;
		return this.#serial(() => {
			if (generation !== this.#generation || !authorized()) throw Error("Connector authority changed");
			return this.#connect(definition, credential, () => generation === this.#generation && authorized());
		});
	}
	async #connect(definition: ConnectorDefinition, credential: string | undefined, authorized: () => boolean): Promise<ConnectorConnection> {
		const id = definition.connectorId;
		if (this.#closed || !validConnectorDefinition(definition) || definition.targetId !== this.#targetId || definition.removed)
			throw Error("Invalid connector definition");
		if (credential !== undefined && (credential.length < 8 || credential.length > 8192 || /[\r\n\0]/.test(credential)))
			throw Error("Invalid connector credential");
		if (!(await this.#disconnect(id))) throw Error("Connector termination needs attention");
		if (definition.credentialEnv && !credential)
			return { connectorId: id, state: "needs_attention", tools: [], error: "Add the connector credential before connecting" };
		if (this.#entries.size >= CONNECTOR_LIMITS.installed) throw Error("Connector capacity reached");
		const orphan = this.#db.prepare("select * from connector_processes where connector_id=?").get(id) as ProcessRow | undefined;
		if (orphan) {
			const started = processStartTime(orphan.pgid);
			let alive = false;
			try {
				process.kill(-orphan.pgid, 0);
				alive = true;
			} catch {}
			if (alive && (started === undefined || started === orphan.started)) throw Error("Connector termination needs attention");
			this.#db.prepare("delete from connector_processes where connector_id=?").run(id);
		}
		if (!authorized()) throw Error("Connector authority changed");
		const session = new McpStdio(
			definition.command,
			definition.args,
			this.#workspace,
			connectorEnvironment(definition.credentialEnv, credential),
			() => {
				const entry = this.#entries.get(id);
				if (entry?.session !== session) return;
				entry.epoch++;
				if (!entry.valid && entry.connection.state === "needs_attention") return;
				entry.valid = false;
				entry.connection = {
					connectorId: id,
					state: "needs_attention",
					tools: [],
					error: "Connector changed or disconnected. Connect again to review its tools.",
				};
				this.#changed(id);
				void session.stop();
			},
		);
		const entry: Entry = {
			definition,
			session,
			valid: false,
			epoch: 0,
			connection: { connectorId: id, state: "disconnected", tools: [] },
			...(credential ? { credential } : {}),
		};
		this.#entries.set(id, entry);
		try {
			const pid = session.child.pid,
				started = pid ? processStartTime(pid) : undefined;
			if (!pid || !started) throw Error("Connector did not start");
			this.#db.prepare("insert or replace into connector_processes values(?,?,?)").run(id, pid, started);
			const deadline = Date.now() + CONNECTOR_LIMITS.handshakeMs;
			const remaining = () => {
				const ms = deadline - Date.now();
				if (ms <= 0) throw Error("Connector handshake timed out");
				return ms;
			};
			const initialized = await session.request(
				"initialize",
				{ protocolVersion: "2025-11-25", clientInfo: { name: "OpenBot", version: "0.0.0" }, capabilities: {} },
				remaining(),
			);
			if (
				!object(initialized) ||
				initialized.protocolVersion !== "2025-11-25" ||
				!object(initialized.capabilities) ||
				!object(initialized.capabilities.tools)
			)
				throw Error("Unsupported connector protocol");
			session.notify("notifications/initialized");
			const epoch = entry.epoch;
			const tools: ConnectorTool[] = [];
			let cursor: string | undefined;
			const cursors = new Set<string>();
			for (let page = 0; page < CONNECTOR_LIMITS.pages; page++) {
				const response = this.#redact(await session.request("tools/list", cursor ? { cursor } : {}, remaining()), credential);
				if (!object(response) || !Array.isArray(response.tools)) throw Error("Invalid connector catalog");
				for (const item of response.tools) {
					if (
						!object(item) ||
						!isConnectorToolName(item.name) ||
						(item.description !== undefined && (typeof item.description !== "string" || item.description.length > 2048)) ||
						!validConnectorSchema(item.inputSchema) ||
						tools.some((t) => t.name === item.name)
					)
						throw Error("Unsupported connector tool schema");
					const tool = {
						name: item.name,
						description: typeof item.description === "string" ? item.description : "",
						inputSchema: item.inputSchema,
					};
					tools.push({ ...tool, schemaHash: createHash("sha256").update(canonical(tool)).digest("hex") });
				}
				if (tools.length > CONNECTOR_LIMITS.tools || Buffer.byteLength(JSON.stringify(tools)) > CONNECTOR_LIMITS.catalogBytes)
					throw Error("Connector catalog exceeds limits");
				if (response.nextCursor === undefined) {
					cursor = undefined;
					break;
				}
				if (typeof response.nextCursor !== "string" || response.nextCursor.length > 1024 || cursors.has(response.nextCursor))
					throw Error("Invalid connector cursor");
				cursor = response.nextCursor;
				cursors.add(cursor);
			}
			if (cursor !== undefined || session.closed || entry.epoch !== epoch || !authorized()) throw Error("Connector catalog is incomplete");
			entry.valid = true;
			entry.connection = { connectorId: id, state: "connected", tools };
			this.#changed(id);
			return entry.connection;
		} catch {
			const stopped = await session.stop();
			if (stopped) this.#db.prepare("delete from connector_processes where connector_id=?").run(id);
			entry.valid = false;
			delete entry.credential;
			entry.connection = {
				connectorId: id,
				state: "needs_attention",
				tools: [],
				error: stopped
					? "Connector could not connect. Check its executable, credential and supported tools."
					: "Connector termination needs attention",
			};
			this.#changed(id);
			return entry.connection;
		}
	}
	async invoke(
		binding: ConnectorBinding,
		name: string,
		args: Readonly<Record<string, unknown>>,
		signal: AbortSignal,
	): Promise<ToolOutcome> {
		const entry = this.#entries.get(binding.connectorId),
			tool = entry?.connection.tools.find((t) => connectorToolName(binding.connectorId, t.name) === name);
		if (!entry?.valid || entry.session.closed || entry.definition.revision !== binding.revision || tool?.schemaHash !== binding.schemaHash)
			return { status: "failed", output: "Connector is disconnected or its reviewed tool changed" };
		if (!validConnectorArguments(tool.inputSchema, args)) return { status: "failed", output: "Invalid connector arguments" };
		try {
			const result = this.#redact(
				await entry.session.request("tools/call", { name: tool.name, arguments: args }, CONNECTOR_LIMITS.callMs, signal),
				entry.credential,
			);
			if (
				!object(result) ||
				!Array.isArray(result.content) ||
				result.content.some((item) => !object(item) || item.type !== "text" || typeof item.text !== "string") ||
				(result.isError !== undefined && typeof result.isError !== "boolean") ||
				(result.structuredContent !== undefined && !boundedConnectorJson(result.structuredContent, CONNECTOR_LIMITS.frameBytes))
			)
				return { status: "unknown", output: "Unsupported connector result; inspect effects before retrying" };
			const text = [
				...result.content.map((item) => (item as { text: string }).text),
				...(result.structuredContent !== undefined ? [JSON.stringify(result.structuredContent)] : []),
			].join("\n");
			const bytes = Buffer.from(text),
				truncated = bytes.length > CONNECTOR_LIMITS.outputBytes;
			let end = Math.min(bytes.length, CONNECTOR_LIMITS.outputBytes - (truncated ? 64 : 0));
			while (end > 0 && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
			return {
				status: result.isError ? "failed" : "succeeded",
				output: bytes.subarray(0, end).toString("utf8") + (truncated ? "\n[Connector output truncated]" : ""),
				...(truncated ? { truncated: true } : {}),
			};
		} catch (error) {
			return {
				status: error instanceof McpError && !error.sent ? "failed" : "unknown",
				output: "Connector call did not produce a confirmed result; inspect effects before retrying",
			};
		}
	}
	#redact(value: unknown, secret?: string): unknown {
		let nodes = 0;
		const walk = (item: unknown, depth: number): unknown => {
			if (++nodes > 20000 || depth > 32) throw Error("Connector response exceeds limits");
			if (typeof item === "string") return secret ? item.replaceAll(secret, "[redacted]") : item;
			if (Array.isArray(item)) return item.map((entry) => walk(entry, depth + 1));
			if (object(item))
				return Object.fromEntries(
					Object.entries(item).map(([key, entry]) => [secret ? key.replaceAll(secret, "[redacted]") : key, walk(entry, depth + 1)]),
				);
			return item;
		};
		return walk(value, 0);
	}

	disconnect(id: string): Promise<boolean> {
		return this.#serial(() => this.#disconnect(id));
	}
	async #disconnect(id: string): Promise<boolean> {
		const entry = this.#entries.get(id);
		if (!entry) {
			const row = this.#db.prepare("select * from connector_processes where connector_id=?").get(id) as ProcessRow | undefined;
			if (!row) return true;
			killOrphanGroup(row.pgid, row.started);
			await new Promise((resolve) => setTimeout(resolve, 200));
			const started = processStartTime(row.pgid);
			if (started === undefined || started === row.started) {
				try {
					process.kill(-row.pgid, 0);
					return false;
				} catch {}
			}
			this.#db.prepare("delete from connector_processes where connector_id=?").run(id);
			return true;
		}
		entry.valid = false;
		const stopped = await entry.session.stop();
		delete entry.credential;
		if (stopped) {
			this.#db.prepare("delete from connector_processes where connector_id=?").run(id);
			this.#entries.delete(id);
		} else entry.connection = { connectorId: id, state: "needs_attention", tools: [], error: "Connector termination needs attention" };
		this.#changed(id);
		return stopped;
	}
	async stopAll(): Promise<boolean> {
		this.#generation++;
		await this.#line.catch(() => {});
		const ids = new Set([
			...this.#entries.keys(),
			...(this.#db.prepare("select connector_id from connector_processes").all() as { connector_id: string }[]).map(
				(row) => row.connector_id,
			),
		]);
		return (await Promise.all([...ids].map((id) => this.disconnect(id)))).every(Boolean);
	}
	async close(): Promise<void> {
		this.#closed = true;
		await this.stopAll();
		this.#db.close();
	}
}
