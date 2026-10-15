import { describe, expect, it } from "vitest";
import { assertLocalTarget, type ExecutionTarget, ProtocolError } from "../src/index.ts";

describe("assertLocalTarget", () => {
	it("accepts only the bound local target", () => {
		expect(() => assertLocalTarget({ kind: "local", targetId: "mac-1" }, "mac-1")).not.toThrow();
	});

	it("rejects another local target identity", () => {
		expect(() => assertLocalTarget({ kind: "local", targetId: "mac-2" }, "mac-1")).toThrow(
			expect.objectContaining({ code: "target_mismatch" }),
		);
	});

	it("rejects non-local target kinds even with the bound identity", () => {
		const remote = { kind: "remote", targetId: "mac-1" } as unknown as ExecutionTarget;
		expect(() => assertLocalTarget(remote, "mac-1")).toThrow(ProtocolError);
		expect(() => assertLocalTarget(remote, "mac-1")).toThrow(expect.objectContaining({ code: "target_unsupported" }));
	});
});
