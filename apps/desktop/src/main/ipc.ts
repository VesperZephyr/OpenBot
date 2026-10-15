/**
 * The renderer's only path to the Host. Each call is checked against the method allowlist, the sending frame, and the
 * method's parameter schema before it is forwarded. Errors keep their protocol code so the renderer can show actionable
 * messages. Two desktop-only channels need main's privileges: writing the clipboard and revealing a file in Finder.
 */
import { BrowserWindow, clipboard, ipcMain, type IpcMainInvokeEvent, shell } from "electron";
import { ProtocolError } from "@openbot/protocol";
import { paramsError } from "@openbot/protocol/schemas";
import { CHANNELS, RENDERER_METHODS, type RendererMethod } from "../shared/api";
import { FolderSelections } from "./folder-picker";
import type { HostProcess } from "./host";

export type IpcOptions = {
	readonly host: HostProcess;
	/** Accepts only the application's own renderer document. */
	readonly isTrustedFrame: (url: string) => boolean;
};

const allowed: ReadonlySet<string> = new Set(RENDERER_METHODS);
/** Copy buttons carry code blocks; anything larger is not a copy the user meant. */
const MAX_CLIPBOARD_CHARS = 1_000_000;

export function registerIpc({ host, isTrustedFrame }: IpcOptions): void {
	const folders = new FolderSelections();
	const checkFrame = (event: IpcMainInvokeEvent): void => {
		if (!isTrustedFrame(event.senderFrame?.url ?? "")) throw new Error("[invalid_request] Call from an untrusted frame");
	};
	ipcMain.handle(CHANNELS.call, async (event, method: unknown, params: unknown) => {
		checkFrame(event);
		if (typeof method !== "string" || !allowed.has(method)) throw new Error(`[unknown_method] ${String(method)}`);
		// The allowlist check above narrows `method` to a renderer method.
		const rendererMethod = method as RendererMethod;
		try {
			// `grants.add` carries a picker token, never a path: main swaps in the folder the user chose. The Host
			// parameters are checked after the swap; the renderer's `{ selection, access }` has no Host schema.
			if (rendererMethod === "grants.add") {
				const { selection, access, ...rest } = (params ?? {}) as { selection?: unknown; access?: unknown };
				if (Object.keys(rest).length > 0) throw new Error("[invalid_request] Unknown parameters for grants.add");
				const hostParams = { path: folders.take(selection, event.sender.id), access };
				const invalidGrant = paramsError("grants.add", hostParams);
				if (invalidGrant !== undefined) throw new Error(`[invalid_request] ${invalidGrant}`);
				return await host.call("grants.add", hostParams as never);
			}
			const invalid = paramsError(rendererMethod, params);
			if (invalid !== undefined) throw new Error(`[invalid_request] ${invalid}`);
			// The schema check above proves `params` has the method's shape.
			return await host.call(rendererMethod, params as never);
		} catch (error) {
			// Electron serializes only the message across IPC, so the code travels as a prefix.
			if (error instanceof ProtocolError) throw new Error(`[${error.code}] ${error.message}`);
			throw error;
		}
	});

	ipcMain.handle(CHANNELS.getHostState, (event) => {
		checkFrame(event);
		return host.state;
	});

	ipcMain.handle(CHANNELS.pickFolder, async (event) => {
		checkFrame(event);
		const window = BrowserWindow.fromWebContents(event.sender);
		if (window === null) throw new Error("[invalid_request] No window to attach the dialog to");
		return folders.pick(window, event.sender.id);
	});

	// The session permission handler denies clipboard access to web content; copying goes through main instead.
	ipcMain.handle(CHANNELS.copyText, (event, text: unknown) => {
		checkFrame(event);
		if (typeof text !== "string" || text.length > MAX_CLIPBOARD_CHARS) throw new Error("[invalid_request] Nothing to copy");
		clipboard.writeText(text);
	});

	// The Host decides what may be revealed (an existing path inside the folders Bots may use), so the renderer
	// cannot point Finder anywhere else.
	ipcMain.handle(CHANNELS.revealPath, async (event, path: unknown) => {
		checkFrame(event);
		const invalid = paramsError("files.resolveReveal", { path });
		if (invalid !== undefined || typeof path !== "string") throw new Error(`[invalid_request] ${invalid ?? "Path must be a string"}`);
		let resolved: string | null;
		try {
			resolved = await host.call("files.resolveReveal", { path });
		} catch (error) {
			if (error instanceof ProtocolError) throw new Error(`[${error.code}] ${error.message}`);
			throw error;
		}
		if (resolved === null) throw new Error("[not_found] This file is not in a folder Bots may use any more");
		shell.showItemInFolder(resolved);
	});
}
