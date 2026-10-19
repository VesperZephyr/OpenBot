/** User-managed connector lifecycle. Model calls can discover/use tools, never install programs or supply credentials. */
import { createHash, randomUUID } from "node:crypto";
import type { BotRuntime } from "@openbot/agent-runtime";
import {
	CONNECTOR_CREDENTIAL_PREFIX,
	CONNECTOR_SEARCH_DEFINITION,
	ProtocolError,
	connectorToolName,
	validConnectorArguments,
	validConnectorDefinition,
	type ConnectorChange,
	type ConnectorConnection,
	type ConnectorControl,
	type ConnectorDefinition,
	type ConnectorInstall,
	type ConnectorProfile,
	type ToolDefinition,
} from "@openbot/protocol";
import type { ManagementCall } from "./bot-management.ts";
import type { ApprovalBook, Decision } from "./approvals.ts";
import type { SecretStore } from "./index.ts";
export interface ConnectorPort {
	request(requestId: string, operation: ConnectorControl, revision: number): Promise<ConnectorConnection>;
}
type Options = {
	runtime: BotRuntime;
	targetId: string;
	port?: ConnectorPort;
	secrets: SecretStore;
	approvals: ApprovalBook;
	assertAllowed: () => void;
	change: <T>(work: () => Promise<T>) => Promise<T>;
	publish: (definitions: readonly ToolDefinition[], available: ReadonlySet<string>) => Promise<void>;
	changed: () => void;
};
const fail = (message: string): never => {
	throw new ProtocolError("invalid_request", message);
};
const definition = (record: ConnectorDefinition): ConnectorDefinition => ({
	connectorId: record.connectorId,
	name: record.name,
	command: record.command,
	args: record.args,
	revision: record.revision,
	targetId: record.targetId,
	...(record.credentialEnv ? { credentialEnv: record.credentialEnv } : {}),
	...(record.removed ? { removed: true } : {}),
});
export class Connectors {
	readonly #options: Options;
	readonly #states = new Map<string, ConnectorConnection>();
	readonly #definitions = new Map<string, ToolDefinition>();
	readonly #available = new Set<string>();
	#line: Promise<unknown> = Promise.resolve();
	#closed = false;
	constructor(options: Options) {
		this.#options = options;
	}
	#serial<T>(work: () => Promise<T>): Promise<T> {
		const next = this.#line.catch(() => {}).then(work);
		this.#line = next;
		return next;
	}
	async start() {
		await this.#publish();
	}
	async close() {
		this.#closed = true;
		await this.#line.catch(() => {});
	}
	resolve(name: string): ToolDefinition | undefined {
		return name === "tool_search" ? CONNECTOR_SEARCH_DEFINITION : this.#definitions.get(name);
	}
	async list(): Promise<ConnectorProfile[]> {
		const credentials = await this.#options.secrets.configuredProviders();
		return (await this.#options.runtime.connectors().list())
			.filter((record) => !record.removed || record.cleanupPending)
			.map((record) => ({
				...record,
				...(record.cleanupPending
					? { state: "needs_attention" as const, error: "Connector removal needs attention. Retry removal to finish cleanup." }
					: (this.#states.get(record.connectorId) ?? { state: "disconnected" as const })),
				tools: record.tools,
				credentialConfigured: credentials.has(CONNECTOR_CREDENTIAL_PREFIX + record.connectorId),
			}));
	}
	async #publish(): Promise<void> {
		this.#definitions.clear();
		this.#available.clear();
		for (const record of await this.#options.runtime.connectors().list())
			for (const tool of record.tools) {
				const name = connectorToolName(record.connectorId, tool.name),
					active = !record.removed && this.#states.get(record.connectorId)?.state === "connected";
				this.#definitions.set(name, {
					name,
					description: active ? tool.description : `Unavailable connector tool. ${tool.description}`,
					parameters: tool.inputSchema,
					capability: "connectors",
					destination: "executor",
					deferred: true,
					connector: { connectorId: record.connectorId, revision: record.revision, schemaHash: tool.schemaHash },
				});
				if (active) this.#available.add(name);
			}
		await this.#options.publish([...this.#definitions.values()], this.#available);
		this.#options.changed();
	}
	refresh(id: string): Promise<void> {
		return this.#serial(async () => {
			if (this.#closed) return;
			const record = await this.#options.runtime.connectors().get(id);
			if (!record || record.removed || !this.#options.port) return;
			const state = await this.#control({ action: "inspect", connectorId: id });
			this.#states.set(id, state);
			await this.#publish();
		});
	}
	async #control(operation: ConnectorControl): Promise<ConnectorConnection> {
		if (!this.#options.port) fail("Connector executor is unavailable");
		return this.#options.port!.request(randomUUID(), operation, (await this.#options.runtime.policy().settings()).revision ?? 0);
	}
	async #invalidate(id: string): Promise<void> {
		this.#states.set(id, { connectorId: id, state: "disconnected", tools: [] });
		await this.#publish();
		await this.#options.approvals.reevaluate((approval) =>
			approval.tool.startsWith(`mcp__${id}__`)
				? { kind: "deny", reason: "Connector changed or disconnected" }
				: {
						kind: "ask",
						reason: approval.reason,
						...(approval.alwaysAllowOptions ? { alwaysAllowOptions: approval.alwaysAllowOptions } : {}),
					},
		);
	}
	install(input: ConnectorInstall): Promise<ConnectorProfile> {
		return this.#mutate("install", { ...input, expectedRevision: 0 });
	}
	connect(input: ConnectorChange): Promise<ConnectorProfile> {
		return this.#mutate("connect", input);
	}
	disconnect(input: ConnectorChange): Promise<ConnectorProfile> {
		return this.#mutate("disconnect", input);
	}
	remove(input: ConnectorChange): Promise<ConnectorProfile> {
		return this.#mutate("remove", input);
	}
	#mutate(
		action: "install" | "connect" | "disconnect" | "remove",
		input: ConnectorChange | (ConnectorInstall & { expectedRevision: number }),
	): Promise<ConnectorProfile> {
		return this.#serial(async () => {
			if (this.#closed) fail("Host is stopping");
			if (action === "install" || action === "connect") this.#options.assertAllowed();
			const store = this.#options.runtime.connectors(),
				existing = await store.get(input.connectorId);
			if (existing?.removed && action === "connect") fail("Removed connectors cannot reconnect");
			const record =
				action === "install"
					? {
							connectorId: input.connectorId,
							name: (input as ConnectorInstall).name,
							command: (input as ConnectorInstall).command,
							args: (input as ConnectorInstall).args,
							...((input as ConnectorInstall).credentialEnv ? { credentialEnv: (input as ConnectorInstall).credentialEnv } : {}),
							revision: 1,
							targetId: this.#options.targetId,
						}
					: existing
						? { ...definition(existing), revision: existing.revision + 1, ...(action === "remove" ? { removed: true } : {}) }
						: undefined;
			if (!record || !validConnectorDefinition(record)) throw new ProtocolError("invalid_request", "Invalid connector definition");
			const fingerprint = createHash("sha256").update(JSON.stringify({ action, input })).digest("hex"),
				requestId = `connector:${input.requestId}`;
			const fresh = await this.#options.change(() => store.begin(requestId, fingerprint, record, input.expectedRevision));
			if (fresh) {
				await this.#invalidate(input.connectorId);
				try {
					if (action === "connect" || action === "install") {
						const credential = record.credentialEnv
							? await this.#options.secrets.getApiKey(CONNECTOR_CREDENTIAL_PREFIX + input.connectorId)
							: undefined;
						this.#options.assertAllowed();
						const connected = await this.#control({ action: "connect", definition: record, ...(credential ? { credential } : {}) });
						this.#states.set(input.connectorId, connected);
						await store.finish(requestId, connected.state === "connected" ? connected.tools : undefined);
					} else {
						const stopped = await this.#control({ action: "disconnect", connectorId: input.connectorId });
						this.#states.set(input.connectorId, stopped);
						if (stopped.state !== "disconnected") throw Error("Connector termination needs attention");
						if (record.removed) await this.#options.secrets.deleteApiKey(CONNECTOR_CREDENTIAL_PREFIX + input.connectorId);
						await store.finish(requestId);
					}
				} catch {
					this.#states.set(input.connectorId, {
						connectorId: input.connectorId,
						state: "needs_attention",
						tools: [],
						error: "Connector change could not be confirmed. Review its state before reconnecting.",
					});
				}
				await this.#publish();
			}
			const current = (await store.get(input.connectorId))!,
				credentials = await this.#options.secrets.configuredProviders();
			return {
				...current,
				...(this.#states.get(input.connectorId) ?? { state: "disconnected" as const }),
				tools: current.tools,
				credentialConfigured: credentials.has(CONNECTOR_CREDENTIAL_PREFIX + input.connectorId),
			};
		});
	}
	credential(input: { connectorId: string; expectedRevision: number; value?: string }): Promise<ConnectorProfile> {
		return this.#serial(async () => {
			if (input.value !== undefined && (input.value.length < 8 || input.value.length > 8192 || /[\r\n\0]/.test(input.value)))
				fail("Invalid connector credential");
			const store = this.#options.runtime.connectors(),
				record = await store.get(input.connectorId);
			if (!record || record.removed || !record.credentialEnv) fail("Connector does not declare a credential variable");
			const requestId = `credential:${randomUUID()}`;
			await this.#options.change(() =>
				store.begin(requestId, requestId, { ...definition(record!), revision: record!.revision + 1 }, input.expectedRevision),
			);
			await this.#invalidate(input.connectorId);
			const stopped = await this.#control({ action: "disconnect", connectorId: input.connectorId });
			this.#states.set(input.connectorId, stopped);
			if (stopped.state !== "disconnected") fail("Connector termination needs attention");
			if (input.value === undefined) await this.#options.secrets.deleteApiKey(CONNECTOR_CREDENTIAL_PREFIX + input.connectorId);
			else await this.#options.secrets.setApiKey(CONNECTOR_CREDENTIAL_PREFIX + input.connectorId, input.value);
			await store.finish(requestId);
			await this.#publish();
			return (await this.list()).find((item) => item.connectorId === input.connectorId)!;
		});
	}
	async prepare(call: ManagementCall & { connector?: import("@openbot/protocol").ConnectorBinding }): Promise<Decision> {
		if (call.target?.kind !== "local" || call.target.targetId !== this.#options.targetId)
			return { kind: "deny", reason: "Connector target is unavailable" };
		const run = call.runId ? await this.#options.runtime.runsStore().get(call.runId) : undefined;
		if (
			!run ||
			run.state !== "running" ||
			run.botId !== call.botId ||
			run.interruption ||
			(await this.#options.runtime.conversationKey(run.botId, run.channelId)) !== call.conversationId
		)
			return { kind: "deny", reason: "Connector call has no active task authority" };
		if (call.tool === "tool_search")
			return typeof call.args.query === "string" &&
				call.args.query.trim().length > 0 &&
				call.args.query.length <= 512 &&
				(call.args.limit === undefined ||
					(Number.isSafeInteger(call.args.limit) && Number(call.args.limit) > 0 && Number(call.args.limit) <= 8))
				? { kind: "allow" }
				: { kind: "deny", reason: "Invalid tool discovery query" };
		const tool = this.#definitions.get(call.tool);
		const current = tool?.connector ? await this.#options.runtime.connectors().get(tool.connector.connectorId) : undefined;
		if (
			!tool ||
			!current ||
			current.removed ||
			current.revision !== tool.connector?.revision ||
			!this.#available.has(call.tool) ||
			!call.connector ||
			call.connector.connectorId !== tool.connector?.connectorId ||
			call.connector.revision !== tool.connector?.revision ||
			call.connector.schemaHash !== tool.connector?.schemaHash ||
			!validConnectorArguments(tool.parameters, call.args)
		)
			return { kind: "deny", reason: "Connector is disconnected or its reviewed tool changed" };
		return { kind: "ask", reason: "Use this connector tool" };
	}
	async assertExecution(call: ManagementCall & { connector?: import("@openbot/protocol").ConnectorBinding }): Promise<void> {
		if (call.tool === "tool_search" || call.tool.startsWith("mcp__")) {
			const decision = await this.prepare(call);
			if (decision.kind === "deny") fail(decision.reason);
		}
	}
}
