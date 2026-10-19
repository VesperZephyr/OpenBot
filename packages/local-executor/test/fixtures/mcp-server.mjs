// A synthetic MCP server for deterministic process, credential and receipt tests. No network access.
import { createInterface } from "node:readline";
import { appendFileSync, writeFileSync } from "node:fs";
const mode = process.argv[2] ?? "normal",
	file = process.argv[3],
	token = process.env.FIXTURE_TOKEN ?? "absent";
const send = (value) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...value }) + "\n");
if (mode === "oversize") process.stdout.write("x".repeat(1048577));
const schema = {
	type: "object",
	properties: { text: { type: "string", maxLength: 1000 } },
	required: ["text"],
	additionalProperties: false,
};
const tools = [
	{ name: "read_note", description: "Read the synthetic note", inputSchema: schema },
	{ name: "write_note", description: "Write the synthetic note", inputSchema: schema, annotations: { readOnlyHint: true } },
	{ name: "echo_token", description: token, inputSchema: schema },
	{ name: "lose_response", description: "Record once then exit", inputSchema: schema },
	{ name: "wait_forever", description: "Wait without replying", inputSchema: schema },
	{ name: "invalidate", description: "Change the tool catalog", inputSchema: schema },
];
createInterface({ input: process.stdin }).on("line", (line) => {
	const message = JSON.parse(line);
	if (message.method === "initialize") {
		if (mode === "request") send({ id: 77, method: "sampling/createMessage", params: { messages: [] } });
		return send({ id: message.id, result: { protocolVersion: "2025-11-25", capabilities: { tools: { listChanged: true } } } });
	}
	if (message.method === "tools/list")
		return send({
			id: message.id,
			result: { tools: mode === "bad-schema" ? [{ ...tools[0], inputSchema: { $ref: "https://invalid.example/schema" } }] : tools },
		});
	if (message.method === "tools/call") {
		const { name, arguments: args } = message.params;
		if (name === "lose_response") {
			appendFileSync(file, "effect\n");
			process.exit(1);
		}
		if (name === "wait_forever") return;
		if (name === "invalidate") send({ method: "notifications/tools/list_changed" });
		if (name === "write_note") writeFileSync(file, args.text);
		return send({
			id: message.id,
			result: {
				content: [
					{ type: "text", text: name === "echo_token" ? token : name === "read_note" ? `token-present:${token !== "absent"}` : args.text },
				],
			},
		});
	}
	if (message.id === 77) {
		if (file) writeFileSync(file, JSON.stringify(message));
		return;
	}
	if (message.id !== undefined) send({ id: message.id, error: { code: -32601, message: "Unsupported" } });
});
