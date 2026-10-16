/**
 * Sandboxed preload. Exposes one named function per allowlisted Host method and two event subscriptions. There is no
 * generic invoke: the renderer cannot name an IPC channel or reach `ipcRenderer`.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { HostEvent } from "@openbot/protocol";
import { CHANNELS, type HostState, type OpenBotApi, RENDERER_METHODS } from "../shared/api";

const methods = Object.fromEntries(
	RENDERER_METHODS.map((method) => [method, (params: unknown) => ipcRenderer.invoke(CHANNELS.call, method, params)]),
);

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
	const handler = (_event: IpcRendererEvent, value: T): void => listener(value);
	ipcRenderer.on(channel, handler);
	return () => ipcRenderer.removeListener(channel, handler);
}

const api: OpenBotApi = {
	// Each entry forwards exactly one allowlisted method; types come from the shared method map.
	methods: methods as OpenBotApi["methods"],
	onEvent: (listener) => subscribe<HostEvent>(CHANNELS.event, listener),
	onHostState: (listener) => subscribe<HostState>(CHANNELS.hostState, listener),
	hostState: () => ipcRenderer.invoke(CHANNELS.getHostState),
	pickFolder: () => ipcRenderer.invoke(CHANNELS.pickFolder),
	copyText: (text) => ipcRenderer.invoke(CHANNELS.copyText, text),
	revealPath: (path) => ipcRenderer.invoke(CHANNELS.revealPath, path),
	onOpenBot: (listener) => subscribe<string>(CHANNELS.openBot, listener),
};

contextBridge.exposeInMainWorld("openbot", api);
