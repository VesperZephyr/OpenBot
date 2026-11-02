import { appendFileSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";

export function recordAudit(name: string, label: string, startMs: number, endMs: number, ok: boolean): void {
	if (process.env.OPENBOT_E2E_AUDIT !== "1") return;
	const directory = join(process.cwd(), "e2e/.run/audit");
	mkdirSync(directory, { recursive: true });
	appendFileSync(join(directory, `${process.pid}.jsonl`), `${JSON.stringify({
		name, label, startMs, endMs, durationMs: endMs - startMs, ok, pid: process.pid,
		file: relative(process.cwd(), process.env.OPENBOT_E2E_AUDIT_FILE ?? process.cwd()),
	})}\n`);
}

export const auditNow = (): number => performance.timeOrigin + performance.now();

export async function auditSpan<T>(name: string, label: string, operation: () => Promise<T> | T): Promise<T> {
	if (process.env.OPENBOT_E2E_AUDIT !== "1") return operation();
	const start = auditNow();
	let ok = false;
	try {
		const value = await operation();
		ok = true;
		return value;
	} finally { recordAudit(name, label, start, auditNow(), ok); }
}
