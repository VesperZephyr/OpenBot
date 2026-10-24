import { beforeEach, expect, it } from "vitest";
import { closeReaderTab, MAX_READER_TABS, openSelection, openWebPage, useReader } from "../src/renderer/src/reader-store";
beforeEach(() => useReader.setState({ tabs: [], activeId: undefined, open: false, browse: true, notice: "" }));
const workspace = (path: string) => openSelection({ kind: "workspace", path, name: path.split("/").at(-1)! });
it("deduplicates by identity, keeps same-named files distinct, and selects the nearest neighbor on close", () => {
	workspace("a/report.md");
	const first = useReader.getState().activeId!;
	workspace("b/report.md");
	const second = useReader.getState().activeId!;
	workspace("a/report.md");
	expect(useReader.getState().tabs).toHaveLength(2);
	expect(useReader.getState().activeId).toBe(first);
	closeReaderTab(first);
	expect(useReader.getState().activeId).toBe(second);
	const file = { name: "report.md", mediaType: "text/markdown", bytes: 1, text: "x" };
	openSelection({ kind: "picked", selectionId: "one", file });
	openSelection({ kind: "picked", selectionId: "two", file });
	openSelection({ kind: "picked", selectionId: "one", file });
	expect(useReader.getState().tabs).toHaveLength(3);
	closeReaderTab(second);
	expect(useReader.getState().tabs).toHaveLength(2);
	for (const tab of useReader.getState().tabs) closeReaderTab(tab.id);
	expect(useReader.getState()).toMatchObject({ tabs: [], activeId: undefined, browse: true });
});
it("does not evict tabs at the limit and allows selecting existing tabs or replacing a closed one", () => {
	for (let i = 0; i < MAX_READER_TABS; i++) workspace(`${i}.md`);
	const original = useReader.getState().tabs;
	workspace("overflow.md");
	expect(useReader.getState().tabs).toBe(original);
	expect(useReader.getState().notice).toContain("12");
	workspace("0.md");
	expect(useReader.getState().activeId).toBe(original[0]!.id);
	closeReaderTab(original[0]!.id);
	workspace("replacement.md");
	expect(useReader.getState().tabs).toHaveLength(MAX_READER_TABS);
});
it("canonicalizes web identity and rejects credentials or privileged schemes before opening", () => {
	expect(openWebPage("https://EXAMPLE.org")).toBe(true);
	expect(openWebPage("https://example.org/")).toBe(true);
	expect(useReader.getState().tabs).toHaveLength(1);
	for (const url of ["file:///etc/passwd", "app://openbot", "javascript:alert(1)", "https://u:p@example.org", "not a URL"])
		expect(openWebPage(url)).toBe(false);
	expect(useReader.getState().tabs).toHaveLength(1);
});
