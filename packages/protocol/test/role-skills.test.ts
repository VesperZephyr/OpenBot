import { expect, it } from "vitest";
import { Compile } from "typebox/compile";
import { APP_MANAGEMENT_CAPABILITIES } from "../src/app-management.ts";
import { paramsError } from "../src/schemas.ts";

it("bounds owner skill pins without adding model management authority", () => {
		const ref = { name: "invoice-check", revision: 1, sha256: "a".repeat(64) };
		expect(paramsError("bots.update", { botId: "a", expectedRevision: 1, defaultSkills: [ref] })).toBeUndefined();
		for (const defaultSkills of [[{ ...ref, revision: 0 }], [{ ...ref, sha256: "latest" }], [ref, ref, ref]])
			expect(paramsError("bots.update", { botId: "a", defaultSkills })).toBeDefined();
		const update = APP_MANAGEMENT_CAPABILITIES.find(item => item.id === "bots.update")!;
		expect(Compile(update.inputSchema).Check({ botId: "a", expectedRevision: 1, defaultSkills: [ref] })).toBe(false);
		const inspect = APP_MANAGEMENT_CAPABILITIES.find(item => item.id === "bots.inspect")!;
		expect(Compile(inspect.outputSchema).Check({ ok: true, value: [{ botId: "a", name: "A", role: "Finance", revision: 1, kind: "specialist", status: "active", pinned: false, createdAt: 0, defaultSkills: [ref] }] })).toBe(true);
	});
