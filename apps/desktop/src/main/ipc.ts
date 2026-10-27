import type { DesktopBackups } from "./backups";
const readerSelectionKey = randomUUID();
import { openReader, closeReader, readerAction, readerBounds } from "./reader-browser";
import { previewDocuments } from "./preview-documents";
import { createHmac, randomUUID } from "node:crypto";
import { translate } from "../shared/i18n";
import type { ArtifactRef } from "@openbot/protocol";
/**
 * The renderer's only path to the Host. Each call is checked against the method allowlist, the sending frame, and the
 * method's parameter schema before it is forwarded. Errors keep their protocol code so the renderer can show actionable
 * messages. Desktop-only channels also handle native pickers, clipboard access and revealing files in Finder.
 */
import { BrowserWindow, clipboard, dialog, ipcMain, nativeImage, type IpcMainInvokeEvent, shell } from "electron";
import type { RedactedSettings } from "@openbot/protocol";
import type { Language } from "../shared/i18n";
import { AVATAR_LIMITS, ProtocolError } from "@openbot/protocol";
import { paramsError } from "@openbot/protocol/schemas";
import { CHANNELS, RENDERER_METHODS, type RendererMethod } from "../shared/api";
import { FolderSelections } from "./folder-picker";
import type { HostProcess } from "./host";

export type IpcOptions = {
	readonly host: HostProcess;
	readonly backups?: DesktopBackups;
	readonly language?: () => Language;
	readonly onSettings?: (settings: RedactedSettings) => void;
	/** Accepts only the application's own renderer document. */
	readonly isTrustedFrame: (url: string) => boolean;
};

const allowed: ReadonlySet<string> = new Set(RENDERER_METHODS);
/** Copy buttons carry code blocks; anything larger is not a copy the user meant. */
const MAX_CLIPBOARD_CHARS = 1_000_000;

export function registerIpc({ host, backups, isTrustedFrame, language, onSettings }: IpcOptions): void {
	const folders = new FolderSelections();
	const restored = new WeakSet<Electron.WebContents>();
	const checkFrame = (event: IpcMainInvokeEvent): void => {
		if (event.senderFrame !== event.sender.mainFrame || !isTrustedFrame(event.senderFrame?.url ?? ""))
			throw new Error("[invalid_request] Call from an untrusted frame");
	};
	ipcMain.handle(CHANNELS.call, async (event, method: unknown, params: unknown) => {
		checkFrame(event);
		if (typeof method !== "string" || !allowed.has(method)) throw new Error(`[unknown_method] ${String(method)}`);
		if (backups?.busy) {
			if (!/\.(get|list|status|snapshot|wait|search|read|preview)$/.test(method)) throw new Error("Backup maintenance is running; wait for completion");
			await backups.idle();
			checkFrame(event);
		}
		// The allowlist check above narrows `method` to a renderer method.
		const rendererMethod = method as RendererMethod;
		try {
			// `grants.add` carries a picker token, never a path: main swaps in the folder the user chose. The Host
			// parameters are checked after the swap; the renderer's `{ selection, access }` has no Host schema.
			if (rendererMethod === "grants.add") {
				const { selection, access, ...rest } = (typeof params === "object" && params !== null ? params : {}) as {
					selection?: unknown;
					access?: unknown;
				};
				if (Object.keys(rest).length > 0) throw new Error("[invalid_request] Unknown parameters for grants.add");
				// Check what the renderer controls before the one-time picker token is spent.
				if (access !== "read" && access !== "readwrite") throw new Error("[invalid_request] access must be read or readwrite");
				const hostParams = { path: folders.take(selection, event.sender.id), access };
				const invalidGrant = paramsError("grants.add", hostParams);
				if (invalidGrant !== undefined) throw new Error(`[invalid_request] ${invalidGrant}`);
				return await host.call("grants.add", hostParams as never);
			}
			const invalid = paramsError(rendererMethod, params);
			if (invalid !== undefined) throw new Error(`[invalid_request] ${invalid}`);
			// The schema check above proves `params` has the method's shape.
			const result = await host.call(rendererMethod, params as never);
			if (rendererMethod === "settings.get" || rendererMethod === "settings.update") onSettings?.(result as RedactedSettings);
			return result;
		} catch (error) {
			// Electron serializes only the message across IPC, so the code travels as a prefix.
			if (error instanceof ProtocolError) throw new Error(`[${error.code}] ${error.message}`);
			throw error;
		}
	});

	ipcMain.handle(CHANNELS.reloadAfterRestore, (event) => {
		checkFrame(event);
		if (!restored.delete(event.sender)) throw Error("No completed restore to reload");
		setImmediate(() => { if (!event.sender.isDestroyed()) event.sender.reload(); });
	});
	ipcMain.handle(CHANNELS.backup, async (event, action: unknown, ...extra: unknown[]) => {
		checkFrame(event);
		if ((action !== "export" && action !== "restore") || extra.length || !backups) throw Error("Invalid backup operation");
		const window = BrowserWindow.fromWebContents(event.sender);
		if (!window) throw Error("No application window");
		const result = await backups.run(window, action);
		if (result?.action === "restore") restored.add(event.sender);
		return result;
	});

	ipcMain.handle(CHANNELS.readerOpen, (event, url: unknown) => {
		checkFrame(event);
		return openReader(event.sender, url);
	});
	ipcMain.handle(CHANNELS.readerAction, (event, id: unknown, action: unknown, url: unknown) => {
		checkFrame(event);
		return readerAction(event.sender, id, action, url);
	});
	ipcMain.handle(CHANNELS.readerBounds, (event, id: unknown, bounds: unknown) => {
		checkFrame(event);
		readerBounds(event.sender, id, bounds);
	});
	ipcMain.handle(CHANNELS.readerClose, (event, id: unknown) => {
		checkFrame(event);
		closeReader(event.sender.id, id);
	});
	ipcMain.handle(CHANNELS.previewHtml, (event, html: unknown) => {
		checkFrame(event);
		return previewDocuments.create(event.sender.id, html);
	});
	ipcMain.handle(CHANNELS.closeHtmlPreview, (event, url: unknown) => {
		checkFrame(event);
		previewDocuments.revoke(event.sender.id, url);
	});
	ipcMain.handle(CHANNELS.openFile, async (event, ...args: unknown[]) => {
		checkFrame(event);
		if (args.length) throw Error("Open file does not accept paths");
		const frame = event.senderFrame,
			window = BrowserWindow.fromWebContents(event.sender);
		if (!window) throw Error("No application window");
		let expired = false;
		const expire = () => {
			expired = true;
		};
		const check = () => {
			if (expired || event.sender.isDestroyed() || frame?.isDestroyed() || event.sender.mainFrame !== frame)
				throw Error("The file selection expired");
		};
		event.sender.on("did-start-navigation", expire);
		try {
			const selected = await dialog.showOpenDialog(window, {
				title: translate(language?.() ?? "en", "Open file"),
				properties: ["openFile"],
			});
			if (selected.canceled) return null;
			check();
			if (selected.filePaths.length !== 1) throw Error("Choose one file");
			const result = await host.call("files.open", { path: selected.filePaths[0]! });
			check();
			return { ...result, selectionId: createHmac("sha256", readerSelectionKey).update(selected.filePaths[0]!).digest("hex") };
		} finally {
			event.sender.removeListener("did-start-navigation", expire);
		}
	});

	ipcMain.handle(CHANNELS.pickAvatar, async (event) => {
		checkFrame(event);
		const frame = event.senderFrame,
			window = BrowserWindow.fromWebContents(event.sender);
		if (!window) throw Error("No application window");
		let expired = false;
		const expire = () => {
			expired = true;
		};
		const check = () => {
			if (
				expired ||
				event.sender.isDestroyed() ||
				frame?.isDestroyed() ||
				event.sender.mainFrame !== frame ||
				BrowserWindow.fromWebContents(event.sender) !== window
			)
				throw Error("The file selection expired");
		};
		event.sender.on("did-start-navigation", expire);
		try {
			const selected = await dialog.showOpenDialog(window, {
				title: translate(language?.() ?? "en", "Choose an avatar"),
				properties: ["openFile"],
				filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
			});
			if (selected.canceled) return null;
			check();
			if (selected.filePaths.length !== 1) throw Error("Choose one avatar image");
			const source = await host.call("avatars.source", { path: selected.filePaths[0]! });
			check();
			const image = nativeImage.createFromBuffer(Buffer.from(source.base64, "base64"));
			const { width, height } = image.getSize(),
				side = Math.min(width, height);
			if (image.isEmpty() || !side || width > AVATAR_LIMITS.side || height > AVATAR_LIMITS.side || width * height > AVATAR_LIMITS.pixels)
				throw Error("Could not read this avatar. Choose another image.");
			const cropped = image
				.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side })
				.resize({ width: AVATAR_LIMITS.size, height: AVATAR_LIMITS.size, quality: "best" });
			const png = cropped.toPNG();
			if (png.length > AVATAR_LIMITS.pngBytes) throw Error("Could not read this avatar. Choose another image.");
			return { kind: "upload", base64: png.toString("base64") };
		} finally {
			event.sender.removeListener("did-start-navigation", expire);
		}
	});

	ipcMain.handle(CHANNELS.attachFiles, async (event) => {
		checkFrame(event);
		const frame = event.senderFrame;
		const window = BrowserWindow.fromWebContents(event.sender);
		if (!window) throw Error("No application window");
		let expired = false;
		const expire = () => {
			expired = true;
		};
		event.sender.on("did-start-navigation", expire);
		let selected;
		try {
			selected = await dialog.showOpenDialog(window, {
				title: translate(language?.() ?? "en", "Attach files"),
				properties: ["openFile", "multiSelections"],
				filters: [{ name: translate(language?.() ?? "en", "Text and images"), extensions: ["txt", "md", "csv", "png", "jpg", "jpeg"] }],
			});
		} finally {
			event.sender.removeListener("did-start-navigation", expire);
		}
		if (selected.canceled) return { attachments: [], errors: [] };
		if (
			expired ||
			event.sender.isDestroyed() ||
			frame?.isDestroyed() ||
			event.sender.mainFrame !== frame ||
			BrowserWindow.fromWebContents(event.sender) !== window
		)
			throw Error("The file selection expired");
		if (selected.filePaths.length > 4) throw Error("Choose at most four attachments");
		const attachments: ArtifactRef[] = [],
			errors: string[] = [];
		for (const path of selected.filePaths) {
			try {
				attachments.push(await host.call("artifacts.import", { requestId: randomUUID(), path }));
			} catch (error) {
				errors.push(error instanceof Error ? error.message : "Could not import attachment");
			}
		}
		return { attachments, errors };
	});
	ipcMain.handle(CHANNELS.exportArtifact, async (event, params: unknown) => {
		checkFrame(event);
		const frame = event.senderFrame,
			window = BrowserWindow.fromWebContents(event.sender);
		if (!window) throw Error("No application window");
		if (!params || typeof params !== "object" || Object.keys(params).some((key) => !["artifactId", "requestId"].includes(key)))
			throw Error("Invalid export request");
		const { artifactId, requestId } = params as { artifactId: string; requestId: string };
		const error = paramsError("artifacts.remove", { artifactId, requestId });
		if (error) throw Error(error);
		let expired = false;
		const expire = () => {
			expired = true;
		};
		const assertSelection = () => {
			if (
				expired ||
				event.sender.isDestroyed() ||
				frame?.isDestroyed() ||
				event.sender.mainFrame !== frame ||
				BrowserWindow.fromWebContents(event.sender) !== window
			)
				throw Error("The file selection expired");
		};
		event.sender.on("did-start-navigation", expire);
		try {
			const artifact = await host.call("artifacts.get", { artifactId });
			assertSelection();
			const selected = await dialog.showSaveDialog(window, {
				title: translate(language?.() ?? "en", "Export copy"),
				defaultPath: artifact.name,
			});
			if (selected.canceled || !selected.filePath) return false;
			assertSelection();
			await host.call("artifacts.export", { requestId, artifactId, path: selected.filePath });
			return true;
		} catch (error) {
			if (error instanceof ProtocolError) throw new Error(`[${error.code}] ${error.message}`);
			throw error;
		} finally {
			event.sender.removeListener("did-start-navigation", expire);
		}
	});

	ipcMain.handle(CHANNELS.getWindowActive, (event) => {
		checkFrame(event);
		const window = BrowserWindow.fromWebContents(event.sender);
		return !!window && window.isVisible() && window.isFocused() && !window.isMinimized();
	});

	ipcMain.handle(CHANNELS.getHostState, (event) => {
		checkFrame(event);
		return host.state;
	});

	ipcMain.handle(CHANNELS.pickFolder, async (event) => {
		checkFrame(event);
		const window = BrowserWindow.fromWebContents(event.sender);
		if (window === null) throw new Error("[invalid_request] No window to attach the dialog to");
		return folders.pick(window, event.sender.id, language?.());
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
