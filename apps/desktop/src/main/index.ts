import { createRequire } from "node:module";
import { credentialStorageLocation, DesktopCredentials, type NativeKeychain } from "./credentials";
import { NativeLifecycleBridge } from "./lifecycle";
/**
 * Electron main: application lifecycle, the single window, the menu-bar item, and the only connection to the Host
 * Runtime. The renderer reaches the Host exclusively through the allowlisted methods in `ipc.ts`.
 */
import { join, resolve } from "node:path";
import { app, BrowserWindow, Menu, nativeImage, powerMonitor, session, shell, Tray } from "electron";
import { CHANNELS, type HostState } from "../shared/api";
import { APP_ENTRY_URL, registerAppScheme, serveAppScheme } from "./app-protocol";
import { AttentionWatcher } from "./attention-watcher";
import { RotatingLog } from "./host-log";
import { HostProcess } from "./host";
import { registerIpc } from "./ipc";
import { resolveLoginPath } from "./login-path";
import { translate, type Language } from "../shared/i18n";
import { desktopTestMode } from "./test-mode";

/** electron-vite's renderer dev server; every other run (built, packaged, e2e) serves the renderer over `app://`. */
const devServerUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;
const HOST_LOG_LIMIT_BYTES = 5 * 1024 * 1024;
const testMode = desktopTestMode(app.isPackaged, process.env);
const backgroundTest = testMode === "background";
if (backgroundTest && process.platform === "darwin") {
	app.setActivationPolicy("prohibited");
	app.dock?.hide();
}

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
let language: Language = "en";
let quitting = false;

/** Development and test overrides; a packaged app ignores them, so the environment cannot redirect its keys or limits. */
const DEV_OVERRIDES = ["OPENBOT_WORKSPACE", "OPENBOT_TAVILY_BASE_URL", "OPENBOT_MAX_ACTIVE_RUNS", "OPENBOT_EXEC_YIELD_MS"] as const;
const forwarded = (names: readonly string[]): Record<string, string> =>
	Object.fromEntries(names.flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name]]])));

const hostEnvironment: NodeJS.ProcessEnv = {
	OPENBOT_DESKTOP_LIFECYCLE: "1",
	PATH: process.env.PATH ?? "",
	HOME: process.env.HOME ?? "",
	USER: process.env.USER ?? "",
	TMPDIR: process.env.TMPDIR ?? "",
	...(runtime.executorEntry === undefined ? {} : { OPENBOT_EXECUTOR_ENTRY: runtime.executorEntry }),
	// Where data and the model configuration live may be moved in any build.
	...forwarded(["OPENBOT_DATA_DIR", "OPENBOT_HOME"]),
	// Trust only the isolated fixture CA during explicit, unpackaged test runs.
	...(testMode ? forwarded(["NODE_EXTRA_CA_CERTS"]) : {}),
	...(app.isPackaged ? {} : forwarded(DEV_OVERRIDES)),
};

const credentialLocation = credentialStorageLocation({
	packaged: app.isPackaged,
	dataDirectory,
	isolatedDataDirectory: process.env.OPENBOT_DATA_DIR !== undefined,
	serviceOverride: process.env.OPENBOT_KEYCHAIN_SERVICE,
});
const nativeKeychain = createRequire(import.meta.url)(
	app.isPackaged ? join(process.resourcesPath, "native/keychain.node") : join(app.getAppPath(), "out/native/keychain.node"),
) as NativeKeychain;
const credentials = new DesktopCredentials(credentialLocation.directory, credentialLocation.service, {
	access: (operation, service, account, value) => {
		if (testMode && process.env.OPENBOT_TEST_KEYCHAIN_DENIED === "1") return Promise.reject(new Error("denied"));
		return operation === "set"
			? nativeKeychain.access(operation, service, account, value)
			: nativeKeychain.access(operation, service, account);
	},
});
const host = new HostProcess({
	credentials,
	node: runtime.node,
	entry: runtime.hostEntry,
	env: hostEnvironment,
	onOutput: (chunk) => hostLog.write(chunk),
	// Both callbacks first fire after `host.start()` below, when `attentionWatcher` exists.
	onEvent: (event) => {
		attentionWatcher.onEvent(event);
	},
	onState: (state: HostState) => {
		attentionWatcher.onHostState(state);
		if (state.status === "ready") void nativeLifecycle.ready();
		window?.webContents.send(CHANNELS.hostState, state);
	},
});

const nativeLifecycle = new NativeLifecycleBridge(host, () =>
	console.error("[openbot] lifecycle synchronization failed; work remains gated"),
);

const attentionWatcher = new AttentionWatcher({
	host,
	nativeEffects: testMode === undefined,
	language: () => language,
	focused: () => BrowserWindow.getFocusedWindow() !== null,
	openBot: (botId) => {
		showWindow();
		window?.webContents.send(CHANNELS.openBot, botId);
	},
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
		backgroundColor: "#ffffff",
		show: false,
		focusable: !backgroundTest,
		webPreferences: {
			preload: join(__dirname, "../preload/index.cjs"),
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
			webSecurity: true,
			...(backgroundTest ? { backgroundThrottling: false } : {}),
		},
	});

	const publishActive = () =>
		created.webContents.send(CHANNELS.windowActive, created.isVisible() && created.isFocused() && !created.isMinimized());
	created.on("show", publishActive);
	created.on("hide", publishActive);
	created.on("focus", publishActive);
	created.on("blur", publishActive);
	created.on("minimize", publishActive);
	created.on("restore", publishActive);
	if (!backgroundTest) created.once("ready-to-show", () => created.show());
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
	if (backgroundTest) return;
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
			{ label: translate(language, "Open OpenBot"), click: showWindow },
			{ type: "separator" },
			{ label: translate(language, "Quit OpenBot"), role: "quit" },
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
	attentionWatcher.stop();
	void nativeLifecycle
		.update({ quitting: true })
		.finally(() => host.stop())
		.finally(() => app.quit());
});

void app.whenReady().then(async () => {
	// Deny every web permission (camera, notifications, geolocation, …) by default.
	session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
	session.defaultSession.setPermissionCheckHandler(() => false);

	if (devServerUrl === undefined) serveAppScheme(join(__dirname, "../renderer"));
	registerIpc({
		host,
		isTrustedFrame: (url) => isTrustedRendererUrl(url),
		language: () => language,
		onSettings: (settings) => {
			const next = settings.language ?? "en";
			if (next === language) return;
			language = next;
			if (tray) {
				tray.destroy();
				tray = createTray();
			}
		},
	});
	window = createWindow();
	if (testMode === undefined) tray = createTray();

	// Main is the only authority for native session state. Test emitters never lock or suspend the real Mac.
	void nativeLifecycle.update({ locked: powerMonitor.getSystemIdleState(1) === "locked" });
	powerMonitor.on("suspend", () => void nativeLifecycle.update({ suspended: true }));
	powerMonitor.on("resume", () => void nativeLifecycle.update({ suspended: false }));
	powerMonitor.on("lock-screen", () => void nativeLifecycle.update({ locked: true }));
	powerMonitor.on("unlock-screen", () => void nativeLifecycle.update({ locked: false }));

	hostEnvironment.PATH = await resolveLoginPath(process.env);
	if (!quitting) host.start();
});

function isTrustedRendererUrl(url: string): boolean {
	if (devServerUrl !== undefined) return url.startsWith(devServerUrl);
	// `app:` is not a special URL scheme, so `URL.origin` is "null"; compare scheme, host, and path explicitly.
	const parsed = URL.parse(url);
	return parsed !== null && `${parsed.protocol}//${parsed.host}${parsed.pathname}` === APP_ENTRY_URL;
}
