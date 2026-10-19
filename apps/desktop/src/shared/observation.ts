import type { ObservationCursor, ObservationUpdate } from "@openbot/protocol";

/** Coalesce refreshes and refuse results superseded by a refresh, selection or Host generation. */
export class LatestRead<T> {
	#version = 0;
	#dirty = false;
	#running: Promise<void> | undefined;
	readonly read: () => Promise<T>;
	readonly apply: (value: T) => void;
	constructor(read: () => Promise<T>, apply: (value: T) => void) {
		this.read = read;
		this.apply = apply;
	}
	reset(): void {
		this.#version++;
		this.#dirty = false;
	}
	request(): Promise<void> {
		this.#version++;
		this.#dirty = true;
		if (this.#running) return this.#running;
		this.#running = (async () => {
			while (this.#dirty) {
				this.#dirty = false;
				const version = this.#version;
				try {
					const value = await this.read();
					if (version === this.#version) this.apply(value);
				} catch (error) {
					if (version === this.#version) throw error;
				}
			}
		})().finally(() => {
			this.#running = undefined;
		});
		return this.#running;
	}
}

/** Each completed read cycle grants one more bounded observation response. */
export function observe(options: {
	wait: (cursor?: ObservationCursor) => Promise<ObservationUpdate>;
	changed: (reset: boolean, changes: number) => Promise<void>;
	error: (error: unknown) => void;
}): () => void {
	let stopped = false;
	let cursor: ObservationCursor | undefined;
	let wake: (() => void) | undefined;
	const delay = (ms: number) =>
		new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				wake = undefined;
				resolve();
			}, ms);
			wake = () => {
				clearTimeout(timer);
				wake = undefined;
				resolve();
			};
		});
	void (async () => {
		while (!stopped) {
			try {
				const next = await options.wait(cursor);
				if (stopped) break;
				if (cursor?.streamId === next.streamId && next.seq < cursor.seq) {
					cursor = undefined;
					continue;
				}
				if (!cursor || next.streamId !== cursor.streamId || next.seq !== cursor.seq) {
					const reset = !cursor || next.streamId !== cursor.streamId;
					await options.changed(reset, next.changes);
					if (stopped) break;
					cursor = { streamId: next.streamId, seq: next.seq };
				}
				await delay(100);
			} catch (error) {
				if (stopped) break;
				options.error(error);
				cursor = undefined;
				await delay(1000);
			}
		}
	})();
	return () => {
		stopped = true;
		wake?.();
	};
}
