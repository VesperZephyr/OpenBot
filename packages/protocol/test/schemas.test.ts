import { describe, expect, it } from "vitest";
import { HOST_METHODS } from "../src/index.ts";
import { HOST_PARAM_SCHEMAS, paramsError } from "../src/schemas.ts";

describe("Host method parameter schemas", () => {
	it("cover exactly the Host methods", () => {
		expect(Object.keys(HOST_PARAM_SCHEMAS).sort()).toEqual([...HOST_METHODS].sort());
	});

	it("accept well-formed params", () => {
		expect(paramsError("bots.list", {})).toBeUndefined();
		expect(paramsError("bots.update", { botId: "b", model: null, status: "hidden" })).toBeUndefined();
		expect(paramsError("conversations.subscribe", { botId: null })).toBeUndefined();
		expect(
			paramsError("models.addProvider", { id: "local-llm", name: "Local", baseUrl: "http://127.0.0.1:1/v1", api: "openai-completions", modelIds: ["m"] }),
		).toBeUndefined();
	});

	it("reject wrong shapes, unknown fields, and values outside the contract, naming the field", () => {
		expect(paramsError("bots.list", { extra: 1 })).toContain("extra: unknown property");
		expect(paramsError("messages.submit", { botId: "b", text: "hi" })).toContain("requestId: required");
		expect(paramsError("messages.submit", { botId: "b", requestId: 7, text: "hi" })).toContain("requestId");
		expect(paramsError("approvals.decide", { approvalId: "a", decision: "always" })).toContain("decision");
		// `deleted` is reached only through bots.delete.
		expect(paramsError("bots.update", { botId: "b", status: "deleted" })).toContain("status");
		expect(paramsError("models.addProvider", { id: "search:tavily", name: "x", baseUrl: "http://x", api: "openai-completions", modelIds: ["m"] })).toContain("id");
		expect(paramsError("models.addProvider", { id: "x", name: "x", baseUrl: "http://x", api: "openai-completions", modelIds: [] })).toContain("modelIds");
		expect(paramsError("conversations.snapshot", null)).toBeDefined();
		expect(paramsError("conversations.snapshot", [])).toBeDefined();
	});

	it("never echoes a rejected value", () => {
		const message = paramsError("credentials.set", { providerId: "openai", apiKey: 12345678, leaked: "sk-secret" }) ?? "";
		expect(message).not.toContain("sk-secret");
		expect(message).not.toContain("12345678");
	});
});
