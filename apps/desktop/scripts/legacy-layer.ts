import type { Plugin } from "vite";
import { sep } from "node:path";

// Scoped !important in the legacy sheets (.reader-open-file, reduced motion inside
// .conversation-shell/.sidebar, and two avatar size overrides) stays inside this one
// layer, so it still beats other legacy rules and does not target pilot controls.
// Vendor reader CSS is included so its overrides keep winning by source order.
// Remove when Stage 3 deletes the legacy element selectors.
export function legacyLayer(): Plugin {
	return {
		name: "openbot-legacy-layer",
		enforce: "pre",
		transform(code, id) {
			const file = id.split("?")[0] ?? id;
			if (!file.endsWith(".css")) return null;
			if (file.includes(`${sep}tailwindcss${sep}`) || file.includes(`${sep}@tailwindcss${sep}`)) return null;
			if (file.endsWith(`${sep}ui${sep}layers.css`) || file.endsWith(`${sep}ui${sep}openbot.css`)) return null;
			if (code.startsWith("@layer ")) return null;
			return { code: `@layer legacy {\n${code}\n}\n`, map: null };
		},
	};
}
