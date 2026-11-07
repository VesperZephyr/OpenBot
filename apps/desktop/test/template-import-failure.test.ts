import { readFileSync } from "node:fs";
import { ProtocolError } from "@openbot/protocol";
import { describe, expect, it } from "vitest";
import { formatHostError, readHostError } from "../src/shared/api";
import { recoverTemplateImportFailure } from "../src/renderer/src/template-import-failure";

async function recover(error: unknown, uncertain = false) {
	const failure = readHostError(error);
	let cleared = false;
	let inspected = 0;
	const recovered = await recoverTemplateImportFailure({
		code: failure.code,
		uncertain,
		clearPending: () => {
			cleared = true;
		},
		reinspect: async () => {
			inspected += 1;
			return { reviewed: true };
		},
	});
	return { failure, cleared, inspected, recovered };
}

describe("template import failure", () => {
	it("clears pending and re-inspects when code is request_conflict and the message has no bracketed code", async () => {
		const error = new ProtocolError("request_conflict", "The template changed");
		expect(error.message).not.toMatch(/\[(invalid_request|request_conflict|not_found)\]/);
		const result = await recover(error);
		expect(result.failure).toEqual({ code: "request_conflict", message: "The template changed" });
		expect(result.cleared).toBe(true);
		expect(result.inspected).toBe(1);
		expect(result.recovered).toEqual({ kind: "reinspect", review: { reviewed: true } });
	});

	it("still re-inspects an IPC error whose code is only in the message prefix", async () => {
		const result = await recover(new Error(formatHostError({ code: "not_found", message: "Missing template" })));
		expect(result.failure.code).toBe("not_found");
		expect(result.failure.message).toBe("Missing template");
		expect(result.cleared).toBe(true);
		expect(result.inspected).toBe(1);
	});

	it("leaves pending in place when the code words appear only in the message", async () => {
		const result = await recover(new Error("rejected [request_conflict] before import"));
		expect(result.failure.code).toBeUndefined();
		expect(result.cleared).toBe(false);
		expect(result.inspected).toBe(0);
		expect(result.recovered).toEqual({ kind: "uncertain" });
	});

	it("does not re-inspect a definite code while the import is already uncertain", async () => {
		const result = await recover(new ProtocolError("invalid_request", "Name is required"), true);
		expect(result.failure.code).toBe("invalid_request");
		expect(result.cleared).toBe(false);
		expect(result.inspected).toBe(0);
		expect(result.recovered).toEqual({ kind: "uncertain" });
	});

	it("BotTemplates reads failure.code and no longer scrapes the message", () => {
		const source = readFileSync(new URL("../src/renderer/src/BotTemplates.tsx", import.meta.url), "utf8");
		expect(source).toContain("const failure = readHostError(error)");
		expect(source).toContain("code: failure.code");
		expect(source).toContain("localStorage.removeItem(PENDING_TEMPLATE)");
		expect(source).toContain('api["bots.templates.inspect"]');
		expect(source).not.toContain("invalid_request|request_conflict|not_found");
	});
});
