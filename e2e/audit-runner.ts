import { cpus, totalmem, loadavg } from "node:os";
import { VitestTestRunner } from "vitest/runners";
import { auditNow, auditSpan, recordAudit } from "./audit-profile.ts";

type Suite = Parameters<VitestTestRunner["onBeforeRunSuite"]>[0];

export default class AuditRunner extends VitestTestRunner {
	private machineRecorded = false;
	private starts = new Map<string, number>();

	async onBeforeRunSuite(suite: Suite): Promise<void> {
		await super.onBeforeRunSuite(suite);
		process.env.OPENBOT_E2E_AUDIT_FILE = "filepath" in suite ? String(suite.filepath) : suite.file.filepath;
		this.starts.set(suite.id, auditNow());
		if (!this.machineRecorded) {
			const now = auditNow();
			recordAudit("machine", JSON.stringify({ cpus: cpus().length, cpu: cpus()[0]?.model, memory: totalmem(), load: loadavg(), node: process.version, platform: process.platform, arch: process.arch }), now, now, true);
			this.machineRecorded = true;
		}
		const hooks = VitestTestRunner.getSuiteHooks(suite);
		for (const name of ["beforeAll", "afterAll", "beforeEach", "afterEach"] as const) {
			hooks[name].forEach((hook, index) => {
				hooks[name][index] = (...args: unknown[]) => auditSpan(`hook.${name}`, `${suite.name}:${index}`, () => Reflect.apply(hook, undefined, args));
			});
		}
	}

	async onAfterRunSuite(suite: Suite): Promise<void> {
		try { await super.onAfterRunSuite(suite); }
		finally {
			const start = this.starts.get(suite.id);
			if (start !== undefined && "filepath" in suite) recordAudit("file.execution", suite.name, start, auditNow(), suite.result?.state === "pass");
			this.starts.delete(suite.id);
		}
	}
}
