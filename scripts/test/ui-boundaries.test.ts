import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { checkRendererUi } from "../check-boundaries.mjs";

async function fixture(files: Record<string, string>) {
	const root = await mkdtemp(join(tmpdir(), "openbot-ui-boundary-"));
	await mkdir(join(root, "ui", "nested"), { recursive: true });
	for (const [name, text] of Object.entries(files)) {
		await mkdir(join(root, name, ".."), { recursive: true });
		await writeFile(join(root, name), text);
	}
	return root;
}

it("rejects static, re-exported, dynamic and relative-path application imports", async () => {
	const root = await fixture({
		"store.ts": "export const useStore = {};\n",
		"ui/static.tsx": 'import { useStore } from "../store";\nexport const view = useStore;\n',
		"ui/reexport.tsx": 'export { useStore } from "../store";\n',
		"ui/dynamic.tsx": 'export const load = () => import("../store");\n',
		"ui/nested/bypass.tsx": 'import { useStore } from "../../store";\nexport const nested = useStore;\n',
		"InterfaceIcon.tsx": 'import { X } from "lucide-react";\nexport const Icon = X;\n',
	});
	const errors = checkRendererUi(join(root, "ui"), join(root, "InterfaceIcon.tsx"));
	expect(errors.join("\n")).toContain("ui/static.tsx");
	expect(errors.join("\n")).toContain("ui/reexport.tsx");
	expect(errors.join("\n")).toContain("ui/dynamic.tsx");
	expect(errors.join("\n")).toContain("ui/nested/bypass.tsx");
	expect(errors.join("\n")).toContain("pass state and actions as props");
	for (const file of ["static.tsx", "reexport.tsx", "dynamic.tsx", "nested/bypass.tsx"])
		expect(errors.some((error: string) => error.includes(file))).toBe(true);
});

it("allows UI modules, React Aria and the pure icon module", async () => {
	const root = await fixture({
		"ui/cx.ts": "export const cx = (value: string) => value;\n",
		"ui/ok.tsx": 'import { cx } from "./cx";\nimport { Icon } from "../InterfaceIcon";\nexport const view = () => import("./cx").then(() => cx(String(Icon)));\n',
		"InterfaceIcon.tsx": 'import type { ReactNode } from "react";\nimport { X } from "lucide-react";\nexport const Icon = X;\nexport const node: ReactNode = null;\n',
	});
	expect(checkRendererUi(join(root, "ui"), join(root, "InterfaceIcon.tsx"))).toEqual([]);
});

it("rejects an InterfaceIcon that imports application state", async () => {
	const root = await fixture({
		"store.ts": "export const useStore = {};\n",
		"ui/ok.tsx": "export const ok = true;\n",
		"InterfaceIcon.tsx": 'import { useStore } from "./store";\nexport const leaked = useStore;\n',
	});
	const errors = checkRendererUi(join(root, "ui"), join(root, "InterfaceIcon.tsx"));
	expect(errors.join("\n")).toContain("InterfaceIcon");
	expect(errors.join("\n")).toContain("lucide-react");
});

it("accepts the product renderer UI tree", async () => {
	const root = new URL("../..", import.meta.url);
	const { join: pathJoin } = await import("node:path");
	const base = pathJoin(root.pathname, "");
	expect(
		checkRendererUi(pathJoin(base, "apps/desktop/src/renderer/src/ui"), pathJoin(base, "apps/desktop/src/renderer/src/InterfaceIcon.tsx")),
	).toEqual([]);
});
