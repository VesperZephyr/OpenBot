/** Bounded request ownership for the Host's disposable history worker. */
import { ProtocolError } from "@openbot/protocol";
import { Worker } from "node:worker_threads";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { HistoryCommand, HistoryResponse } from "./history-worker-protocol.ts";
export class HistoryClient {
	readonly worker: Worker;
	readonly ready: Promise<void>;
	onFailure: (() => void) | undefined;
	#next = 1;
	#closed = false;
	#searches = 0;
	#writes = 0;
	#controls = 0;
	#pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; clean: () => void }>();
	static async open(path: string, source: string, workerUrl?: string) {
		await mkdir(dirname(path), { recursive: true });
		const client = new HistoryClient(path, source, workerUrl);
		await client.ready;
		return client;
	}
	private constructor(path: string, source: string, workerUrl?: string) {
		this.worker = new Worker(workerUrl ? new URL(workerUrl) : new URL("./history-worker.ts", import.meta.url), {
			workerData: { path, source },
			execArgv: workerUrl ? [] : ["--experimental-strip-types"],
		});
		this.ready = new Promise((resolve, reject) => this.#pending.set(0, { resolve: () => resolve(), reject, clean: () => {} }));
		this.worker.on("message", (r: HistoryResponse) => {
			const p = this.#pending.get(r.id);
			if (!p) return;
			this.#pending.delete(r.id);
			p.clean();
			if (r.error) p.reject(r.code ? new ProtocolError(r.code as ConstructorParameters<typeof ProtocolError>[0], r.error) : Error(r.error));
			else p.resolve(r.value);
		});
		this.worker.on("error", () => this.#fail());
		this.worker.on("exit", () => this.#fail());
	}
	#fail() {
		const unexpected = !this.#closed;
		this.#closed = true;
		for (const p of this.#pending.values()) {
			p.clean();
			p.reject(Error("History is unavailable"));
		}
		this.#pending.clear();
		if (unexpected) this.onFailure?.();
	}
	async call<T>(command: Exclude<HistoryCommand, { method: "cancel" }>, signal?: AbortSignal): Promise<T> {
		if (this.#closed) throw Error("History is unavailable");
		signal?.throwIfAborted();
		if (Buffer.byteLength(JSON.stringify(command)) > 512 * 1024) throw Error("History request exceeds limit");
		const search = command.method === "search" || command.method === "context";
		const write = command.method === "apply" || command.method === "stageDetail" || command.method === "stageMessage";
		if (search ? this.#searches >= 4 : write ? this.#writes >= 2 : this.#controls >= 8) throw Error("History is busy");
		if (search) this.#searches++;
		else if (write) this.#writes++;
		else this.#controls++;
		const id = this.#next++;
		return new Promise<T>((resolve, reject) => {
			const cancel = () => {
				this.worker.postMessage({ id, method: "cancel" });
				const p = this.#pending.get(id);
				if (p) {
					reject(Error("History read was cancelled"));
				}
			};
			const timer = setTimeout(cancel, search ? 5000 : 10000);
			const clean = () => {
				clearTimeout(timer);
				signal?.removeEventListener("abort", cancel);
				if (search) this.#searches--;
				else if (write) this.#writes--;
				else this.#controls--;
			};
			this.#pending.set(id, { resolve: (v) => resolve(v as T), reject, clean });
			signal?.addEventListener("abort", cancel, { once: true });
			this.worker.postMessage({ ...command, id });
		});
	}
	async close() {
		if (this.#closed) {
			await this.worker.terminate();
			return;
		}
		this.onFailure = undefined;
		try {
			await this.call({ method: "close" });
		} finally {
			this.#fail();
			await this.worker.terminate();
		}
	}
}
