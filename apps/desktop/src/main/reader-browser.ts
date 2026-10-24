import { randomUUID } from "node:crypto";
import { BrowserWindow, session, WebContentsView, type WebContents } from "electron";
import { CHANNELS, type ReaderBrowserState } from "../shared/api";
import { previewDocuments, PREVIEW_CSP } from "./preview-documents";
export function isWebPage(url: unknown): boolean {
	if (typeof url !== "string" || url.length > 8192) return false;
	const parsed = URL.parse(url);
	return !!parsed && ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
}
type Reader = {
	id: string;
	owner: WebContents;
	window: BrowserWindow;
	view: WebContentsView;
	error: string;
	bounds: boolean;
	loading: boolean;
};
const readers = new Map<number, Reader>();
const sessions = new Set<number>();
function allowed(reader: Reader, url: string) {
	return isWebPage(url) || previewDocuments.read(url, reader.owner.id) !== undefined;
}
function state(reader: Reader): ReaderBrowserState {
	const wc = reader.view.webContents;
	return {
		id: reader.id,
		url: wc.getURL(),
		title: wc.getTitle(),
		loading: reader.loading,
		canGoBack: wc.navigationHistory.canGoBack(),
		canGoForward: wc.navigationHistory.canGoForward(),
		...(reader.error ? { error: reader.error } : {}),
	};
}
function publish(reader: Reader) {
	if (!reader.owner.isDestroyed() && !reader.view.webContents.isDestroyed()) reader.owner.send(CHANNELS.readerState, state(reader));
}
function find(owner: WebContents, id: unknown): Reader {
	const reader = readers.get(owner.id);
	if (!reader || reader.id !== id || reader.view.webContents.isDestroyed()) throw Error("This page is closed");
	return reader;
}
export function closeReader(ownerId: number, id?: unknown) {
	const reader = readers.get(ownerId);
	if (!reader || (id !== undefined && reader.id !== id)) return;
	readers.delete(ownerId);
	if (!reader.window.isDestroyed()) reader.window.contentView.removeChildView(reader.view);
	if (!reader.view.webContents.isDestroyed()) reader.view.webContents.close({ waitForBeforeUnload: false });
}
export function openReader(owner: WebContents, url: unknown): ReaderBrowserState {
	if (typeof url !== "string" || (!isWebPage(url) && previewDocuments.read(url, owner.id) === undefined))
		throw Error("Enter an HTTP or HTTPS page address");
	const window = BrowserWindow.fromWebContents(owner);
	if (!window) throw Error("No application window");
	closeReader(owner.id);
	const partition = session.fromPartition(`openbot-reader-${owner.id}`);
	if (!sessions.has(owner.id)) {
		sessions.add(owner.id);
		partition.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
		partition.setPermissionCheckHandler(() => false);
		partition.on("will-download", (event) => event.preventDefault());
		partition.webRequest.onBeforeRequest((details, callback) =>
			callback({
				cancel:
					!isWebPage(details.url) &&
					!details.url.startsWith("data:") &&
					!details.url.startsWith("blob:") &&
					previewDocuments.read(details.url, owner.id) === undefined,
			}),
		);
		partition.protocol.handle("preview", (request) => {
			const html = previewDocuments.read(request.url, owner.id);
			return html === undefined
				? new Response("Preview closed", { status: 404 })
				: new Response(html, {
						headers: {
							"Content-Type": "text/html; charset=utf-8",
							"Content-Security-Policy": PREVIEW_CSP,
							"Cache-Control": "no-store",
							"X-Content-Type-Options": "nosniff",
						},
					});
		});
		const ownerId = owner.id;
		owner.once("destroyed", () => {
			closeReader(ownerId);
			previewDocuments.clear(ownerId);
			void partition.clearStorageData();
		});
		owner.on("did-start-navigation", (_event, _url, _inPlace, isMainFrame) => {
			if (isMainFrame) {
				closeReader(ownerId);
				previewDocuments.clear(ownerId);
			}
		});
	}
	const view = new WebContentsView({
		webPreferences: {
			session: partition,
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			nodeIntegrationInSubFrames: false,
			nodeIntegrationInWorker: false,
			webSecurity: true,
			allowRunningInsecureContent: false,
			webviewTag: false,
			backgroundThrottling: false,
		},
	});
	const reader: Reader = { id: randomUUID(), owner, window, view, error: "", bounds: false, loading: true };
	readers.set(owner.id, reader);
	view.setVisible(false);
	view.setBackgroundColor("#ffffff");
	window.contentView.addChildView(view);
	const wc = view.webContents;
	const navigate = (event: Electron.Event, url: string) => {
		if (!allowed(reader, url)) {
			event.preventDefault();
			reader.error = "This address cannot open in the reader";
			view.setVisible(false);
			publish(reader);
		}
	};
	wc.on("will-navigate", navigate);
	wc.on("will-redirect", navigate);
	wc.on("will-frame-navigate", (event) => {
		if (!allowed(reader, event.url) && !event.url.startsWith("about:") && !event.url.startsWith("blob:") && !event.url.startsWith("data:"))
			event.preventDefault();
	});
	wc.setWindowOpenHandler(({ url }) => {
		if (allowed(reader, url)) void wc.loadURL(url).catch(() => {});
		return { action: "deny" };
	});
	wc.on("did-start-loading", () => {
		reader.loading = true;
		reader.error = "";
		view.setVisible(false);
		publish(reader);
	});
	wc.on("did-stop-loading", () => {
		reader.loading = false;
		view.setVisible(reader.bounds && !reader.error);
		publish(reader);
	});
	wc.on("did-navigate", () => publish(reader));
	wc.on("did-navigate-in-page", () => publish(reader));
	wc.on("page-title-updated", () => publish(reader));
	wc.on("did-fail-load", (_event, code, description, _url, main) => {
		if (main && code !== -3) {
			reader.error = description;
			reader.loading = false;
			view.setVisible(false);
			publish(reader);
		}
	});
	wc.on("render-process-gone", () => {
		reader.error = "The page stopped. Reload to try again.";
		reader.loading = false;
		view.setVisible(false);
		publish(reader);
	});
	wc.on("before-input-event", (event, input) => {
		if (input.type === "keyDown" && input.key === "Escape") {
			event.preventDefault();
			owner.send(CHANNELS.readerState, { ...state(reader), closed: true });
			closeReader(owner.id, reader.id);
			owner.focus();
		}
	});
	void wc.loadURL(url).catch((error) => {
		if (error.code === "ERR_ABORTED" || error.errno === -3) return;
		if (readers.get(owner.id) === reader && !wc.isDestroyed()) {
			reader.error = String(error.message ?? error);
			reader.loading = false;
			view.setVisible(false);
			publish(reader);
		}
	});
	return state(reader);
}
export function readerAction(owner: WebContents, id: unknown, action: unknown, url?: unknown): ReaderBrowserState {
	const reader = find(owner, id),
		wc = reader.view.webContents;
	if (action === "navigate") {
		if (!isWebPage(url) && !(typeof url === "string" && previewDocuments.read(url, owner.id) !== undefined))
			throw Error("Enter an HTTP or HTTPS page address");
		void wc.loadURL(url as string).catch(() => {});
	} else if (action === "back") {
		if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
	} else if (action === "forward") {
		if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
	} else if (action === "reload") wc.reload();
	else if (action === "focus") wc.focus();
	else if (action !== "state") throw Error("Unknown page action");
	return state(reader);
}
export function readerBounds(owner: WebContents, id: unknown, value: unknown): void {
	const reader = find(owner, id);
	if (typeof value !== "object" || !value) throw Error("Invalid page bounds");
	const { x, y, width, height, zoom } = value as Record<string, unknown>;
	if (![x, y, width, height, zoom].every((n) => typeof n === "number" && Number.isFinite(n)) || Number(zoom) < 0.6 || Number(zoom) > 1.8)
		throw Error("Invalid page bounds");
	const [w = 0, h = 0] = reader.window.getContentSize(),
		left = Math.max(0, Math.min(w, Math.round(Number(x)))),
		top = Math.max(0, Math.min(h, Math.round(Number(y))));
	const bounds = {
		x: left,
		y: top,
		width: Math.max(0, Math.min(w - left, Math.round(Number(width)))),
		height: Math.max(0, Math.min(h - top, Math.round(Number(height)))),
	};
	reader.bounds = bounds.width > 0 && bounds.height > 0;
	reader.view.setBounds(bounds);
	reader.view.webContents.setZoomFactor(Number(zoom));
	reader.view.setVisible(reader.bounds && !reader.loading && !reader.error);
}
