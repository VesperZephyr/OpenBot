/**
 * The Host clock for isolated e2e runs. Desktop forwards `OPENBOT_TEST_CLOCK_FILE` only in its test mode; without it
 * the Host uses the wall clock. The file holds a millisecond offset that a test raises to reach a scheduled time
 * immediately, while the scheduler keeps its real one-second sweep and catch-up rules.
 */
import { readFileSync } from "node:fs";

/** How long a read offset is trusted, so frequent `now()` calls do not read the file each time. */
const REFRESH_MS = 100;

export type TestClockOptions = {
	readonly read?: (path: string) => string;
	readonly wallClock?: () => number;
};

export function hostClock(path: string | undefined, { read = (file) => readFileSync(file, "utf8"), wallClock = Date.now }: TestClockOptions = {}): () => number {
	if (!path) return wallClock;
	let offset = 0;
	let checkedAt = Number.NEGATIVE_INFINITY;
	return () => {
		const wall = wallClock();
		if (wall - checkedAt >= REFRESH_MS) {
			checkedAt = wall;
			let next = Number.NaN;
			try {
				next = Number(read(path).trim());
			} catch {
				// No file yet means no offset.
			}
			// Durable timestamps must never move backwards, so the offset only grows.
			if (Number.isSafeInteger(next) && next > offset) offset = next;
		}
		return wall + offset;
	};
}
