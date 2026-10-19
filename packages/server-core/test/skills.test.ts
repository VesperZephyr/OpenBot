import { expect, it, vi } from "vitest";
import type { BotRuntime } from "@openbot/agent-runtime";
import { SkillOperationError, renderSkill, type SkillDocument, type SkillVersion } from "@openbot/protocol";
import { Skills } from "../src/skills.ts";
const document: SkillDocument = {
	name: "report",
	description: "Report",
	inputs: "Input",
	requirements: "None",
	steps: "Work",
	validation: "Check",
	output: "File",
	approvalBoundaries: "Ask",
};
const value: SkillVersion = {
	name: "report",
	revision: 1,
	sha256: "a".repeat(64),
	description: "Report",
	document,
	markdown: renderSkill(document),
	deleted: false,
	available: true,
	updatedAt: 1,
};
function fixture() {
	const run: any = { runId: "run", botId: "specialist", origin: "user", state: "running" };
	const request = vi.fn(async () => value);
	const runtime = {
		runsStore: () => ({ get: async (id: string) => (id === "run" ? run : undefined) }),
		getBot: async () => ({ status: "active", kind: "specialist" }),
		conversationKey: async () => "1",
	} as unknown as BotRuntime;
	const service = new Skills({ runtime, port: { request }, targetId: "local", assertAllowed: () => {}, changed: () => {} });
	const call = {
		runId: "run",
		botId: "specialist",
		conversationId: "1",
		callId: "call",
		tool: "skill_save",
		args: { action: "save", name: "report", expectedRevision: 0, document },
		target: { kind: "local" as const, targetId: "local" },
		signal: new AbortController().signal,
	};
	return { service, run, request, call };
}
it("requires exact review for a live Specialist user Run and rejects peer/group/unattended provenance", async () => {
	const f = fixture();
	expect(await f.service.prepare(f.call)).toMatchObject({ kind: "ask" });
	expect(f.request).not.toHaveBeenCalled();
	for (const origin of ["peer", "unattended", undefined]) {
		f.run.origin = origin;
		expect(await f.service.prepare(f.call)).toMatchObject({ kind: "deny" });
	}
	f.run.origin = "user";
	f.run.channelId = "group_x";
	expect(await f.service.prepare(f.call)).toMatchObject({ kind: "deny" });
	delete f.run.channelId;
	f.run.interruption = { reason: "user" };
	expect(await f.service.prepare(f.call)).toMatchObject({ kind: "deny" });
	delete f.run.interruption;
	expect(await f.service.prepare({ ...f.call, runId: "forged" })).toMatchObject({ kind: "deny" });
	expect(await f.service.prepare({ ...f.call, conversationId: "another" })).toMatchObject({ kind: "deny" });
	expect(f.request).not.toHaveBeenCalled();
});
it("rechecks provenance at mutation and forwards only bound revision and invocation identity", async () => {
	const f = fixture();
	expect(await f.service.invoke(f.call)).toMatchObject({ status: "failed" });
	expect(f.request).not.toHaveBeenCalled();
	expect(await f.service.invoke({ ...f.call, dispatchRevision: 8 })).toMatchObject({ status: "succeeded" });
	expect(f.request).toHaveBeenCalledWith("1:call", f.call.args, 8, f.call.signal);
	f.request.mockClear();
	f.run.state = "cancelled";
	expect(await f.service.invoke({ ...f.call, dispatchRevision: 8 })).toMatchObject({ status: "failed" });
	expect(f.request).not.toHaveBeenCalled();
});
it("resolves exact snapshots and refuses missing/hash-conflicting/duplicate selections", async () => {
	const f = fixture();
	f.request.mockImplementation(async () => ({ current: value, history: [value] }) as any);
	const ref = { name: value.name, revision: value.revision, sha256: value.sha256 };
	expect(await f.service.attachments([ref])).toEqual([{ ...ref, document, markdown: value.markdown }]);
	await expect(f.service.attachments([{ ...ref, sha256: "b".repeat(64) }])).rejects.toThrow("unavailable");
	await expect(f.service.attachments([ref, ref])).rejects.toThrow("distinct");
	f.request.mockImplementation(async () => ({ current: { ...value, available: false }, history: [] }) as any);
	await expect(f.service.attachments([ref])).rejects.toThrow("unavailable");
});

it("reports an interrupted mutation as uncertain without resubmitting it",async()=>{
 const f=fixture();f.request.mockRejectedValue(new SkillOperationError("Interrupted skill response",true));
 expect(await f.service.invoke({...f.call,dispatchRevision:1})).toMatchObject({status:"unknown"});expect(f.request).toHaveBeenCalledTimes(1);
});
