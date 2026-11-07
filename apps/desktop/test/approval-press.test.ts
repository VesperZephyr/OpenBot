import { readFileSync } from "node:fs";
import { expect, expectTypeOf, it } from "vitest";
import type { ApprovalDecision, ApprovalDecisionLog, ApprovalPress } from "@openbot/protocol";
import type { ApprovalPress as RendererApprovalPress } from "../src/renderer/src/approval-records";

it("keeps renderer ApprovalPress as the single protocol export", () => {
	expectTypeOf<RendererApprovalPress>().toEqualTypeOf<ApprovalPress>();
	expectTypeOf<ApprovalDecisionLog["decision"]>().toEqualTypeOf<ApprovalPress>();
	expectTypeOf<ApprovalPress>().not.toEqualTypeOf<ApprovalDecision>();

	const protocol = readFileSync(new URL("../../../packages/protocol/src/index.ts", import.meta.url), "utf8");
	expect(protocol.match(/export type ApprovalPress\b/g)).toEqual(["export type ApprovalPress"]);
	expect(protocol).toContain("readonly decision: ApprovalPress;");
	expect(protocol).not.toContain('readonly decision: "allow_once" | "deny" | "always_allow"');
	expect(protocol).toContain(
		'export type ApprovalDecision = "allow_once" | "deny" | { readonly kind: "always_allow"; readonly scope: AlwaysAllowScope };',
	);

	const renderer = readFileSync(new URL("../src/renderer/src/approval-records.ts", import.meta.url), "utf8");
	expect(renderer).not.toMatch(/\bApprovalPress\s*=/);
	expect(renderer).toContain('import type { ApprovalPress, PendingApproval } from "@openbot/protocol"');
	expect(renderer).toContain("export type { ApprovalPress }");
});
