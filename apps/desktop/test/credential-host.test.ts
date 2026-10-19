import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
const spawning = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: spawning.spawn }));
import { HostProcess } from "../src/main/host";
class Child extends EventEmitter {
	stdout = new PassThrough();
	stderr = new PassThrough();
	connected = true;
	exitCode = null;
	signalCode = null;
	send = vi.fn();
	kill = vi.fn();
}
afterEach(() => vi.useRealTimers());
it("never sends a stale child's credential result to its replacement or serves stale requests", async () => {
	vi.useFakeTimers();
	const first = new Child(),
		second = new Child();
	spawning.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second);
	const gate = Promise.withResolvers<any>();
	const handle = vi.fn((_request: unknown, _active: () => boolean) => gate.promise);
	const host = new HostProcess({
		node: "node",
		entry: "unused",
		env: {},
		credentials: { handle },
		onOutput: () => {},
		onEvent: () => {},
		onState: () => {},
	});
	host.start();
	const request = { kind: "credential.request", requestId: "r", operation: "get", params: { id: "model" } };
	first.emit("message", request);
	expect(handle).toHaveBeenCalledTimes(1);
	first.connected = false;
	first.emit("exit", 1, null);
	await vi.advanceTimersByTimeAsync(1000);
	expect(handle.mock.calls[0]?.[1]?.()).toBe(false);
	first.emit("message", request);
	expect(handle).toHaveBeenCalledTimes(1);
	gate.resolve({ kind: "credential.response", requestId: "r", ok: true, result: { value: "synthetic" } });
	await Promise.resolve();
	expect(first.send).not.toHaveBeenCalled();
	expect(second.send).not.toHaveBeenCalled();
	second.emit("message", { ...request, requestId: "new" });
	await Promise.resolve();
	expect(second.send).toHaveBeenCalledTimes(1);
});
