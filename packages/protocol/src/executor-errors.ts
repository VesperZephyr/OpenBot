/** Stable codes for executor failures. The Host prefixes the error text with one of these; the renderer maps the code to copy. */
export const EXECUTOR_ERROR = {
	startFailed: "executor_start_failed",
	readyTimeout: "executor_ready_timeout",
	invokeTimeout: "executor_invoke_timeout",
} as const;

export type ExecutorErrorCode = (typeof EXECUTOR_ERROR)[keyof typeof EXECUTOR_ERROR];

const CODES = new Set<string>(Object.values(EXECUTOR_ERROR));

export function executorErrorCode(message: string): ExecutorErrorCode | undefined {
	const code = message.split(":", 1)[0]?.trim() ?? "";
	return CODES.has(code) ? (code as ExecutorErrorCode) : undefined;
}
