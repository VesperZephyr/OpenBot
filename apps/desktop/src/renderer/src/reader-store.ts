import { create } from "zustand";
import type { ArtifactRef, ReaderFile } from "@openbot/protocol";
export type ReaderSelection =
	| { kind: "workspace"; path: string; name: string }
	| { kind: "artifact"; artifact: ArtifactRef }
	| { kind: "picked"; file: ReaderFile; selectionId: string }
	| { kind: "web"; url: string };
export type ReaderTab = { id: string; key: string; title: string; selection: ReaderSelection };
export const MAX_READER_TABS = 12;
export const useReader = create<{
	open: boolean;
	browse: boolean;
	resizing: boolean;
	tabs: ReaderTab[];
	activeId?: string | undefined;
	notice: string;
}>(() => ({ open: false, browse: true, resizing: false, tabs: [], notice: "" }));
export const openFiles = () => useReader.setState({ open: true, browse: true });
export function openSelection(selection: ReaderSelection, focusDocument = false) {
	const key =
		selection.kind === "artifact"
			? `artifact:${selection.artifact.artifactId}`
			: selection.kind === "workspace"
				? `workspace:${selection.path}`
				: selection.kind === "picked"
					? `picked:${selection.selectionId}`
					: `web:${selection.url}`;
	useReader.setState((state) => {
		const existing = state.tabs.find((tab) => tab.key === key);
		if (existing) return { open: true, activeId: existing.id, notice: "", ...(focusDocument ? { browse: false } : {}) };
		if (state.tabs.length >= MAX_READER_TABS) return { open: true, notice: "Close a tab before opening another (12 tabs maximum)." };
		const title =
			selection.kind === "artifact"
				? selection.artifact.name
				: selection.kind === "workspace"
					? selection.name
					: selection.kind === "picked"
						? selection.file.name
						: new URL(selection.url).hostname;
		const tab = { id: crypto.randomUUID(), key, title, selection };
		return { open: true, tabs: [...state.tabs, tab], activeId: tab.id, notice: "", ...(focusDocument ? { browse: false } : {}) };
	});
}
export const openArtifact = (artifact: ArtifactRef) => openSelection({ kind: "artifact", artifact }, true);
export function openWebPage(address: string): boolean {
	try {
		const url = new URL(address);
		if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.href.length > 8192) return false;
		openSelection({ kind: "web", url: url.href }, true);
		return true;
	} catch {
		return false;
	}
}
export function closeReaderTab(id: string) {
	useReader.setState((state) => {
		const index = state.tabs.findIndex((tab) => tab.id === id);
		if (index < 0) return state;
		const tabs = state.tabs.filter((tab) => tab.id !== id);
		return {
			tabs,
			activeId: state.activeId === id ? tabs[Math.min(index, tabs.length - 1)]?.id : state.activeId,
			notice: "",
			...(!tabs.length ? { browse: true } : {}),
		};
	});
}
export function setReaderTitle(id: string, title: string) {
	if (!title.trim()) return;
	useReader.setState((state) => ({
		tabs: state.tabs.map((tab) => (tab.id === id && tab.title !== title.slice(0, 160) ? { ...tab, title: title.slice(0, 160) } : tab)),
	}));
}
