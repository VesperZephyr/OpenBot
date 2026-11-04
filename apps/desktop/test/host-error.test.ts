import { describe, expect, it } from "vitest";
import { formatHostError, readHostError } from "../src/shared/api";

describe("host error crossing IPC", () => {
	it("keeps the code and current revision out of the sentence", () => {
		const wrapped = new Error(
			`Error invoking remote method 'openbot:call': Error: ${formatHostError({
				code: "request_conflict",
				message: "Profile changed. Reload before saving your draft.",
				details: { currentRevision: 4 },
			})}`,
		);
		expect(readHostError(wrapped)).toEqual({
			code: "request_conflict",
			message: "Profile changed. Reload before saving your draft.",
			details: { currentRevision: 4 },
		});
		expect(readHostError(new Error("[not_found] Missing")).message).toBe("Missing");
		expect(readHostError(new Error("plain failure"))).toEqual({ message: "plain failure" });
	});
});
