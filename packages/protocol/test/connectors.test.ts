import { expect, it } from "vitest";
import {
	boundedConnectorJson,
	validConnectorSchema,
	validConnectorArguments,
	validConnectorControl,
	validConnectorDefinition,
} from "../src/index.ts";
import { paramsError } from "../src/schemas.ts";
it("bounds literal launch configuration and keeps private credentials off public install", () => {
	const definition = { connectorId: "notes", name: "Notes", command: "/usr/bin/node", args: [], revision: 1, targetId: "mac" };
	expect(validConnectorDefinition(definition)).toBe(true);
	for (const change of [
		{ command: "node" },
		{ credentialEnv: "NODE_OPTIONS" },
 {credentialEnv:"BASH_ENV"},
 {credentialEnv:"PYTHONPATH"},
		{ args: Array(9).fill("界".repeat(2048)) },
		{ targetId: "" },
		{ shell: true },
	])
		expect(validConnectorDefinition({ ...definition, ...change })).toBe(false);
	expect(validConnectorControl({ action: "connect", definition, credential: "synthetic-token" })).toBe(true);
	expect(validConnectorControl({ action: "disconnect", connectorId: "notes", credential: "extra" })).toBe(false);
	expect(
		paramsError("connectors.install", {
			requestId: "r",
			connectorId: "notes",
			name: "Notes",
			command: "/bin/true",
			args: [],
			credential: "secret",
		}),
	).toBeDefined();
	expect(
		paramsError("connectors.connect", { requestId: "r", connectorId: "notes", expectedRevision: 1, targetId: "forged" }),
	).toBeDefined();
});
it("rejects reference/regex/prototype schemas and validates finite bounded inputs", () => {
	const schema = {
		type: "object",
		properties: {
			name: { type: "string", maxLength: 3 },
			count: { type: "integer", minimum: 0 },
			mode: { anyOf: [{ const: "a" }, { const: "b" }] },
		},
		required: ["name", "count"],
		additionalProperties: false,
	};
	expect(validConnectorSchema(schema)).toBe(true);
	expect(validConnectorArguments(schema, { name: "x", count: 1, mode: "a" })).toBe(true);
	for (const value of [
		{ name: "long", count: 1 },
		{ name: "x", count: 1.5 },
		{ name: "x", count: -1 },
		{ name: "x", count: 1, mode: "z" },
		{ name: "x", count: 1, extra: true },
	])
		expect(validConnectorArguments(schema, value)).toBe(false);
	for (const change of [{ $ref: "file:///private/secret" }, { pattern: "(a+)+" }, { properties: { x: { $ref: "https://example.test" } } }])
		expect(validConnectorSchema({ ...schema, ...change })).toBe(false);
	expect(boundedConnectorJson(JSON.parse('{"__proto__":{}}'))).toBe(false);
	expect(boundedConnectorJson({ text: "x".repeat(33000) })).toBe(false);
	expect(boundedConnectorJson({ value: Infinity })).toBe(false);
});
