import { expect, it, vi } from "vitest";
vi.mock("electron", () => ({}));
const { isWebPage } = await import("../src/main/reader-browser");
it("admits normal web pages but not local files, privileged schemes or URL credentials", () => {
	for (const url of ["https://example.org/report", "http://localhost:9000/report"]) expect(isWebPage(url)).toBe(true);
	for (const url of [
		"file:///private/secret",
		"app://openbot/index.html",
		"javascript:alert(1)",
		"data:text/html,hi",
		"https://name:secret@example.org",
		{},
		"https://example.org/" + "x".repeat(8192),
	])
		expect(isWebPage(url)).toBe(false);
});
