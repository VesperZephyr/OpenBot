import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ protocol: {} }));
const { APP_ENTRY_URL, resolveAppRequest } = await import("../src/main/app-protocol");

const root = "/Applications/OpenBot.app/Contents/Resources/app.asar/out/renderer";

describe("app:// request resolution", () => {
	it("maps the entry page and assets into the renderer directory", () => {
		expect(resolveAppRequest(root, APP_ENTRY_URL)).toBe(join(root, "index.html"));
		expect(resolveAppRequest(root, "app://openbot/assets/index-1.js?v=2#x")).toBe(join(root, "assets", "index-1.js"));
	});

	it("never resolves outside the renderer directory", () => {
		// Literal dot segments are normalized by the URL parser and stay inside the root.
		expect(resolveAppRequest(root, "app://openbot/../main/index.js")).toBe(join(root, "main", "index.js"));
		expect(resolveAppRequest(root, "app://openbot/%2e%2e/main/index.js")).toBe(join(root, "main", "index.js"));
		// Encoded separators survive parsing and would climb out after decoding.
		for (const url of [
			"app://openbot/%2e%2e%2fmain%2findex.js",
			"app://openbot/assets/..%2f..%2f..%2fmain/index.js",
			"app://openbot/..%2f..%2f..%2f..%2f..%2fetc/passwd",
			"app://openbot/",
			"app://openbot/%E0%A4%A",
			"app://other/index.html",
		]) {
			expect(resolveAppRequest(root, url), url).toBeUndefined();
		}
		// An encoded absolute path stays relative to the renderer directory.
		expect(resolveAppRequest(root, "app://openbot/%2fetc%2fpasswd")).toBe(join(root, "etc", "passwd"));
	});
});
