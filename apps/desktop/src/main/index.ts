/**
 * Electron main: application lifecycle, the single window, the menu-bar item, and the only connection to the Host
 * Runtime. The renderer reaches the Host exclusively through the allowlisted methods in `ipc.ts`.
 */
import { join, resolve } from "node:path";
import { app, BrowserWindow, Menu, nativeImage, powerMonitor, session, shell, Tray } from "electron";
import { CHANNELS, type HostState } from "../shared/api";
import { APP_ENTRY_URL, registerAppScheme, serveAppScheme } from "./app-protocol";
import { RotatingLog } from "./host-log";
import { HostProcess } from "./host";
import { registerIpc } from "./ipc";

/** electron-vite's renderer dev server; every other run (built, packaged, e2e) serves the renderer over `app://`. */
const devServerUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;
const HOST_LOG_LIMIT_BYTES = 5 * 1024 * 1024;

// Packaged builds run the bundled Host and executor (outside app.asar, architecture §3) on the bundled, signed Node in
// Contents/Resources; the environment cannot redirect them. In development the app path is apps/desktop and the
// Host is a sibling workspace app run by Node from PATH, with the existing environment overrides.
const runtime = app.isPackaged
	? {
			node: join(process.resourcesPath, "node"),
			hostEntry: join(process.resourcesPath, "host", "host.mjs"),
			executorEntry: join(process.resourcesPath, "host", "executor.mjs"),
		}
	: {
			node: process.env.OPENBOT_NODE ?? "node",
			hostEntry: process.env.OPENBOT_HOST_ENTRY ?? resolve(app.getAppPath(), "../local-server/src/main.ts"),
			executorEntry: process.env.OPENBOT_EXECUTOR_ENTRY,
		};

// A custom data directory (tests, parallel checkouts) also gets its own Electron profile, so the single-instance lock
// and Chromium state do not collide with the user's installed OpenBot.
if (process.env.OPENBOT_DATA_DIR !== undefined) app.setPath("userData", join(process.env.OPENBOT_DATA_DIR, "electron"));
if (!app.requestSingleInstanceLock()) app.quit();
registerAppScheme();

// Same default as the Host's own data directory.
const dataDirectory = process.env.OPENBOT_DATA_DIR ?? join(app.getPath("appData"), "OpenBot");
const hostLog = new RotatingLog(join(dataDirectory, "logs", "host.log"), HOST_LOG_LIMIT_BYTES);

let window: BrowserWindow | undefined;
/** Held for the app's lifetime: a Tray that is garbage-collected disappears from the menu bar. */
let tray: Tray | undefined;
let quitting = false;

const host = new HostProcess({
	node: runtime.node,
	entry: runtime.hostEntry,
	env: {
		PATH: process.env.PATH ?? "",
		HOME: process.env.HOME ?? "",
		USER: process.env.USER ?? "",
		TMPDIR: process.env.TMPDIR ?? "",
		...(runtime.executorEntry === undefined ? {} : { OPENBOT_EXECUTOR_ENTRY: runtime.executorEntry }),
		...(process.env.OPENBOT_DATA_DIR === undefined ? {} : { OPENBOT_DATA_DIR: process.env.OPENBOT_DATA_DIR }),
		...(process.env.OPENBOT_KEYCHAIN_SERVICE === undefined
			? {}
			: { OPENBOT_KEYCHAIN_SERVICE: process.env.OPENBOT_KEYCHAIN_SERVICE }),
		...(process.env.OPENBOT_HOME === undefined ? {} : { OPENBOT_HOME: process.env.OPENBOT_HOME }),
		...(process.env.OPENBOT_WORKSPACE === undefined ? {} : { OPENBOT_WORKSPACE: process.env.OPENBOT_WORKSPACE }),
		...(process.env.OPENBOT_TAVILY_BASE_URL === undefined
			? {}
			: { OPENBOT_TAVILY_BASE_URL: process.env.OPENBOT_TAVILY_BASE_URL }),
		...(process.env.OPENBOT_MAX_ACTIVE_RUNS === undefined
			? {}
			: { OPENBOT_MAX_ACTIVE_RUNS: process.env.OPENBOT_MAX_ACTIVE_RUNS }),
	},
	onOutput: (chunk) => hostLog.write(chunk),
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

	void created.loadURL(devServerUrl ?? APP_ENTRY_URL);
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

	if (devServerUrl === undefined) serveAppScheme(join(__dirname, "../renderer"));
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
	if (devServerUrl !== undefined) return url.startsWith(devServerUrl);
	// `app:` is not a special URL scheme, so `URL.origin` is "null"; compare scheme, host, and path explicitly.
	const parsed = URL.parse(url);
	return parsed !== null && `${parsed.protocol}//${parsed.host}${parsed.pathname}` === APP_ENTRY_URL;
}
