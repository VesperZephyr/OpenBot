import { ProtocolError } from "@openbot/protocol";
import { describe, expect, it } from "vitest";
import { formatHostError, readHostError } from "../src/shared/api";

describe("host error crossing IPC", () => {
	it("keeps the code and current revision out of the sentence", () => {
		const wrapped = new Error(
			`Error invoking remote method 'openbot:call': Error: ${formatHostError({
				code: "request_conflict",
				message: "This Bot was just changed elsewhere.",
				details: { currentRevision: 4 },
			})}`,
		);
		expect(readHostError(wrapped)).toEqual({
			code: "request_conflict",
			message: "This Bot was just changed elsewhere.",
			details: { currentRevision: 4 },
		});
		expect(readHostError(new Error("[not_found] Missing")).message).toBe("Missing");
		expect(readHostError(new Error("plain failure"))).toEqual({ message: "plain failure" });
	});

	it("reads a structured code when the message has no bracketed code", () => {
		const error = new ProtocolError("request_conflict", "The template changed", { currentRevision: 3 });
		expect(error.message).not.toMatch(/\[[a-z_]+\]/);
		expect(readHostError(error)).toEqual({
			code: "request_conflict",
			message: "The template changed",
			details: { currentRevision: 3 },
		});
	});
});
