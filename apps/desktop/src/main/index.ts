/**
 * Electron main: application lifecycle, the single window, the menu-bar item, and the only connection to the Host
 * Runtime. The renderer reaches the Host exclusively through the allowlisted methods in `ipc.ts`.
 */
import { join, resolve } from "node:path";
import { app, BrowserWindow, Menu, nativeImage, powerMonitor, session, shell, Tray } from "electron";
import { CHANNELS, type HostState } from "../shared/api";
import { HostProcess } from "./host";
import { registerIpc } from "./ipc";

const isDev = !app.isPackaged;
// In development the app path is apps/desktop; the Host entry is a sibling app in the workspace. Packaged builds
// ship the Host outside app.asar (architecture §3) and set OPENBOT_HOST_ENTRY.
const hostEntry = process.env.OPENBOT_HOST_ENTRY ?? resolve(app.getAppPath(), "../local-server/src/main.ts");

if (!app.requestSingleInstanceLock()) app.quit();

let window: BrowserWindow | undefined;
/** Held for the app's lifetime: a Tray that is garbage-collected disappears from the menu bar. */
let tray: Tray | undefined;
let quitting = false;

const host = new HostProcess({
	// Development runs the Host on Node from PATH; packaged builds bundle a pinned, signed Node (architecture §3).
	node: process.env.OPENBOT_NODE ?? "node",
	entry: hostEntry,
	env: {
		PATH: process.env.PATH ?? "",
		HOME: process.env.HOME ?? "",
		USER: process.env.USER ?? "",
		TMPDIR: process.env.TMPDIR ?? "",
		...(process.env.OPENBOT_DATA_DIR === undefined ? {} : { OPENBOT_DATA_DIR: process.env.OPENBOT_DATA_DIR }),
		...(process.env.OPENBOT_KEYCHAIN_SERVICE === undefined
			? {}
			: { OPENBOT_KEYCHAIN_SERVICE: process.env.OPENBOT_KEYCHAIN_SERVICE }),
		...(process.env.OPENBOT_HOME === undefined ? {} : { OPENBOT_HOME: process.env.OPENBOT_HOME }),
	},
	onEvent: (event) => window?.webContents.send(CHANNELS.event, event),
	onState: (state: HostState) => window?.webContents.send(CHANNELS.hostState, state),
});

function createWindow(): BrowserWindow {
	const created = new BrowserWindow({
		width: 1280,
		height: 820,
		minWidth: 880,
		minHeight: 560,
		title: "OpenBot",
		titleBarStyle: "hiddenInset",
		trafficLightPosition: { x: 16, y: 16 },
		backgroundColor: "#0e0e10",
		show: false,
		webPreferences: {
			preload: join(__dirname, "../preload/index.cjs"),
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
			webSecurity: true,
		},
	});

	created.once("ready-to-show", () => created.show());
	// Closing the window keeps the app and its Bots running in the menu bar (architecture §8.1).
	created.on("close", (event) => {
		if (quitting) return;
		event.preventDefault();
		created.hide();
	});

	// No navigation away from the app, no new windows; https links open in the user's browser.
	created.webContents.on("will-navigate", (event) => event.preventDefault());
	created.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith("https://")) void shell.openExternal(url);
		return { action: "deny" };
	});

	if (isDev && process.env.ELECTRON_RENDERER_URL !== undefined) void created.loadURL(process.env.ELECTRON_RENDERER_URL);
	else void created.loadFile(join(__dirname, "../renderer/index.html"));
	return created;
}

function showWindow(): void {
	if (window === undefined || window.isDestroyed()) window = createWindow();
	window.show();
	window.focus();
}

function createTray(): Tray {
	const icon = nativeImage.createFromNamedImage("NSImageNameTouchBarComposeTemplate");
	icon.setTemplateImage(true);
	const created = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 18, height: 18 }));
	created.setToolTip("OpenBot");
	created.setContextMenu(
		Menu.buildFromTemplate([
			{ label: "Open OpenBot", click: showWindow },
			{ type: "separator" },
			{ label: "Quit OpenBot", role: "quit" },
		]),
	);
	return created;
}

app.on("second-instance", showWindow);
app.on("activate", showWindow);
app.on("before-quit", (event) => {
	if (quitting) return;
	quitting = true;
	event.preventDefault();
	void host.stop().finally(() => app.quit());
});

void app.whenReady().then(() => {
	// Deny every web permission (camera, notifications, geolocation, …) by default.
	session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
	session.defaultSession.setPermissionCheckHandler(() => false);

	registerIpc({ host, isTrustedFrame: (url) => isTrustedRendererUrl(url) });
	host.start();
	window = createWindow();
	tray = createTray();

	// Lifecycle events reach the Host in M1 to gate execution (architecture §8.1); logged for now.
	powerMonitor.on("suspend", () => console.log("[openbot] power event: suspend"));
	powerMonitor.on("resume", () => console.log("[openbot] power event: resume"));
	powerMonitor.on("lock-screen", () => console.log("[openbot] power event: lock-screen"));
	powerMonitor.on("unlock-screen", () => console.log("[openbot] power event: unlock-screen"));
});

function isTrustedRendererUrl(url: string): boolean {
	if (isDev && process.env.ELECTRON_RENDERER_URL !== undefined) return url.startsWith(process.env.ELECTRON_RENDERER_URL);
	return url.startsWith("file://") && url.includes("/renderer/index.html");
}
