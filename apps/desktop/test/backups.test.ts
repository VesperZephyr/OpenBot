import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import type { HostProcess } from "../src/main/host";
const mocks = vi.hoisted(() => ({ pick: vi.fn(), confirm: vi.fn(), spawn: vi.fn(), exists: vi.fn((_path: string) => false) }));
vi.mock("electron", () => ({ dialog: { showOpenDialog: mocks.pick, showMessageBox: mocks.confirm }, BrowserWindow: {} }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("node:fs", () => ({ existsSync: mocks.exists }));
import { DesktopBackups } from "../src/main/backups";
function fixture() {
	const host = { call: vi.fn().mockResolvedValue({}), start: vi.fn(), stop: vi.fn().mockResolvedValue(undefined) };
	const contents = new EventEmitter();
	const window = { webContents: contents, isDestroyed: () => false };
	const backups = new DesktopBackups({
		host: host as unknown as HostProcess,
		node: "node",
		entry: "maintenance",
		dataDirectory: "/data",
		env: {},
		language: () => "en",
	});
	mocks.pick.mockResolvedValue({ canceled: false, filePaths: ["/backups"] });
	mocks.confirm.mockResolvedValue({ response: 1 });
	return { host, contents, window: window as unknown as BrowserWindow, backups };
}
afterEach(() => {
	vi.clearAllMocks();
	mocks.exists.mockReturnValue(false);
});
it("cancellation does not pause or stop the Host", async () => {
	const f = fixture();
	mocks.confirm.mockResolvedValue({ response: 0 });
	expect(await f.backups.run(f.window, "export")).toBeNull();
	expect(f.host.call).not.toHaveBeenCalled();
	expect(f.host.stop).not.toHaveBeenCalled();
});
it("expires confirmation after renderer navigation", async () => {
	const f = fixture();
	let answer!: (value: unknown) => void;
	mocks.confirm.mockImplementation(
		() =>
			new Promise((resolve) => {
				answer = resolve;
			}),
	);
	const work = f.backups.run(f.window, "restore");
	await vi.waitFor(() => expect(answer).toBeTypeOf("function"));
	f.contents.emit("did-start-navigation", {}, "app://", false, true);
	answer({ response: 1 });
	await expect(work).rejects.toThrow("expired");
	expect(f.host.stop).not.toHaveBeenCalled();
});
it("waits for maintenance and Host restart before allowing quit", async () => {
	const f = fixture();
	let child: any;
	mocks.spawn.mockImplementation(() => {
		child = new EventEmitter();
		child.stdout = new EventEmitter();
		child.stderr = new EventEmitter();
		child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
		return child;
	});
	const work = f.backups.run(f.window, "export");
	await vi.waitFor(() => expect(child).toBeDefined());
	expect(f.backups.busy).toBe(true);
	let done = false;
	const closing = f.backups.shutdown().then(() => {
		done = true;
	});
	await Promise.resolve();
	expect(done).toBe(false);
	child.stdout.emit("data", JSON.stringify({ action: "export", path: "/backup", files: 1, bytes: 1 }));
	child.emit("exit", 0);
	await work;
	await closing;
	expect(f.host.start).toHaveBeenCalledOnce();
	expect(f.host.call).toHaveBeenLastCalledWith("host.status", {});
	expect(done).toBe(true);
	await expect(f.backups.run(f.window, "export")).rejects.toThrow("unavailable");
});
it("refuses maintenance after an unconfirmed Host shutdown", async () => {
	const f = fixture();
	mocks.exists.mockImplementation((path: any) => String(path).endsWith("host.lock"));
	await expect(f.backups.run(f.window, "export")).rejects.toThrow("shutdown could not be confirmed");
	expect(mocks.spawn).not.toHaveBeenCalled();
	expect(f.host.start).toHaveBeenCalledOnce();
});
