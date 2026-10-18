import { expect, it } from "vitest";
import { CodemodeSandbox, type CodemodeBridgeLimits } from "../src/index.ts";
const limits: CodemodeBridgeLimits = {
	maxCalls: 128,
	maxToolCalls: 64,
	maxPendingCalls: 8,
	maxArgumentBytes: 32768,
	maxOutputBytes: 65536,
	maxOutputItems: 256,
	maxReturnBytes: 32768,
	maxStoreWriteBytes: 8 * 1024 * 1024,
};
it("bounds calls and output before transport even when script catches failures", async () => {
	for (const [code,maxCalls] of [
		["for(let i=0;i<10000;i++) tools.read({});",8],
		['for(let i=0;i<10000;i++) { try { text("x".repeat(1000)); } catch {} }',0],
		['try { await tools.read({query:"x".repeat(1000000)}); } catch {} text("bypass");',0],
		['return "x".repeat(1000000);',0],
		["for(let i=0;i<65;i++) await tools.read({});",64],
		["for(let i=0;i<129;i++) await discovery();",128],
	] as const) {
		let calls = 0;
		const sandbox = new CodemodeSandbox({
			bridgeLimits: limits,
			memoryLimitBytes: 64 * 1024 * 1024,
			tools: [
				{
					name: "read",
					execute: () => {
						calls++;
						return {};
					},
				},
			],
			globals: [
				{
					name: "discovery",
					execute: () => {
						calls++;
						return {};
					},
				},
			],
		});
		const result = await sandbox.execute(code, { timeoutMs: 3000 });
		expect(result.ok, code).toBe(false);
		expect(calls).toBeLessThanOrEqual(maxCalls);
		expect(JSON.stringify(result.output).length).toBeLessThan(65536);
		await sandbox.close();
	}
});
it("keeps capacity until worker exit, interrupts loops and rejects invalid budgets", async () => {
	let active = 0;
	let exited: Promise<void> | undefined;
	const sandbox = new CodemodeSandbox({
		bridgeLimits: limits,
		memoryLimitBytes: 64 * 1024 * 1024,
		acquireWorker() {
			active++;
			return () => {
				active--;
			};
		},
		onWorkerStarted(p) {
			exited = p;
		},
	});
	const result = await sandbox.execute("while(true) {}", { timeoutMs: 100 });
	expect(result.ok).toBe(false);
	await exited;
	expect(active).toBe(0);
	expect((await sandbox.execute("text(typeof process+typeof require+typeof fetch);")).ok).toBe(true);
	await sandbox.close();
	expect(() => new CodemodeSandbox({ bridgeLimits: { ...limits, maxCalls: Infinity } })).toThrow();
});
it("contains allocation and empty-output floods while the host remains responsive", async () => {
	for (const code of ["const a=[]; while(true) a.push(new Uint8Array(1024*1024));", 'while(true) text("");']) {
		let ticks = 0;
		const timer = setInterval(() => ticks++, 1);
		const sandbox = new CodemodeSandbox({ bridgeLimits: limits, memoryLimitBytes: 64 * 1024 * 1024 });
		const result = await sandbox.execute(code, { timeoutMs: 1000 });
		clearInterval(timer);
		expect(result.ok).toBe(false);
		expect(ticks).toBeGreaterThan(0);
		expect(result.output.length).toBeLessThanOrEqual(256);
		await sandbox.close();
	}
});
it("includes effective bridge budgets in the deterministic replay fingerprint",async()=>{
 const fingerprints:string[]=[];
 for(const maxCalls of [128,127]) {
  const sandbox=new CodemodeSandbox({bridgeLimits:{...limits,maxCalls}});
  await sandbox.start('text("ok")',{startedAt:1,seed:1,onCall:()=>{},onStarted:value=>{fingerprints.push(value);}}).result;
  await sandbox.close();
 }
 expect(fingerprints).toHaveLength(2);expect(fingerprints[0]).not.toBe(fingerprints[1]);
});
