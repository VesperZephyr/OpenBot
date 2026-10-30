/**
 * Main-process guards for a desktop whose launching terminal or test runner may disappear before it does.
 */

/** Errors a console stream reports once nothing reads its other end: a closed pipe, or a closed terminal. */
const DETACHED_CONSOLE_CODES = new Set(["EPIPE", "EIO"]);

type ErrorSource = { on(event: "error", listener: (error: Error) => void): unknown };

/**
 * Main writes to stdout and stderr: it echoes Host output, and Electron itself calls `console.error` when an IPC
 * handler rejects. Once the reader is gone those writes fail asynchronously; without a listener the failure becomes an
 * uncaught exception, and Electron shows a modal error dialog that also blocks a graceful quit. Losing the console
 * loses nothing durable, because Host output also goes to the rotating log. Every other stream error stays uncaught.
 */
export function ignoreDetachedConsole(streams: readonly ErrorSource[]): void {
	for (const stream of streams)
		stream.on("error", (error) => {
			if (!DETACHED_CONSOLE_CODES.has((error as NodeJS.ErrnoException).code ?? "")) throw error;
		});
}

export type OrphanWatchOptions = {
	/** Reads the current parent process id; `process.ppid` is re-read on every access. */
	readonly parentPid: () => number;
	readonly onOrphaned: () => void;
	readonly intervalMs?: number;
};

/**
 * Calls `onOrphaned` once the process that launched us has exited, which re-parents us. Playwright starts Electron
 * in its own process group, so an interrupted or killed test runner otherwise leaves a hidden app and its Host running.
 */
export function watchForOrphaning({ parentPid, onOrphaned, intervalMs = 1_000 }: OrphanWatchOptions): () => void {
	const launcher = parentPid();
	const timer = setInterval(() => {
		if (parentPid() === launcher) return;
		clearInterval(timer);
		onOrphaned();
	}, intervalMs);
	timer.unref();
	return () => clearInterval(timer);
}
