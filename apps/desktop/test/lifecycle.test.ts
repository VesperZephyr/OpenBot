import { describe, expect, it, vi } from "vitest";
import type { HostProcess } from "../src/main/host";
import { NativeLifecycleBridge } from "../src/main/lifecycle";
describe("NativeLifecycleBridge", () => {
	it("sends only the latest full observation when a Host becomes ready", async () => {
		const host = { state: { status: "starting" }, call: vi.fn().mockResolvedValue({}) };
		const bridge = new NativeLifecycleBridge(host as unknown as HostProcess, vi.fn());
		await bridge.update({ locked: true });
		await bridge.update({ suspended: true });
		await bridge.update({ locked: false });
		expect(host.call).not.toHaveBeenCalled();
		host.state = { status: "ready" };
		await bridge.ready();
		expect(host.call).toHaveBeenCalledWith("lifecycle.native", {
			sourceId: expect.any(String),
			seq: 3,
			locked: false,
			suspended: true,
			quitting: false,
		});
		await bridge.update({ quitting: true });
		expect(host.call.mock.calls.at(-1)?.[1]).toMatchObject({ seq: 4, suspended: true, quitting: true });
	});
	it("reports failed delivery without replacing the last native observation", async () => {
		const failure = vi.fn(),
			host = { state: { status: "ready" }, call: vi.fn().mockRejectedValueOnce(Error("offline")).mockResolvedValue({}) };
		const bridge = new NativeLifecycleBridge(host as unknown as HostProcess, failure);
		await bridge.update({ locked: true });
		expect(failure).toHaveBeenCalledOnce();
		await bridge.ready();
		expect(host.call.mock.calls[1]?.[1]).toEqual(host.call.mock.calls[0]?.[1]);
	});
});
