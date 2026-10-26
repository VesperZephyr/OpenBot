import { describe, expect, it, vi } from "vitest";
import type { LifecycleRecord, NativeLifecycle } from "@openbot/protocol";
import { LifecycleController } from "../src/lifecycle.ts";
const native = (seq: number, change: Partial<NativeLifecycle> = {}): NativeLifecycle => ({
	sourceId: "desktop",
	seq,
	locked: false,
	suspended: false,
	quitting: false,
	...change,
});
function fixture(nativeRequired = false) {
	let saved: LifecycleRecord = { revision: 0, userPaused: false, needsResume: false };
	const store = {
		read: async () => saved,
		write: vi.fn(async (value: LifecycleRecord) => {
			saved = { ...value };
		}),
	};
	const suspend = vi.fn(async () => {}),
		resume = vi.fn(async () => {}),
		options = { store, suspend, resume, targetId: "mac", nativeRequired, changed: () => {} };
	return {
		store,
		suspend,
		resume,
		options,
		get saved() {
			return saved;
		},
		controller: new LifecycleController(options),
	};
}
describe("lifecycle authority", () => {
	it("starts closed until native state and ignores stale or foreign observations", async () => {
		const f = fixture(true);
		await f.controller.start();
		expect(() => f.controller.assertAllowed()).toThrow("paused");
		await f.controller.native(native(1));
		expect(f.controller.state.blocked).toBe(false);
		await f.controller.native(native(3, { locked: true }));
		expect(f.controller.state).toMatchObject({ blocked: false, locked: true, needsResume: false });
		await f.controller.native(native(2));
		expect(f.controller.state.locked).toBe(true);
		expect(() => f.controller.native(native(4, { sourceId: "other" }))).toThrow("source");
		await f.controller.native(native(4));
		expect(f.controller.state.blocked).toBe(false);
		expect(f.suspend).not.toHaveBeenCalled();
	});
	it("aborts generation synchronously and only renews its signal on explicit safe resume", async () => {
		const f = fixture(true);
		await f.controller.start();
		await f.controller.native(native(1));
		const signal = f.controller.signal;
		await f.controller.native(native(2));
		expect(f.controller.signal).toBe(signal);
		const paused = f.controller.pause();
		expect(signal.aborted).toBe(true);
		await paused;
		await f.controller.native(native(3));
		expect(f.controller.signal.aborted).toBe(true);
		await f.controller.resume();
		expect(f.controller.signal).not.toBe(signal);
		expect(f.controller.signal.aborted).toBe(false);
	});

	it("persists explicit pause across reopen and never clears it on wake or unlock", async () => {
		const f = fixture(true);
		await f.controller.start();
		await f.controller.native(native(1));
		await f.controller.pause();
		const reopened = new LifecycleController(f.options);
		await reopened.start();
		await reopened.native(native(1));
		expect(reopened.state).toMatchObject({ blocked: true, userPaused: true });
		await reopened.native(native(2, { locked: true, suspended: true }));
		await reopened.native(native(3, { suspended: true }));
		await expect(reopened.resume()).rejects.toThrow("not ready");
		await reopened.native(native(4));
		expect(reopened.state.userPaused).toBe(true);
		await reopened.resume();
		expect(f.saved.needsResume).toBe(false);
	});
	it("closes authority synchronously before slow persistence or stopping", async () => {
		const f = fixture();
		await f.controller.start();
		const gate = Promise.withResolvers<void>();
		f.store.write.mockImplementationOnce(async () => gate.promise);
		const pause = f.controller.pause();
		expect(() => f.controller.assertAllowed()).toThrow("paused");
		await Promise.resolve();
		expect(f.suspend).not.toHaveBeenCalled();
		gate.resolve();
		await pause;
		expect(f.suspend).toHaveBeenCalledOnce();
	});
	it("a pause arriving during resume wins over its delayed persistence", async () => {
		const f = fixture();
		await f.controller.start();
		await f.controller.pause();
		const gate = Promise.withResolvers<void>();
		f.store.write.mockImplementationOnce(async () => gate.promise);
		const resume = f.controller.resume();
		await Promise.resolve();
		const pause = f.controller.pause();
		gate.resolve();
		await expect(resume).rejects.toThrow("not ready");
		await pause;
		expect(f.controller.state).toMatchObject({ blocked: true, userPaused: true });
		expect(f.resume).not.toHaveBeenCalled();
	});
	it("failed stop stays blocked and explicit resume must establish quiescence again", async () => {
		const f = fixture();
		await f.controller.start();
		f.suspend.mockRejectedValueOnce(Error("unknown processes"));
		await expect(f.controller.pause()).rejects.toThrow();
		expect(f.controller.state.error).toBeDefined();
		expect(f.saved.needsResume).toBe(true);
		await f.controller.resume();
		expect(f.suspend).toHaveBeenCalledTimes(2);
		expect(f.controller.state.blocked).toBe(false);
	});
	it("failed persistence cannot authorize work, and a failed resume remains durable", async () => {
		const f = fixture();
		await f.controller.start();
		f.store.write.mockRejectedValueOnce(Error("disk"));
		await expect(f.controller.pause()).rejects.toThrow("disk");
		expect(f.controller.state.blocked).toBe(true);
		expect(f.suspend).toHaveBeenCalledOnce();
		f.resume.mockRejectedValueOnce(Error("recovery"));
		await expect(f.controller.resume()).rejects.toThrow("recovery");
		expect(f.saved.needsResume).toBe(true);
		expect(f.controller.state.blocked).toBe(true);
	});
	it("idle quit closes the process gate without adding a recovery prompt", async () => {
		const f = fixture(),
			controller = new LifecycleController({ ...f.options, hasWork: () => false });
		await controller.start();
		await controller.native(native(1, { quitting: true }));
		expect(controller.state.blocked).toBe(true);
		expect(f.saved.needsResume).toBe(false);
		const reopened = new LifecycleController({ ...f.options, hasWork: () => false });
		await reopened.start();
		expect(reopened.state.blocked).toBe(false);
	});
	it("retains a quit recovery requirement for accepted group work not yet admitted as a Run", async () => {
		const f = fixture();
		const controller = new LifecycleController({ ...f.options, hasWork: async () => true });
		await controller.start();
		await controller.pause("quitting");
		expect(f.saved.needsResume).toBe(true);
	});
});

 it("automatically admits new work after confirmed suspend without clearing user pause or failed stop", async () => {
		const f = fixture(true);
		await f.controller.start();
		await f.controller.native(native(1));
		await f.controller.native(native(2, { suspended: true }));
		expect(f.saved.autoResume).toBe(true);
		await f.controller.native(native(3, { locked: true }));
		expect(f.controller.state).toMatchObject({ blocked: false, needsResume: false, locked: true });
		await f.controller.pause();
		await f.controller.native(native(4, { suspended: true }));
		await f.controller.native(native(5));
		expect(f.controller.state).toMatchObject({ blocked: true, userPaused: true });
		await f.controller.resume();
		f.suspend.mockRejectedValueOnce(Error("uncertain"));
		await expect(f.controller.native(native(6, { suspended: true }))).rejects.toThrow();
		await f.controller.native(native(7));
		expect(f.controller.state).toMatchObject({ blocked: true, autoResume: false });
 });
 it("restores confirmed suspend eligibility but retains legacy recovery and a racing user pause", async () => {
		const f = fixture(true);
		await f.controller.start();
		await f.controller.native(native(1));
		await f.controller.native(native(2, { suspended: true }));
		const reopened = new LifecycleController(f.options);
		await reopened.start();
		await reopened.native(native(1));
		expect(reopened.state.blocked).toBe(false);
		await reopened.native(native(2, { suspended: true }));
		const gate = Promise.withResolvers<void>();
		f.store.write.mockImplementationOnce(async () => gate.promise);
		const wake = reopened.native(native(3));
		await Promise.resolve();
		const pause = reopened.pause();
		gate.resolve();
		await wake.catch(() => {});
		await pause;
		expect(reopened.state).toMatchObject({ blocked: true, userPaused: true });
 });
