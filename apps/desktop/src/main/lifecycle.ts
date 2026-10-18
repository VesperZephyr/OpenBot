import { randomUUID } from "node:crypto";
import type { NativeLifecycle } from "@openbot/protocol";
import type { HostProcess } from "./host";
/** Keep the latest full observation while a Host starts; never queue an obsolete unlock for its successor. */
export class NativeLifecycleBridge {
	readonly #host: Pick<HostProcess, "state" | "call">;
	readonly #error: () => void;
	#current: NativeLifecycle = { sourceId: randomUUID(), seq: 0, locked: false, suspended: false, quitting: false };
	constructor(host: Pick<HostProcess, "state" | "call">, onError: () => void) {
		this.#host = host;
		this.#error = onError;
	}
	update(change: Partial<Pick<NativeLifecycle, "locked" | "suspended" | "quitting">>): Promise<void> {
		this.#current = { ...this.#current, ...change, seq: this.#current.seq + 1 };
		return this.ready();
	}
	async ready(): Promise<void> {
		if (this.#host.state.status !== "ready") return;
		try {
			await this.#host.call("lifecycle.native", { ...this.#current });
		} catch {
			this.#error();
		}
	}
}
