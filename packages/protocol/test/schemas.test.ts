import { describe, expect, it } from "vitest";
import { HOST_METHODS } from "../src/index.ts";
import { HOST_PARAM_SCHEMAS, paramsError, validArtifactRequest } from "../src/schemas.ts";

describe("Host method parameter schemas", () => {
	it("bounds attachment identities and rejects path or target authority in renderer message parameters", () => {
		const id = `artifact_${"a".repeat(32)}`;
		expect(paramsError("messages.submit", { botId: "a", requestId: "r", text: "", artifactIds: [id] })).toBeUndefined();
		for (const extra of [
			{ artifactIds: [id, id] },
			{ artifactIds: Array.from({ length: 5 }, (_, i) => `artifact_${String(i).repeat(32)}`) },
			{ path: "/private/file" },
			{ targetId: "other" },
		])
			expect(paramsError("messages.submit", { botId: "a", requestId: "r", text: "", ...extra })).toBeDefined();
		expect(paramsError("artifacts.preview", { artifactId: id, path: "/private/file" })).toBeDefined();
		const request = {
			kind: "artifact.request",
			messageId: "m",
			requestId: "r",
			targetId: "mac",
			operation: { action: "content", artifactId: id },
		};
		expect(validArtifactRequest(request)).toBe(true);
		expect(validArtifactRequest({ ...request, operation: { ...request.operation, path: "/private/file" } })).toBe(false);
		expect(validArtifactRequest({ ...request, operation: { action: "shell", command: "id" } })).toBe(false);
	});

	it("cover exactly the Host methods", () => {
		expect(Object.keys(HOST_PARAM_SCHEMAS).sort()).toEqual([...HOST_METHODS].sort());
	});

	it("accept well-formed params", () => {
		expect(paramsError("bots.list", {})).toBeUndefined();
		expect(paramsError("conversations.search", { query: "中文", unreadOnly: true, includeHidden: false })).toBeUndefined();
		expect(paramsError("conversations.markRead", { conversationKey: "group:group_g", through: 2 })).toBeUndefined();
		expect(paramsError("conversations.markRead", { conversationKey: "bot:a", through: 0 })).toBeUndefined();
		// A root key includes JSON-escaped group and request IDs.
		expect(
			paramsError("collaboration.stop", { rootId: `root:${JSON.stringify(["group_" + "g".repeat(128), "\u0000".repeat(256)])}` }),
		).toBeUndefined();
		expect(paramsError("bots.update", { botId: "b", model: null, status: "hidden" })).toBeUndefined();
		expect(paramsError("conversations.subscribe", { botId: null })).toBeUndefined();
		expect(
			paramsError("models.addProvider", {
				id: "local-llm",
				name: "Local",
				baseUrl: "http://127.0.0.1:1/v1",
				api: "openai-completions",
				modelIds: ["m"],
			}),
		).toBeUndefined();
	});

	it("reject wrong shapes, unknown fields, and values outside the contract, naming the field", () => {
		expect(paramsError("bots.list", { extra: 1 })).toContain("extra: unknown property");
		expect(paramsError("messages.submit", { botId: "b", text: "hi" })).toContain("requestId: required");
		expect(paramsError("messages.submit", { botId: "b", requestId: 7, text: "hi" })).toContain("requestId");
		expect(paramsError("approvals.decide", { approvalId: "a", decision: "always" })).toContain("decision");
		// `deleted` is reached only through bots.delete.
		expect(paramsError("bots.update", { botId: "b", status: "deleted" })).toContain("status");
		expect(
			paramsError("models.addProvider", {
				id: "search:tavily",
				name: "x",
				baseUrl: "http://x",
				api: "openai-completions",
				modelIds: ["m"],
			}),
		).toContain("id");
		expect(
			paramsError("models.addProvider", { id: "x", name: "x", baseUrl: "http://x", api: "openai-completions", modelIds: [] }),
		).toContain("modelIds");
		for (const conversationKey of ["", "bot:", "group:", "direct:a"])
			expect(paramsError("conversations.markRead", { conversationKey, through: 1 })).toBeDefined();
		for (const through of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1])
			expect(paramsError("conversations.markRead", { conversationKey: "bot:a", through })).toBeDefined();
		expect(paramsError("conversations.snapshot", null)).toBeDefined();
		for (const params of [
			{ query: "x".repeat(201) },
			{ query: "x", unreadOnly: 1 },
			{ query: "x", cursor: "" },
			{ query: "x", regex: true },
		])
			expect(paramsError("conversations.search", params)).toBeDefined();
		expect(paramsError("conversations.snapshot", [])).toBeDefined();
	});

 it("bounds observation cursors and wait deadlines", () => {
  expect(paramsError("observation.wait", {})).toBeUndefined();
  expect(paramsError("observation.wait", {cursor:{streamId:"host",seq:0},waitMs:5000})).toBeUndefined();
  for (const params of [{waitMs:-1},{waitMs:5001},{waitMs:0.5},{cursor:{streamId:"",seq:0}},{cursor:{streamId:"x".repeat(129),seq:0}},{cursor:{streamId:"x",seq:Number.MAX_SAFE_INTEGER+1}},{cursor:{streamId:"x",seq:-1}},{cursor:{streamId:"x",seq:0,changes:15}}])
   expect(paramsError("observation.wait",params)).toBeDefined();
 });

	it("never echoes a rejected value", () => {
		const message = paramsError("credentials.set", { providerId: "openai", apiKey: 12345678, leaked: "sk-secret" }) ?? "";
		expect(message).not.toContain("sk-secret");
		expect(message).not.toContain("12345678");
	});
});
