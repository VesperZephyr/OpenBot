import type { Plugin } from "vite";
import { sep } from "node:path";

// Scoped !important in the legacy sheets (.reader-open-file, reduced motion inside
// .conversation-shell/.sidebar, and two avatar size overrides) stays inside this one
// layer, so it still beats other legacy rules and does not target pilot controls.
// Vendor reader CSS is included so its overrides keep winning by source order.
// Remove when Stage 3 deletes the legacy element selectors.
const VENDOR_READER_PACKAGES = ["katex", "highlight.js", "react-pdf"];

/** Product stylesheets outside the pilot, plus the vendored reader sheets those screens import. */
export function isLegacyStylesheet(file: string): boolean {
	if (!file.endsWith(".css")) return false;
	if (file.includes(`${sep}ui${sep}`)) return false;
	if (file.includes(`${sep}src${sep}renderer${sep}src${sep}`)) return true;
	return VENDOR_READER_PACKAGES.some((name) => file.includes(`${sep}${name}${sep}`));
}

export function legacyLayer(): Plugin {
	return {
		name: "openbot-legacy-layer",
		enforce: "pre",
		transform(code, id) {
			const file = id.split("?")[0] ?? id;
			if (!isLegacyStylesheet(file)) return null;
			// @import and @charset are only valid at the top of a stylesheet. Wrapping them
			// in @layer legacy makes the built CSS invalid, so fail the build instead.
			if (/@(import|charset)\b/.test(code)) {
				this.error(
					`Cannot wrap ${file} in @layer legacy because it contains @import or @charset. Move that rule out of the legacy stylesheet.`,
				);
			}
			return { code: `@layer legacy {\n${code}\n}\n`, map: null };
		},
	};
}
