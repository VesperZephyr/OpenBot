import { readdirSync, readFileSync } from "node:fs";
import { expect, expectTypeOf, it } from "vitest";
import type { ApprovalDecision, ApprovalDecisionLog, ApprovalPress } from "@openbot/protocol";
import type { ApprovalPress as RendererApprovalPress } from "../src/renderer/src/approval-records";

it("keeps renderer ApprovalPress as the single protocol export", () => {
	expectTypeOf<RendererApprovalPress>().toEqualTypeOf<ApprovalPress>();
	expectTypeOf<ApprovalDecisionLog["decision"]>().toEqualTypeOf<ApprovalPress>();
	expectTypeOf<ApprovalPress>().not.toEqualTypeOf<ApprovalDecision>();

	const src = new URL("../../../packages/protocol/src/", import.meta.url);
	const definitions = readdirSync(src).flatMap((name) => {
		if (!name.endsWith(".ts")) return [];
		const text = readFileSync(new URL(name, src), "utf8");
		return (text.match(/export type ApprovalPress\b/g) ?? []).map(() => name);
	});
	expect(definitions).toEqual(["approvals.ts"]);
	const approvals = readFileSync(new URL("approvals.ts", src), "utf8");
	expect(approvals).toContain("readonly decision: ApprovalPress;");
	expect(approvals).not.toContain('readonly decision: "allow_once" | "deny" | "always_allow"');
	expect(approvals).toContain(
		'export type ApprovalDecision = "allow_once" | "deny" | { readonly kind: "always_allow"; readonly scope: AlwaysAllowScope };',
	);
	const entry = readFileSync(new URL("index.ts", src), "utf8");
	expect(entry).toContain('export * from "./approvals.ts"');
	expect(entry).not.toMatch(/export type ApprovalPress\b/);

	const renderer = readFileSync(new URL("../src/renderer/src/approval-records.ts", import.meta.url), "utf8");
	expect(renderer).not.toMatch(/\bApprovalPress\s*=/);
	expect(renderer).toContain('import type { ApprovalPress, PendingApproval } from "@openbot/protocol"');
	expect(renderer).toContain("export type { ApprovalPress }");
});
