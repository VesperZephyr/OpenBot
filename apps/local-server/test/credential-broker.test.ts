import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { CredentialBroker } from "../src/keychain.ts";
import { isCredentialRequest, isCredentialResponse, type CredentialRequest } from "@openbot/protocol";
class Parent extends EventEmitter {
	requests: CredentialRequest[] = [];
	send(message: CredentialRequest) {
		this.requests.push(message);
	}
}
afterEach(() => vi.useRealTimers());
it("correlates before startup and ignores foreign replies", async () => {
	const parent = new Parent(),
		broker = new CredentialBroker(parent);
	const waiting = broker.request("get", { id: "model" });
	parent.emit("message", { kind: "credential.response", requestId: "foreign", ok: true, result: { value: "ignored" } });
	parent.emit("message", {
		kind: "credential.response",
		requestId: parent.requests[0]!.requestId,
		ok: true,
		result: { value: "synthetic" },
	});
	expect(await waiting).toEqual({ value: "synthetic" });
	broker.close();
});
it("rejects a response whose result does not match the pending operation", async () => {
	const parent = new Parent(),
		broker = new CredentialBroker(parent),
		waiting = broker.request("set", { id: "model", value: "x" });
	parent.emit("message", { kind: "credential.response", requestId: parent.requests[0]!.requestId, ok: true, result: { value: "secret" } });
	await expect(waiting).rejects.toThrow("Invalid credential");
	broker.close();
});
it("bounds pending requests and reports timeout as unconfirmed without retry", async () => {
	vi.useFakeTimers();
	const parent = new Parent(),
		broker = new CredentialBroker(parent);
	const pending = Array.from({ length: 8 }, () => broker.request("status", {}));
	const results = Promise.allSettled(pending);
	await expect(broker.request("status", {})).rejects.toThrow("busy");
	await vi.advanceTimersByTimeAsync(10001);
	expect((await results).every((result) => result.status === "rejected" && result.reason.message.includes("unconfirmed"))).toBe(true);
	expect(parent.requests).toHaveLength(8);
	broker.close();
});
it("rejects every request on parent disconnect and cannot reuse the channel", async () => {
	const parent = new Parent(),
		broker = new CredentialBroker(parent);
	const waiting = broker.request("get", { id: "model" });
	parent.emit("disconnect");
	await expect(waiting).rejects.toThrow("unconfirmed");
	await expect(broker.request("list", {})).rejects.toThrow("unavailable");
});
it("rejects unknown private operations, values, extra authority and diagnostics", () => {
	const request = { kind: "credential.request", requestId: "r", operation: "get", params: { id: "model" } };
	expect(isCredentialRequest(request)).toBe(true);
	for (const change of [
		{ service: "other" },
		{ operation: "exec" },
		{ params: { id: "model", path: "/keychain" } },
		{ requestId: "x".repeat(81) },
	])
		expect(isCredentialRequest({ ...request, ...change })).toBe(false);
	expect(isCredentialResponse({ kind: "credential.response", requestId: "r", ok: false, code: "denied", message: "secret" }, "get")).toBe(
		false,
	);
});
