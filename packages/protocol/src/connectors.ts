/** Local connector contracts. Secrets are carried only by private connection control, never public profiles. */
export const CONNECTOR_LIMITS = {
	installed: 10,
	retained: 512,
	receipts: 4096,
	tools: 100,
	pages: 5,
	catalogBytes: 262144,
	schemaBytes: 16384,
	frameBytes: 1048576,
	argumentBytes: 32768,
	outputBytes: 32768,
	handshakeMs: 10000,
	callMs: 60000,
	pending: 4,
} as const;
export const CONNECTOR_CREDENTIAL_PREFIX = "connector:";
export type ConnectorBinding = { readonly connectorId: string; readonly revision: number; readonly schemaHash: string };
export type ConnectorTransport =
	| {
			readonly transport?: "stdio";
			readonly command: string;
			readonly args: readonly string[];
			readonly credentialEnv?: string;
			readonly endpoint?: never;
			readonly auth?: never;
	  }
	| {
			readonly transport: "https";
			readonly endpoint: string;
			readonly auth: "none" | "bearer";
			readonly command?: never;
			readonly args?: never;
			readonly credentialEnv?: never;
	  };
export type ConnectorDefinition = ConnectorTransport & {
	readonly connectorId: string;
	readonly name: string;
	readonly revision: number;
	readonly targetId: string;
	readonly removed?: boolean;
};
export type ConnectorTool = {
	readonly name: string;
	readonly description: string;
	readonly inputSchema: Readonly<Record<string, unknown>>;
	readonly schemaHash: string;
};
export type ConnectorConnection = {
	readonly connectorId: string;
	readonly state: "disconnected" | "connected" | "needs_attention";
	readonly tools: readonly ConnectorTool[];
	readonly error?: string;
	readonly retryAt?: number;
};
export type ConnectorProfile = ConnectorDefinition & ConnectorConnection & { readonly credentialConfigured: boolean };
export type ConnectorControl =
	| { readonly action: "connect"; readonly definition: ConnectorDefinition; readonly credential?: string }
	| { readonly action: "disconnect" | "inspect"; readonly connectorId: string };
export function isConnectorId(value: unknown): value is string {
	return typeof value === "string" && /^[a-z][a-z0-9-]{0,31}$/.test(value);
}
export function isConnectorToolName(value: unknown): value is string {
	return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}
export function connectorToolName(id: string, name: string): `mcp__${string}` {
	return `mcp__${id}__${name}`;
}
export function isConnectorEnvironment(value: unknown): value is string {
	return (
		typeof value === "string" &&
		/^[A-Z][A-Z0-9_]{0,63}$/.test(value) &&
		!/^(PATH|HOME|USER|LOGNAME|SHELL|TMPDIR|LANG|LC_.*|TERM|BASH_ENV|ENV|ZDOTDIR|SHELLOPTS|BASHOPTS|PYTHON.*|RUBY.*|PERL.*|JAVA_TOOL_OPTIONS|JDK_JAVA_OPTIONS|_JAVA_OPTIONS|CLASSPATH|OPENSSL_CONF|SSL_CERT_FILE|SSL_CERT_DIR|NODE_.*|ELECTRON_.*|DYLD_.*|LD_.*|OPENBOT_.*)$/.test(
			value,
		)
	);
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function isConnectorEndpoint(value: unknown): value is string {
	if (
		typeof value !== "string" ||
		value.length > 2048 ||
		!/^https:\/\//.test(value) ||
		/^https:\/\/[^/]*@/.test(value) ||
		/[\s\\?#]/.test(value) ||
		/[\u0000-\u001f\u007f]/.test(value)
	)
		return false;
	try {
		const url = new URL(value);
		return url.protocol === "https:" && !!url.hostname && !url.username && !url.password && !url.search && !url.hash;
	} catch {
		return false;
	}
}
export function connectorNeedsCredential(value: ConnectorTransport): boolean {
	return value.transport === "https" ? value.auth === "bearer" : !!value.credentialEnv;
}
export function validConnectorDefinition(value: unknown): value is ConnectorDefinition {
	if (!object(value)) return false;
	const fields = ["connectorId", "name", "revision", "targetId", "removed", "transport"];
	if (value.transport === "https") {
		fields.push("endpoint", "auth");
		if (!isConnectorEndpoint(value.endpoint) || (value.auth !== "none" && value.auth !== "bearer")) return false;
	} else {
		fields.push("command", "args", "credentialEnv");
		if (value.transport !== undefined && value.transport !== "stdio") return false;
		if (
			typeof value.command !== "string" ||
			!value.command.startsWith("/") ||
			value.command.length > 4096 ||
			value.command.includes("\0") ||
			!Array.isArray(value.args) ||
			value.args.length > 32 ||
			!value.args.every((arg) => typeof arg === "string" && arg.length <= 2048 && !arg.includes("\0")) ||
			new TextEncoder().encode(value.args.join("")).length > 16384 ||
			(value.credentialEnv !== undefined && !isConnectorEnvironment(value.credentialEnv))
		)
			return false;
	}
	return (
		Object.keys(value).every((key) => fields.includes(key)) &&
		isConnectorId(value.connectorId) &&
		typeof value.name === "string" &&
		value.name.trim().length > 0 &&
		value.name.length <= 80 &&
		Number.isSafeInteger(value.revision) &&
		(value.revision as number) > 0 &&
		typeof value.targetId === "string" &&
		value.targetId.length > 0 &&
		value.targetId.length <= 256 &&
		(value.removed === undefined || typeof value.removed === "boolean")
	);
}
export function boundedConnectorJson(value: unknown, bytes: number = CONNECTOR_LIMITS.argumentBytes, nodes = 1024): boolean {
	let count = 0;
	const walk = (item: unknown, depth: number): boolean => {
		if (++count > nodes || depth > 12) return false;
		if (item === null || typeof item === "string" || typeof item === "boolean") return true;
		if (typeof item === "number") return Number.isFinite(item);
		if (Array.isArray(item)) return item.every((entry) => walk(entry, depth + 1));
		if (!object(item) || Object.getPrototypeOf(item) !== Object.prototype) return false;
		return Object.entries(item).every(([key, entry]) => !["__proto__", "constructor", "prototype"].includes(key) && walk(entry, depth + 1));
	};
	try {
		return walk(value, 0) && new TextEncoder().encode(JSON.stringify(value)).length <= bytes;
	} catch {
		return false;
	}
}
const keywords = new Set([
	"$schema",
	"type",
	"properties",
	"required",
	"additionalProperties",
	"items",
	"enum",
	"const",
	"title",
	"description",
	"minimum",
	"maximum",
	"minLength",
	"maxLength",
	"minItems",
	"maxItems",
	"anyOf",
]);
/** A finite, reference-free schema subset shared by registration and executor validation. */
export function validConnectorSchema(schema: unknown): schema is Readonly<Record<string, unknown>> {
	if (!object(schema) || schema.type !== "object" || !boundedConnectorJson(schema, CONNECTOR_LIMITS.schemaBytes, 256)) return false;
	const walk = (node: unknown): boolean => {
		if (!object(node) || Object.keys(node).some((key) => !keywords.has(key))) return false;
		if (
			node.$schema !== undefined &&
			!["http://json-schema.org/draft-07/schema#", "https://json-schema.org/draft/2020-12/schema"].includes(String(node.$schema))
		)
			return false;
		if (node.type !== undefined && !["object", "array", "string", "number", "integer", "boolean", "null"].includes(String(node.type)))
			return false;
		if (node.type === undefined && !Array.isArray(node.anyOf) && node.const === undefined && !Array.isArray(node.enum)) return false;
		for (const key of ["title", "description"]) if (node[key] !== undefined && typeof node[key] !== "string") return false;
		for (const key of ["minimum", "maximum"])
			if (node[key] !== undefined && (typeof node[key] !== "number" || !Number.isFinite(node[key]))) return false;
		for (const key of ["minLength", "maxLength", "minItems", "maxItems"])
			if (node[key] !== undefined && (!Number.isSafeInteger(node[key]) || (node[key] as number) < 0)) return false;
		if (
			node.required !== undefined &&
			(!Array.isArray(node.required) ||
				!node.required.every((key) => typeof key === "string") ||
				new Set(node.required).size !== node.required.length)
		)
			return false;
		if (node.additionalProperties !== undefined && typeof node.additionalProperties !== "boolean") return false;
		if (node.properties !== undefined && (!object(node.properties) || !Object.values(node.properties).every(walk))) return false;
		if (node.items !== undefined && !walk(node.items)) return false;
		if (node.enum !== undefined && (!Array.isArray(node.enum) || !node.enum.length)) return false;
		return (
			node.anyOf === undefined || (Array.isArray(node.anyOf) && node.anyOf.length > 0 && node.anyOf.length <= 4 && node.anyOf.every(walk))
		);
	};
	return walk(schema);
}
export function validConnectorArguments(schema: Readonly<Record<string, unknown>>, value: unknown): boolean {
	if (!boundedConnectorJson(value) || !validConnectorSchema(schema)) return false;
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
	const equal = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);
	const check = (node: Readonly<Record<string, unknown>>, item: unknown): boolean => {
		if (node.const !== undefined && !equal(node.const, item)) return false;
		if (Array.isArray(node.enum) && !node.enum.some((option) => equal(option, item))) return false;
		if (Array.isArray(node.anyOf) && !node.anyOf.some((option) => check(option, item))) return false;
		switch (node.type) {
			case "object": {
				if (!object(item)) return false;
				const properties = (node.properties ?? {}) as Record<string, Readonly<Record<string, unknown>>>;
				if ((node.required as string[] | undefined)?.some((key) => !Object.hasOwn(item, key))) return false;
				return Object.entries(item).every(([key, entry]) =>
					properties[key] ? check(properties[key], entry) : node.additionalProperties !== false,
				);
			}
			case "array":
				return (
					Array.isArray(item) &&
					(node.minItems === undefined || item.length >= Number(node.minItems)) &&
					(node.maxItems === undefined || item.length <= Number(node.maxItems)) &&
					(!node.items || item.every((entry) => check(node.items as Record<string, unknown>, entry)))
				);
			case "string":
				return (
					typeof item === "string" &&
					(node.minLength === undefined || Array.from(item).length >= Number(node.minLength)) &&
					(node.maxLength === undefined || Array.from(item).length <= Number(node.maxLength))
				);
			case "integer":
			case "number":
				return (
					typeof item === "number" &&
					Number.isFinite(item) &&
					(node.type !== "integer" || Number.isInteger(item)) &&
					(node.minimum === undefined || item >= Number(node.minimum)) &&
					(node.maximum === undefined || item <= Number(node.maximum))
				);
			case "boolean":
				return typeof item === "boolean";
			case "null":
				return item === null;
			default:
				return true;
		}
	};
	return check(schema, value);
}

export type ConnectorInstall = ConnectorTransport & {
	readonly requestId: string;
	readonly connectorId: string;
	readonly name: string;
};
export type ConnectorChange = { readonly requestId: string; readonly connectorId: string; readonly expectedRevision: number };
export const CONNECTOR_SEARCH_DEFINITION = {
	name: "tool_search",
	description: "Find installed connector tools. Search before calling a connector; discovery never grants permission.",
	parameters: {
		type: "object",
		properties: { query: { type: "string", minLength: 1, maxLength: 512 }, limit: { type: "integer", minimum: 1, maximum: 8 } },
		required: ["query"],
		additionalProperties: false,
	},
	capability: "connectors.discovery",
	destination: "host",
} as const;

export function validConnectorControl(value: unknown): value is ConnectorControl {
	if (!object(value)) return false;
	if (value.action === "connect")
		return (
			Object.keys(value).every((key) => ["action", "definition", "credential"].includes(key)) &&
			validConnectorDefinition(value.definition) &&
			(value.credential === undefined ||
				(typeof value.credential === "string" &&
					value.credential.length >= 8 &&
					value.credential.length <= 8192 &&
					!/[\r\n\0]/.test(value.credential)))
		);
	return (
		(value.action === "disconnect" || value.action === "inspect") && Object.keys(value).length === 2 && isConnectorId(value.connectorId)
	);
}
