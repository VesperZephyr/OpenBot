import { ProtocolError } from "@openbot/protocol";
import { describe, expect, it } from "vitest";
import { hostError } from "../src/host-error.ts";

describe("hostError", () => {
	it("keeps protocol codes and maps every other throw to internal", () => {
		expect(hostError(new ProtocolError("not_found", "Unknown Bot"))).toEqual({ code: "not_found", message: "Unknown Bot" });
		expect(hostError(new ProtocolError("invalid_request", "Message is empty"))).toEqual({
			code: "invalid_request",
			message: "Message is empty",
		});
		expect(hostError(new ProtocolError("auth_failed", "Key rejected"))).toEqual({ code: "auth_failed", message: "Key rejected" });
		expect(
			hostError(new ProtocolError("request_conflict", "Profile changed. Reload before saving your draft.", { currentRevision: 4 })),
		).toEqual({
			code: "request_conflict",
			message: "Profile changed. Reload before saving your draft.",
			details: { currentRevision: 4 },
		});
		const system = new Error("disk full");
		(system as Error & { code: string }).code = "ENOSPC";
		expect(hostError(system)).toEqual({ code: "internal", message: "disk full" });
		expect(hostError("boom")).toEqual({ code: "internal", message: "boom" });
		expect(hostError({ code: "not_found", message: "nope" })).toEqual({ code: "internal", message: "[object Object]" });
	});
});
