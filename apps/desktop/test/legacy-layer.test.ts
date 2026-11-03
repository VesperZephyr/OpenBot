import { sep } from "node:path";
import { expect, it } from "vitest";
import { isLegacyStylesheet, legacyLayer } from "../scripts/legacy-layer.ts";

const renderer = (...parts: string[]) => ["apps", "desktop", "src", "renderer", "src", ...parts].join(sep);
const plugin = legacyLayer();
const transform = (code: string, id: string) => {
	const hook = plugin.transform;
	if (typeof hook !== "function") throw Error("legacy layer has no transform");
	return hook.call({ error(message: string): never { throw Error(message); } } as never, code, id);
};

it("wraps legacy product and vendor reader stylesheets from a directory allowlist", () => {
	expect(isLegacyStylesheet(renderer("conversation.css"))).toBe(true);
	expect(isLegacyStylesheet(renderer("ui", "openbot.css"))).toBe(false);
	expect(isLegacyStylesheet(renderer("ui", "layers.css"))).toBe(false);
	expect(isLegacyStylesheet(["node_modules", "tailwindcss", "theme.css"].join(sep))).toBe(false);
	expect(isLegacyStylesheet(["node_modules", "katex", "dist", "katex.min.css"].join(sep))).toBe(true);
	expect(isLegacyStylesheet(["node_modules", "highlight.js", "styles", "github.css"].join(sep))).toBe(true);
	expect(isLegacyStylesheet(["node_modules", "react-pdf", "dist", "Page", "TextLayer.css"].join(sep))).toBe(true);
	const wrapped = transform("button { color: red; }", `${renderer("conversation.css")}?direct`);
	expect(wrapped).toEqual({ code: "@layer legacy {\nbutton { color: red; }\n}\n", map: null });
	expect(transform("@layer something { button { color: red; } }", renderer("conversation.css"))).toMatchObject({
		code: expect.stringContaining("@layer legacy"),
	});
	expect(transform("@import \"tailwindcss/theme.css\";", renderer("ui", "openbot.css"))).toBeNull();
});

it("refuses to wrap a legacy stylesheet that contains @import or @charset", () => {
	expect(() => transform("@import \"other.css\";\nbutton { color: red; }", renderer("conversation.css"))).toThrow(/@import or @charset/);
	expect(() => transform("@charset \"UTF-8\";\nbutton { color: red; }", renderer("reader.css"))).toThrow(/@import or @charset/);
	expect(transform("@import \"tailwindcss/theme.css\";", ["node_modules", "@tailwindcss", "theme.css"].join(sep))).toBeNull();
});
