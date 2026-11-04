/**
 * Test-only controls. Ignored unless `NODE_ENV` is `test`, so a production process never honors
 * `OPENBOT_TEST_HOOK` even if the variable is present in the environment.
 */
export type TestHook = {
	readonly shutdownFault?: "artifacts" | "pause";
	readonly shutdownMarker?: string;
	readonly pauseDelayMs?: number;
};

const EMPTY: TestHook = {};

export function readTestHook(): TestHook {
	if (process.env.NODE_ENV !== "test") return EMPTY;
	const raw = process.env.OPENBOT_TEST_HOOK;
	if (raw === undefined || raw === "") return EMPTY;
	try {
		const value: unknown = JSON.parse(raw);
		if (value === null || typeof value !== "object" || Array.isArray(value)) return EMPTY;
		const record = value as Record<string, unknown>;
		const fault = record.shutdownFault === "artifacts" || record.shutdownFault === "pause" ? record.shutdownFault : undefined;
		const marker = typeof record.shutdownMarker === "string" ? record.shutdownMarker : undefined;
		const pause = typeof record.pauseDelayMs === "number" && record.pauseDelayMs >= 0 && record.pauseDelayMs <= 4_000 ? record.pauseDelayMs : undefined;
		return {
			...(fault === undefined ? {} : { shutdownFault: fault }),
			...(marker === undefined ? {} : { shutdownMarker: marker }),
			...(pause === undefined ? {} : { pauseDelayMs: pause }),
		};
	} catch {
		return EMPTY;
	}
}

/** In-process invoke probe. Unit tests read it; production calls are no-ops. */
export const invokeProbe = {
	settlements: [] as { id: string; status: string }[],
	dropped: [] as string[],
	pending: 0,
};

export function resetInvokeProbe(): void {
	invokeProbe.settlements.length = 0;
	invokeProbe.dropped.length = 0;
	invokeProbe.pending = 0;
}

export function noteInvokeSettlement(id: string, status: string, pending: number): void {
	if (process.env.NODE_ENV !== "test") return;
	invokeProbe.settlements.push({ id, status });
	invokeProbe.pending = pending;
}

export function noteInvokeDropped(id: string, pending: number): void {
	if (process.env.NODE_ENV !== "test") return;
	invokeProbe.dropped.push(id);
	invokeProbe.pending = pending;
}
