/** Synthetic HTTPS service shared by executor and desktop tests. Certificates exist only in the test directory. */
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:https";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
export async function httpsFixture(root: string) {
	const certPath = join(root, "fixture-cert.pem"),
		keyPath = join(root, "fixture-key.pem"),
		config = join(root, "fixture.cnf");
	await writeFile(
		config,
		"[req]\ndistinguished_name=dn\nx509_extensions=ext\n[dn]\n[ext]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\n",
	);
	execFileSync(
		"openssl",
		[
			"req",
			"-x509",
			"-newkey",
			"rsa:2048",
			"-nodes",
			"-days",
			"2",
			"-subj",
			"/CN=localhost",
			"-config",
			config,
			"-keyout",
			keyPath,
			"-out",
			certPath,
		],
		{ stdio: "ignore" },
	);
	const [cert, key] = await Promise.all([readFile(certPath, "utf8"), readFile(keyPath, "utf8")]);
	const state = {
		mode: "normal",
		token: "SYNTHETIC_HTTPS_TOKEN_39471",
		retry: "3",
		redirect: "https://127.0.0.1:1/never",
		writes: [] as string[],
		sessions: 0,
		deleted: 0,
		cancelled: 0,
		requests: [] as { method: string; path: string; rpc?: string; session?: string; version?: string; authorized: boolean }[],
	};
	const server = createServer({ cert, key }, async (req, res) => {
		try {
			const parts: Buffer[] = [];
			for await (const chunk of req) parts.push(Buffer.from(chunk));
			const body = parts.length ? JSON.parse(Buffer.concat(parts).toString("utf8")) : {};
			const authorized = req.headers.authorization === `Bearer ${state.token}`;
			state.requests.push({
				method: req.method!,
				path: req.url!,
				rpc: body.method,
				...(typeof req.headers["mcp-session-id"] === "string" ? { session: req.headers["mcp-session-id"] } : {}),
				...(typeof req.headers["mcp-protocol-version"] === "string" ? { version: req.headers["mcp-protocol-version"] } : {}),
				authorized,
			});
			if (req.method === "DELETE") {
				state.deleted++;
				res.writeHead(state.mode === "no-delete" ? 405 : 200).end();
				return;
			}
			if (body.method === "notifications/cancelled") {
				state.cancelled++;
				res.writeHead(202).end();
				return;
			}
			if (state.mode === "redirect") {
				res.writeHead(307, { Location: state.redirect }).end();
				return;
			}
			if (state.mode === "auth" || (req.url !== "/public" && !authorized)) {
				res.writeHead(401).end(state.token);
				return;
			}
			if (state.mode === "rate") {
				res.writeHead(429, { "Retry-After": state.retry }).end();
				return;
			}
			if (state.mode === "expired" && body.method !== "initialize") {
				res.writeHead(404).end();
				return;
			}
			if (!body.method) {
				res.writeHead(202).end();
				return;
			}
			if (body.method === "notifications/initialized") {
				res.writeHead(202).end();
				return;
			}
			if (state.mode === "wait" || body.params?.name === "wait_forever") return;
			const reply = (result: unknown) => {
				const value = { jsonrpc: "2.0", id: state.mode === "wrong-id" ? "wrong" : body.id, result };
				if (state.mode === "oversize-request") {
					const frame = JSON.stringify({ jsonrpc: "2.0", id: "x".repeat(1048500), method: "unsupported" });
					res.writeHead(200, { "Content-Type": "text/event-stream" }).end(`data: ${frame}\n\n`);
					return;
				}
				if (state.mode === "oversize") {
					res.writeHead(200, { "Content-Type": "application/json" }).end("x".repeat(1048577));
					return;
				}
				if (state.mode === "bad-json") {
					res.writeHead(200, { "Content-Type": "application/json" }).end("{");
					return;
				}
				if (state.mode === "bad-utf8") {
					res.writeHead(200, { "Content-Type": "application/json" }).end(Buffer.from([0xc3, 0x28]));
					return;
				}
				if (state.mode === "sse" || state.mode === "sse-events" || state.mode === "server-request") {
					res.writeHead(200, { "Content-Type": "text/event-stream" });
					if (state.mode === "sse-events") {
						res.end(": heartbeat\n\n".repeat(130));
						return;
					}
					if (state.mode === "server-request")
						res.write(`data: ${JSON.stringify({ jsonrpc: "2.0", id: "server", method: "sampling/createMessage", params: {} })}\n\n`);
					res.write(": keepalive\r\nid: fixture-event\r\ndata:\r\n\r\n");
					const data = `data: ${JSON.stringify(value)}\r\n\r\n`;
					res.write(data.slice(0, 8));
					res.end(data.slice(8));
					return;
				}
				res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(value));
			};
			if (body.method === "initialize") {
				state.sessions++;
				res.setHeader("MCP-Session-Id", `fixture-private-session-${state.sessions}`);
				reply({
					protocolVersion: "2025-11-25",
					capabilities: { tools: { listChanged: true } },
					serverInfo: { name: "fixture", version: "1" },
				});
				return;
			}
			if (body.method === "tools/list") {
				reply({
					tools: ["read_note", "write_note", "lose_response", "wait_forever", "echo_token", "invalidate"].map((name) => ({
						name,
						description: `Synthetic ${name} ${state.token} ${state.mode === "session-echo" ? req.headers["mcp-session-id"] : ""}`,
						inputSchema:
							state.mode === "bad-schema"
								? { type: "object", $ref: "https://invalid.test/schema" }
								: {
										type: "object",
										properties: { text: { type: "string", maxLength: 512 } },
										required: ["text"],
										additionalProperties: false,
									},
					})),
				});
				return;
			}
			if (body.method === "tools/call") {
				const name = body.params.name;
				if (state.mode === "bad-result") {
					reply({ content: [{ type: "image", data: "unsupported" }] });
					return;
				}
				if (name === "write_note" || name === "lose_response") state.writes.push(body.params.arguments.text);
				if (name === "lose_response") {
					req.socket.destroy();
					return;
				}
				if (name === "invalidate") {
					res
						.writeHead(200, { "Content-Type": "text/event-stream" })
						.end('data: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}\n\n');
					return;
				}
				reply({ content: [{ type: "text", text: name === "echo_token" ? state.token : "HTTPS fixture confirmed" }] });
				return;
			}
			res.writeHead(400).end();
		} catch {
			res.destroy();
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return {
		cert,
		certPath,
		state,
		endpoint: `https://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`,
		async close() {
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}
