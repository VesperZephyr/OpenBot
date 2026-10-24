import { create } from "zustand";
import type { ArtifactRef, ReaderFile } from "@openbot/protocol";
export type ReaderSelection =
	| { kind: "workspace"; path: string; name: string }
	| { kind: "artifact"; artifact: ArtifactRef }
	| { kind: "picked"; file: ReaderFile };
export const useReader = create<{ open: boolean; browse: boolean; resizing: boolean; selection?: ReaderSelection }>(() => ({ open: false, browse: true, resizing: false }));
export const openFiles = () => useReader.setState({ open: true, browse: true });
export const openArtifact = (artifact: ArtifactRef) =>
	useReader.setState({ open: true, browse: false, selection: { kind: "artifact", artifact } });
