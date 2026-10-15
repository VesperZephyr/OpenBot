/**
 * Folder grants from the native picker. The renderer never supplies a path to grant: `dialog.pickFolder` shows the
 * macOS folder dialog and returns an opaque, single-use token for the folder the user chose; `grants.add` hands the
 * token back and main forwards the path it holds. Tokens are random, expire after five minutes, are bound to the
 * renderer (web contents) that asked, and are deleted when used.
 */
import { randomUUID } from "node:crypto";
import { type BrowserWindow, dialog } from "electron";
import type { FolderSelection } from "../shared/api";

const TOKEN_TTL_MS = 5 * 60 * 1000;

export class FolderSelections {
	readonly #pending = new Map<string, { readonly path: string; readonly ownerId: number; readonly expires: number }>();

	/** Show the dialog attached to `window` for the renderer `ownerId`; null when the user cancels. */
	async pick(window: BrowserWindow, ownerId: number): Promise<FolderSelection | null> {
		const result = await dialog.showOpenDialog(window, {
			title: "Choose a folder Bots may use",
			buttonLabel: "Grant access",
			properties: ["openDirectory", "createDirectory"],
		});
		const path = result.filePaths[0];
		if (result.canceled || path === undefined) return null;
		const now = Date.now();
		for (const [token, entry] of this.#pending) if (entry.expires < now) this.#pending.delete(token);
		const selection = randomUUID();
		this.#pending.set(selection, { path, ownerId, expires: now + TOKEN_TTL_MS });
		return { selection, path };
	}

	/** The picked path for `selection`, used once; throws when it is unknown, expired, or from another renderer. */
	take(selection: unknown, ownerId: number): string {
		const entry = typeof selection === "string" ? this.#pending.get(selection) : undefined;
		if (typeof selection === "string") this.#pending.delete(selection);
		if (entry === undefined || entry.expires < Date.now() || entry.ownerId !== ownerId) {
			throw new Error("[invalid_request] Choose the folder again");
		}
		return entry.path;
	}
}
