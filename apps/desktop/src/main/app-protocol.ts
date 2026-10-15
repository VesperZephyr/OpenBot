/**
 * The `app://` scheme that serves the built renderer (architecture §6.4: never `file://`). Pages get a real origin, so
 * the Content-Security-Policy's `'self'` means the bundle and nothing else, and the file-protocol privileges stay off.
 */
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { protocol } from "electron";

const SCHEME = "app";
const HOST = "openbot";
export const APP_ENTRY_URL = `${SCHEME}://${HOST}/index.html`;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".woff2": "font/woff2",
};

/** Must run before the app is ready: privileges cannot be granted to a scheme afterwards. */
export function registerAppScheme(): void {
	protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
}

/** Serves files under `root` only; anything else, including `..` and encoded traversal, is a 404. */
export function serveAppScheme(root: string): void {
	protocol.handle(SCHEME, async (request) => {
		const path = resolveAppRequest(root, request.url);
		if (path === undefined) return new Response("Not found", { status: 404 });
		try {
			const body = await readFile(path);
			return new Response(body, {
				headers: { "Content-Type": CONTENT_TYPES[extname(path)] ?? "application/octet-stream" },
			});
		} catch {
			return new Response("Not found", { status: 404 });
		}
	});
}

/** The file under `root` that an `app://` URL names, or undefined when the URL leaves `root` or is malformed. */
export function resolveAppRequest(root: string, url: string): string | undefined {
	const parsed = URL.parse(url);
	if (parsed === null || parsed.host !== HOST) return undefined;
	let pathname: string;
	try {
		pathname = decodeURIComponent(parsed.pathname);
	} catch {
		return undefined;
	}
	const path = resolve(root, `.${pathname}`);
	const inside = relative(root, path);
	if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) return undefined;
	return path;
}
