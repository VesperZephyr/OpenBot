/**
 * A scripted OpenAI-compatible chat completions server for end-to-end tests. Each request consumes the next scripted
 * turn: plain text, or one tool call. Requests are recorded so tests can check what the app sent to the model.
 *
 * It exercises the real BYOK path (models.json → pi-ai → HTTP), costs nothing, and is deterministic.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type ScriptedTurn =
	| { readonly text: string }
	| { readonly tool: string; readonly args: Record<string, unknown> }
	/** The provider rejects the request with HTTP 400 and this message; not retried by Pi. */
	| { readonly error: string };

export type ModelRequest = { readonly messages: readonly { role: string; content?: unknown }[]; readonly tools?: readonly unknown[] };

export class ScriptedModel {
	readonly requests: ModelRequest[] = [];
	readonly #turns: ScriptedTurn[] = [];
	#server: Server | undefined;
	#calls = 0;

	/** Queue turns; each model request consumes one. */
	script(...turns: ScriptedTurn[]): void {
		this.#turns.push(...turns);
	}

	async start(): Promise<string> {
		this.#server = createServer((request, response) => {
			let body = "";
			request.on("data", (chunk) => (body += chunk));
			request.on("end", () => {
				if (request.url?.endsWith("/models")) {
					response.writeHead(200, { "content-type": "application/json" });
					response.end(JSON.stringify({ data: [{ id: "scripted" }] }));
					return;
				}
				this.requests.push(JSON.parse(body) as ModelRequest);
				const turn = this.#turns.shift() ?? { text: "(the script has no more turns)" };
				if ("error" in turn) {
					response.writeHead(400, { "content-type": "application/json" });
					response.end(JSON.stringify({ error: { message: turn.error, type: "invalid_request_error" } }));
					return;
				}
				response.writeHead(200, { "content-type": "text/event-stream" });
				response.end(this.#stream(turn));
			});
		});
		await new Promise<void>((resolve) => this.#server?.listen(0, "127.0.0.1", resolve));
		return `http://127.0.0.1:${(this.#server.address() as AddressInfo).port}/v1`;
	}

	async stop(): Promise<void> {
		await new Promise<void>((resolve) => (this.#server ? this.#server.close(() => resolve()) : resolve()));
	}

	#stream(turn: Exclude<ScriptedTurn, { readonly error: string }>): string {
		const chunk = (delta: object, finish: string | null) =>
			`data: ${JSON.stringify({ id: "s", object: "chat.completion.chunk", created: 0, model: "scripted", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
		if ("text" in turn) return `${chunk({ role: "assistant", content: turn.text }, null)}${chunk({}, "stop")}data: [DONE]\n\n`;
		const id = `call_${++this.#calls}`;
		const call = { index: 0, id, type: "function", function: { name: turn.tool, arguments: JSON.stringify(turn.args) } };
		return `${chunk({ role: "assistant", tool_calls: [call] }, null)}${chunk({}, "tool_calls")}data: [DONE]\n\n`;
	}
}
