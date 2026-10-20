/** Bounded outbound Streamable HTTP. A transport never retries an external effect. */
import { request as httpsRequest, Agent } from "node:https";
import type { IncomingMessage } from "node:http";
import { CONNECTOR_LIMITS } from "@openbot/protocol";
import { McpError, type McpSession } from "./mcp-session.ts";
const VERSION = "2025-11-25";
const NETWORK = "HTTPS connector connection failed. Check the service and TLS certificate, then connect again.";
const INVALID = "HTTPS connector returned an unsupported response. Review the service before reconnecting.";
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function retryAfter(value: string | undefined, now = Date.now()): number {
	const date =
		value &&
		/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)
			? Date.parse(value)
			: NaN;
	const parsed = value && /^\d+$/.test(value) ? now + Number(value) * 1000 : date;
	return Math.max(now + 1000, Number.isFinite(parsed) && Math.abs(parsed) <= 8.64e15 ? parsed : now + 60000);
}
export class McpHttps implements McpSession {
	readonly #agent: Agent;
	readonly #endpoint: string;
	readonly #changed: (error: McpError) => void;
	readonly #pending = new Map<string, { controller: AbortController; method: string; sent: boolean }>();
	#credential: string | undefined;
	#sessionId: string | undefined;
	#initialized = false;
	#closed = false;
	#sequence = 0;
	#stopping: Promise<boolean> | undefined;
	constructor(endpoint: string, credential: string | undefined, changed: (error: McpError) => void, ca?: string) {
		this.#endpoint = endpoint;
		this.#credential = credential;
		this.#changed = changed;
		// Explicit verification remains enabled even if a launch environment disables Node's default.
		this.#agent = new Agent({ keepAlive: false, maxSockets: 8, rejectUnauthorized: true, ...(ca ? { ca } : {}) });
	}
	get sensitiveValues(): readonly string[] {
		return this.#sessionId ? [this.#sessionId] : [];
	}
	get closed() {
		return this.#closed;
	}
	#fail(error: McpError): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#changed(error);
		void this.stop();
	}
	async #exchange(method: "POST" | "DELETE", body: unknown, signal: AbortSignal, sent: () => void): Promise<IncomingMessage> {
		if (signal.aborted) throw new McpError(false);
		const data = body === undefined ? undefined : JSON.stringify(body);
		if (data && Buffer.byteLength(data) > CONNECTOR_LIMITS.frameBytes) throw new McpError(false);
		return new Promise((resolve, reject) => {
			const req = httpsRequest(
				this.#endpoint,
				{
					method,
					agent: this.#agent,
					signal,
					maxHeaderSize: 16384,
					headers: {
						Accept: "application/json, text/event-stream",
						...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
						...(this.#credential ? { Authorization: `Bearer ${this.#credential}` } : {}),
						...(this.#sessionId ? { "MCP-Session-Id": this.#sessionId } : {}),
						...(this.#initialized ? { "MCP-Protocol-Version": VERSION } : {}),
					},
				},
				resolve,
			);
			req.on("error", () => reject(new McpError(true, NETWORK)));
			sent();
			req.end(data);
		});
	}
	#status(response: IncomingMessage): void {
		const status = response.statusCode ?? 0;
		if (status >= 200 && status < 300) return;
		response.destroy();
		if (status === 429)
			throw new McpError(
				true,
				"HTTPS connector is rate limited. Wait until the retry time, then connect again.",
				retryAfter(response.headers["retry-after"]),
			);
		if (status === 401 || status === 403)
			throw new McpError(true, "HTTPS connector authentication failed. Check or replace the credential, then connect again.");
		if (status === 404)
			throw new McpError(true, "HTTPS connector session expired or endpoint was not found. Connect again to start a new session.");
		if (status >= 300 && status < 400)
			throw new McpError(true, "HTTPS connector redirects are blocked. Install the service's final HTTPS endpoint.");
		throw new McpError(true, NETWORK);
	}
	async #postNotification(body: unknown, signal: AbortSignal): Promise<void> {
		const response = await this.#exchange("POST", body, signal, () => {});
		try {
			this.#status(response);
			if (response.statusCode !== 202) throw new McpError(true, INVALID);
			for await (const chunk of response) if (chunk.length) throw new McpError(true, INVALID);
		} finally {
			response.destroy();
		}
	}
	async notify(method: string, params?: unknown, timeout: number = CONNECTOR_LIMITS.handshakeMs): Promise<void> {
		if (this.#closed) throw new McpError(false);
		const controller = new AbortController();
		const id = `notification:${++this.#sequence}`;
		this.#pending.set(id, { controller, method, sent: true });
		const timer = setTimeout(() => controller.abort(), timeout);
		try {
			await this.#postNotification({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) }, controller.signal);
		} catch (error) {
			const safe = error instanceof McpError ? error : new McpError(true, INVALID);
			this.#fail(safe);
			throw safe;
		} finally {
			clearTimeout(timer);
			this.#pending.delete(id);
		}
	}
	async request(method: string, params: unknown, timeout: number, signal?: AbortSignal): Promise<unknown> {
		if (this.#closed || signal?.aborted || this.#pending.size >= CONNECTOR_LIMITS.pending) throw new McpError(false);
		const id = String(++this.#sequence),
			controller = new AbortController();
		const pending = { controller, method, sent: false };
		this.#pending.set(id, pending);
		const abort = () => {
			this.#fail(new McpError(pending.sent, "HTTPS connector request was interrupted. Inspect effects before reconnecting."));
		};
		signal?.addEventListener("abort", abort, { once: true });
		const timer = setTimeout(
			() => this.#fail(new McpError(pending.sent, "HTTPS connector request timed out. Inspect effects before reconnecting.")),
			timeout,
		);
		let response: IncomingMessage | undefined;
		try {
			response = await this.#exchange("POST", { jsonrpc: "2.0", id, method, params }, controller.signal, () => {
				pending.sent = true;
			});
			this.#status(response);
			if (response.statusCode !== 200 || (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity"))
				throw new McpError(true, INVALID);
			const sessionId = response.headers["mcp-session-id"];
			if (sessionId !== undefined) {
				if (
					typeof sessionId !== "string" ||
					!/^[\x21-\x7e]{1,1024}$/.test(sessionId) ||
					(method !== "initialize" && sessionId !== this.#sessionId)
				)
					throw new McpError(true, INVALID);
				if (method === "initialize") this.#sessionId = sessionId;
			}
			const type = response.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
			if (type !== "application/json" && type !== "text/event-stream") throw new McpError(true, INVALID);
			const decoder = new TextDecoder("utf-8", { fatal: true });
			let bytes = 0,
				buffer = "",
				data: string[] = [],
				events = 0;
			const message = async (value: unknown): Promise<{ result: unknown } | undefined> => {
				if (!object(value) || value.jsonrpc !== "2.0") throw new McpError(true, INVALID);
				if (typeof value.method === "string") {
					if (Object.hasOwn(value, "result") || Object.hasOwn(value, "error")) throw new McpError(true, INVALID);
					if (value.id !== undefined) {
						if (typeof value.id !== "string" && typeof value.id !== "number") throw new McpError(true, INVALID);
						await this.#postNotification(
							{
								jsonrpc: "2.0",
								id: value.id,
								...(value.method === "ping" ? { result: {} } : { error: { code: -32601, message: "Unsupported server request" } }),
							},
							controller.signal,
						);
					} else if (value.method === "notifications/tools/list_changed")
						throw new McpError(true, "Connector tools changed. Connect again to review its tools.");
					return;
				}
				if (value.id !== id || Object.hasOwn(value, "result") === Object.hasOwn(value, "error")) throw new McpError(true, INVALID);
				if (value.error !== undefined)
					throw new McpError(true, "HTTPS connector returned a protocol error. Inspect effects before retrying.");
				return { result: value.result };
			};
			for await (const chunk of response) {
				bytes += chunk.length;
				if (bytes > CONNECTOR_LIMITS.frameBytes) throw new McpError(true, INVALID);
				buffer += decoder.decode(chunk, { stream: true });
				if (type === "application/json") continue;
				for (;;) {
					const index = buffer.search(/[\r\n]/);
					if (index < 0 || (buffer[index] === "\r" && index === buffer.length - 1)) break;
					const line = buffer.slice(0, index);
					buffer = buffer.slice(index + (buffer.slice(index, index + 2) === "\r\n" ? 2 : 1));
					if (!line) {
						if (++events > 128) throw new McpError(true, INVALID);
						const raw = data.join("\n");
						data = [];
						if (!raw) continue;
						const found = await message(JSON.parse(raw));
						if (found) {
							if (method === "initialize") this.#initialized = true;
							return found.result;
						}
					} else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
				}
			}
			buffer += decoder.decode();
			if (type !== "application/json") throw new McpError(true, NETWORK);
			const found = await message(JSON.parse(buffer));
			if (!found) throw new McpError(true, INVALID);
			if (method === "initialize") this.#initialized = true;
			return found.result;
		} catch (error) {
			// A failed nested notification cannot erase the original tool request's dispatch.
			const safe = new McpError(
				pending.sent || (error instanceof McpError && error.sent),
				error instanceof McpError ? error.message : INVALID,
				error instanceof McpError ? error.retryAt : undefined,
			);
			this.#fail(safe);
			throw safe;
		} finally {
			response?.destroy();
			clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
			this.#pending.delete(id);
		}
	}
	stop(): Promise<boolean> {
		if (this.#stopping) return this.#stopping;
		this.#closed = true;
		const calls = [...this.#pending].filter(([, value]) => value.sent && value.method === "tools/call");
		for (const pending of this.#pending.values()) pending.controller.abort();
		this.#stopping = (async () => {
			const controller = new AbortController(),
				timer = setTimeout(() => controller.abort(), 1000);
			try {
				await Promise.allSettled([
					...calls.map(([requestId]) =>
						this.#postNotification(
							{ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId, reason: "Cancelled" } },
							controller.signal,
						),
					),
					...(this.#sessionId
						? [
								this.#exchange("DELETE", undefined, controller.signal, () => {}).then((response) => {
									response.destroy();
								}),
							]
						: []),
				]);
			} finally {
				clearTimeout(timer);
				this.#credential = undefined;
				this.#sessionId = undefined;
				this.#agent.destroy();
			}
			return true;
		})();
		return this.#stopping;
	}
}
