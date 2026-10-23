/**
 * Sandboxed preload. Exposes one named function per allowlisted Host method and lifecycle subscriptions. There is no
 * generic invoke: the renderer cannot name an IPC channel or reach `ipcRenderer`.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
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
	pickAvatar: () => ipcRenderer.invoke(CHANNELS.pickAvatar),
	attachFiles: () => ipcRenderer.invoke(CHANNELS.attachFiles),
	exportArtifact: (params) => ipcRenderer.invoke(CHANNELS.exportArtifact, params),
	// Each entry forwards exactly one allowlisted method; types come from the shared method map.
	methods: methods as OpenBotApi["methods"],
	onHostState: (listener) => subscribe<HostState>(CHANNELS.hostState, listener),
	hostState: () => ipcRenderer.invoke(CHANNELS.getHostState),
	windowActive: () => ipcRenderer.invoke(CHANNELS.getWindowActive),
	onWindowActive: (listener) => subscribe<boolean>(CHANNELS.windowActive, listener),
	pickFolder: () => ipcRenderer.invoke(CHANNELS.pickFolder),
	copyText: (text) => ipcRenderer.invoke(CHANNELS.copyText, text),
	revealPath: (path) => ipcRenderer.invoke(CHANNELS.revealPath, path),
	onOpenBot: (listener) => subscribe<string>(CHANNELS.openBot, listener),
};

contextBridge.exposeInMainWorld("openbot", api);
