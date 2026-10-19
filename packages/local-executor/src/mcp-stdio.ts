/** A deliberately bounded MCP tools-only stdio session. No server request may start local or model work. */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { processStartTime } from "./ledger.ts";
import { CONNECTOR_LIMITS } from "@openbot/protocol";

type Pending = {
	resolve(value: unknown): void;
	reject(error: Error): void;
	timer: ReturnType<typeof setTimeout>;
	abort?: () => void;
	signal?: AbortSignal;
};
export class McpError extends Error {
	readonly sent: boolean;
	constructor(sent: boolean, message = "Connector response is unavailable") {
		super(message);
		this.sent = sent;
	}
}
export class McpStdio {
	readonly child: ChildProcessWithoutNullStreams;
	readonly #pending = new Map<string, Pending>();
	#buffer = Buffer.alloc(0);
	#sequence = 0;
	#closed = false;
	readonly #started: string | undefined;
	#stopping: Promise<boolean> | undefined;
	readonly #changed: () => void;
	constructor(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv, changed: () => void) {
		this.#changed = changed;
		this.child = spawn(command, [...args], { cwd, env, shell: false, detached: true, stdio: ["pipe", "pipe", "pipe"] });
		this.#started = this.child.pid ? processStartTime(this.child.pid) : undefined;
		this.child.stdout.on("data", (chunk: Buffer) => this.#read(chunk));
		this.child.stderr.resume();
		this.child.stdin.on("error", () => {
			this.#fail();
			void this.stop();
		});
		this.child.on("error", () => {
			this.#fail();
			void this.stop();
		});
		this.child.on("close", () => {
			this.#fail();
			void this.stop();
		});
	}
	get closed() {
		return this.#closed;
	}
	#write(value: unknown): void {
		const data = JSON.stringify(value) + "\n";
		if (
			this.#closed ||
			Buffer.byteLength(data) > CONNECTOR_LIMITS.frameBytes ||
			this.child.stdin.writableLength > CONNECTOR_LIMITS.frameBytes
		)
			throw new McpError(false);
		this.child.stdin.write(data);
	}
	notify(method: string, params?: unknown): void {
		this.#write({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
	}
	request(method: string, params: unknown, timeout: number, signal?: AbortSignal): Promise<unknown> {
		if (this.#closed || this.#pending.size >= CONNECTOR_LIMITS.pending) return Promise.reject(new McpError(false));
		if (signal?.aborted) return Promise.reject(new McpError(false, "Connector call was cancelled before dispatch"));
		const id = String(++this.#sequence);
		return new Promise((resolve, reject) => {
			const finish = (error: Error) => {
				const entry = this.#pending.get(id);
				if (!entry) return;
				this.#pending.delete(id);
				clearTimeout(entry.timer);
				if (entry.abort) entry.signal?.removeEventListener("abort", entry.abort);
				reject(error);
			};
			const abort = () => {
				try {
					this.notify("notifications/cancelled", { requestId: id, reason: "Cancelled" });
				} catch {}
				finish(new McpError(true, "Connector call was interrupted; effects may have occurred"));
				void this.stop();
			};
			const timer = setTimeout(() => {
				finish(new McpError(true, "Connector response timed out; effects may have occurred"));
				void this.stop();
			}, timeout);
			this.#pending.set(id, { resolve, reject: finish, timer, ...(signal ? { signal, abort } : {}) });
			signal?.addEventListener("abort", abort, { once: true });
			try {
				this.#write({ jsonrpc: "2.0", id, method, params });
			} catch {
				finish(new McpError(false));
			}
		});
	}
	#read(chunk: Buffer): void {
		if (this.#closed) return;
		// Split before concatenating so a burst of small frames does not require one oversized buffer.
		let start = 0;
		for (let end = chunk.indexOf(10); ; end = chunk.indexOf(10, start)) {
			const part = chunk.subarray(start, end < 0 ? chunk.length : end);
			if (this.#buffer.length + part.length > CONNECTOR_LIMITS.frameBytes) {
				this.#fail();
				void this.stop();
				return;
			}
			this.#buffer = Buffer.concat([this.#buffer, part]);
			if (end < 0) return;
			const raw = this.#buffer;
			this.#buffer = Buffer.alloc(0);
			start = end + 1;
			try {
				const decoded = new TextDecoder("utf-8", { fatal: true }).decode(raw);
				this.#message(JSON.parse(decoded));
			} catch {
				this.#fail();
				void this.stop();
				return;
			}
			if (this.#closed) return;
		}
	}
	#message(value: unknown): void {
		if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid frame");
		const message = value as Record<string, unknown>;
		if (message.jsonrpc !== "2.0") throw Error("Invalid protocol");
		if (typeof message.method === "string") {
			if (message.id !== undefined) {
				if (typeof message.id !== "string" && typeof message.id !== "number") throw Error("Invalid identity");
				this.#write(
					message.method === "ping"
						? { jsonrpc: "2.0", id: message.id, result: {} }
						: { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Unsupported server request" } },
				);
			} else if (message.method === "notifications/tools/list_changed") this.#changed();
			return;
		}
		if (typeof message.id !== "string") throw Error("Invalid response identity");
		const pending = this.#pending.get(message.id);
		if (!pending) throw Error("Unknown response identity");
		if (Object.hasOwn(message, "result") === Object.hasOwn(message, "error")) throw Error("Invalid response");
		if (message.error !== undefined) {
			pending.reject(new McpError(true, "Connector returned a protocol error; inspect effects before retrying"));
			return;
		}
		this.#pending.delete(message.id);
		clearTimeout(pending.timer);
		if (pending.abort) pending.signal?.removeEventListener("abort", pending.abort);
		pending.resolve(message.result);
	}
	#fail(): void {
		if (this.#closed) return;
		this.#closed = true;
		for (const pending of [...this.#pending.values()]) pending.reject(new McpError(true));
		this.#changed();
	}
	stop(): Promise<boolean> {
		if (this.#stopping) return this.#stopping;
		this.#fail();
		this.child.stdin.end();
		const pid = this.child.pid;
		const started = pid ? processStartTime(pid) : undefined;
		if (started !== undefined && started !== this.#started) return (this.#stopping = Promise.resolve(true));
		const signal = (kind: NodeJS.Signals | 0) => {
			if (!pid) return false;
			try {
				process.kill(-pid, kind);
				return true;
			} catch (error) {
				return (error as NodeJS.ErrnoException).code !== "ESRCH";
			}
		};
		signal("SIGTERM");
		this.#stopping = (async () => {
			const deadline = Date.now() + 3000;
			while (signal(0) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
			if (!signal(0)) return true;
			signal("SIGKILL");
			await new Promise((resolve) => setTimeout(resolve, 200));
			return !signal(0);
		})();
		return this.#stopping;
	}
}
