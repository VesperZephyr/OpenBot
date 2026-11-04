import { describe, expect, it } from "vitest";
import { displayToolOutput } from "../src/renderer/src/tool-output";

const translate = (text: string) => `t:${text}`;

describe("displayToolOutput", () => {
	it("shows Denied for model-facing denial text and leaves other output unchanged", () => {
		expect(
			displayToolOutput(
				"local_exec",
				"The user denied this action. Do not retry it unchanged; ask or try another way.",
				undefined,
				translate,
			),
		).toBe("t:Denied");
		expect(displayToolOutput("local_exec", "The user denied this action. Do not retry it unchanged.", undefined, translate)).toBe(
			"t:Denied",
		);
		expect(displayToolOutput("local_exec", "printf checked", undefined, translate)).toBe("printf checked");
		expect(displayToolOutput("codemode", "partial output", "script failed", translate)).toBe("t:script failed");
	});

	it("shows Denied for a management denial envelope and still translates application errors", () => {
		const management = JSON.stringify({
			ok: false,
			error: { code: "permission_denied", message: "The user denied this management action. Do not retry it." },
		});
		expect(displayToolOutput("bot_create", management, undefined, translate)).toBe("t:Denied");
		const application = JSON.stringify({ ok: false, error: { message: "Application access is not authorized" } });
		expect(displayToolOutput("app_notes", application, undefined, translate)).toBe("t:Application access is not authorized");
		expect(displayToolOutput("bot_create", application, undefined, translate)).toBe(application);
		expect(displayToolOutput("app_notes", "{", undefined, translate)).toBe("{");
	});
});
