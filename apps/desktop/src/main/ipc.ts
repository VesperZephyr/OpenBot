/**
 * The renderer's only path to the Host. Each call is checked against the method allowlist and the sending frame
 * before it is forwarded. Errors keep their protocol code so the renderer can show actionable messages.
 */
import { BrowserWindow, ipcMain } from "electron";
import { ProtocolError } from "@openbot/protocol";
import { CHANNELS, RENDERER_METHODS, type RendererMethod } from "../shared/api";
import { FolderSelections } from "./folder-picker";
import type { HostProcess } from "./host";

export type IpcOptions = {
	readonly host: HostProcess;
	/** Accepts only the application's own renderer document. */
	readonly isTrustedFrame: (url: string) => boolean;
};

const allowed: ReadonlySet<string> = new Set(RENDERER_METHODS);

export function registerIpc({ host, isTrustedFrame }: IpcOptions): void {
	const folders = new FolderSelections();
	ipcMain.handle(CHANNELS.call, async (event, method: unknown, params: unknown) => {
		const frameUrl = event.senderFrame?.url ?? "";
		if (!isTrustedFrame(frameUrl)) throw new Error("[invalid_request] Call from an untrusted frame");
		if (typeof method !== "string" || !allowed.has(method)) throw new Error(`[unknown_method] ${String(method)}`);
		if (typeof params !== "object" || params === null) throw new Error("[invalid_request] Parameters must be an object");
		try {
			// `grants.add` carries a picker token, never a path: main swaps in the folder the user chose.
			if (method === "grants.add") {
				const { selection, access } = params as { selection?: unknown; access?: unknown };
				if (access !== "read" && access !== "readwrite") throw new Error("[invalid_request] Unknown access");
				return await host.call("grants.add", { path: folders.take(selection, event.sender.id), access });
			}
			// The allowlist check above narrows `method`; parameters are validated by schema in M2.
			return await host.call(method as RendererMethod, params as never);
		} catch (error) {
			// Electron serializes only the message across IPC, so the code travels as a prefix.
			if (error instanceof ProtocolError) throw new Error(`[${error.code}] ${error.message}`);
			throw error;
		}
	});

	ipcMain.handle(CHANNELS.getHostState, (event) => {
		if (!isTrustedFrame(event.senderFrame?.url ?? "")) throw new Error("[invalid_request] Call from an untrusted frame");
		return host.state;
	});

	ipcMain.handle(CHANNELS.pickFolder, async (event) => {
		if (!isTrustedFrame(event.senderFrame?.url ?? "")) throw new Error("[invalid_request] Call from an untrusted frame");
		const window = BrowserWindow.fromWebContents(event.sender);
		if (window === null) throw new Error("[invalid_request] No window to attach the dialog to");
		return folders.pick(window, event.sender.id);
	});
}
