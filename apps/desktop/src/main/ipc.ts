/**
 * The renderer's only path to the Host. Each call is checked against the method allowlist and the sending frame
 * before it is forwarded. Errors keep their protocol code so the renderer can show actionable messages.
 */
import { ipcMain } from "electron";
import { ProtocolError } from "@openbot/protocol";
import { CHANNELS, RENDERER_METHODS, type RendererMethod } from "../shared/api";
import type { HostProcess } from "./host";

export type IpcOptions = {
	readonly host: HostProcess;
	/** Accepts only the application's own renderer document. */
	readonly isTrustedFrame: (url: string) => boolean;
};

const allowed: ReadonlySet<string> = new Set(RENDERER_METHODS);

export function registerIpc({ host, isTrustedFrame }: IpcOptions): void {
	ipcMain.handle(CHANNELS.call, async (event, method: unknown, params: unknown) => {
		const frameUrl = event.senderFrame?.url ?? "";
		if (!isTrustedFrame(frameUrl)) throw new Error("[invalid_request] Call from an untrusted frame");
		if (typeof method !== "string" || !allowed.has(method)) throw new Error(`[unknown_method] ${String(method)}`);
		if (typeof params !== "object" || params === null) throw new Error("[invalid_request] Parameters must be an object");
		try {
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
}
