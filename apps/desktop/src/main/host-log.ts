/**
 * Append-only diagnostics log for the Host Runtime and the executor it starts (both write to the Host's stdout and
 * stderr). Bounded: when the file would exceed the limit it becomes `<file>.1`, replacing the previous one.
 */
import { closeSync, fstatSync, mkdirSync, openSync, renameSync, writeSync } from "node:fs";
import { dirname } from "node:path";

export class RotatingLog {
	readonly #path: string;
	readonly #limit: number;
	#fd: number | undefined;
	#size = 0;

	constructor(path: string, limitBytes: number) {
		this.#path = path;
		this.#limit = limitBytes;
	}

	write(chunk: Uint8Array): void {
		// A diagnostics write that fails (disk full, permissions) must not take down the app; the chunk is dropped.
		try {
			let fd = this.#fd ?? this.#open();
			if (this.#size > 0 && this.#size + chunk.byteLength > this.#limit) {
				closeSync(fd);
				this.#fd = undefined;
				renameSync(this.#path, `${this.#path}.1`);
				fd = this.#open();
			}
			writeSync(fd, chunk);
			this.#size += chunk.byteLength;
		} catch {
			return;
		}
	}

	#open(): number {
		mkdirSync(dirname(this.#path), { recursive: true, mode: 0o700 });
		const fd = openSync(this.#path, "a", 0o600);
		this.#fd = fd;
		this.#size = fstatSync(fd).size;
		return fd;
	}
}
