/**
 * Per-key throttle for conversation snapshots before they cross IPC. The first value after a quiet window goes out at
 * once; values pushed while the window is open replace each other, and the latest goes out when the window closes,
 * which opens the next one. So each key delivers at most one value per window, and the last value pushed is always
 * delivered.
 */

export type Timers = {
	readonly setTimeout: (callback: () => void, ms: number) => unknown;
	readonly clearTimeout: (handle: unknown) => void;
};

const SYSTEM_TIMERS: Timers = {
	setTimeout: (callback, ms) => setTimeout(callback, ms),
	// Handles passed back here are the ones `setTimeout` above returned.
	clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

/** About one frame budget of a 20 Hz stream: smooth enough for streaming text, far fewer IPC messages. */
export const COALESCE_WINDOW_MS = 50;

type Slot<V> = { handle: unknown; pending?: { readonly value: V } };

export class Coalescer<K, V> {
	readonly #deliver: (key: K, value: V) => void;
	readonly #windowMs: number;
	readonly #timers: Timers;
	/** Keys with an open window; `pending` holds the value to send when it closes. */
	readonly #open = new Map<K, Slot<V>>();

	constructor(deliver: (key: K, value: V) => void, options: { readonly windowMs?: number; readonly timers?: Timers } = {}) {
		this.#deliver = deliver;
		this.#windowMs = options.windowMs ?? COALESCE_WINDOW_MS;
		this.#timers = options.timers ?? SYSTEM_TIMERS;
	}

	push(key: K, value: V): void {
		const slot = this.#open.get(key);
		if (slot !== undefined) {
			slot.pending = { value };
			return;
		}
		this.#deliver(key, value);
		this.#openWindow(key);
	}

	/** Drop the key's pending value and close its window, for example when nobody observes it any more. */
	cancel(key: K): void {
		const slot = this.#open.get(key);
		if (slot === undefined) return;
		this.#timers.clearTimeout(slot.handle);
		this.#open.delete(key);
	}

	cancelAll(): void {
		for (const key of [...this.#open.keys()]) this.cancel(key);
	}

	#openWindow(key: K): void {
		const slot: Slot<V> = { handle: undefined };
		slot.handle = this.#timers.setTimeout(() => {
			this.#open.delete(key);
			if (slot.pending === undefined) return;
			this.#deliver(key, slot.pending.value);
			this.#openWindow(key);
		}, this.#windowMs);
		this.#open.set(key, slot);
	}
}
