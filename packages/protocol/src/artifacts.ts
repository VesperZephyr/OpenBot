import type { ReaderFile, FileListing } from "./reader.ts";
import type { AvatarSource, AvatarImage } from "./avatars.ts";
/** Immutable local file references. No source path or model-specific types cross the UI contract. */
export type ArtifactRef = {
	readonly artifactId: string;
	readonly name: string;
	readonly mediaType: string;
	readonly bytes: number;
	readonly sha256: string;
	readonly createdAt: number;
	readonly source: "input" | "result";
	readonly availability: "available" | "removed" | "missing" | "corrupt";
};
export type ArtifactContent = {
	readonly artifact: ArtifactRef;
	readonly text?: string;
	readonly base64?: string;
	readonly truncated: boolean;
};
export const ARTIFACT_LIMITS = {
	count: 4,
	textBytes: 256 * 1024,
	imageBytes: 4 * 1024 * 1024,
	messageBytes: 8 * 1024 * 1024,
	resultBytes: 8 * 1024 * 1024,
	previewBytes: 64 * 1024,
	storageBytes: 256 * 1024 * 1024,
	records: 4096,
	imageSide: 4096,
	imagePixels: 16_000_000,
} as const;
export type ArtifactListing = { readonly items: readonly ArtifactRef[]; readonly nextOffset?: number };
export type ArtifactOperation =
 | { readonly action: "files-list" | "files-read" | "file-open"; readonly path: string }
 | { readonly action: "list"; readonly offset: number; readonly query: string }
	| { readonly action: "avatar-source"; readonly path: string }
	| { readonly action: "avatar-validate"; readonly base64: string }
	| { readonly action: "import"; readonly path: string }
	| { readonly action: "get" | "preview" | "read" | "content" | "remove"; readonly artifactId: string }
	| { readonly action: "export"; readonly artifactId: string; readonly path: string };
export type ArtifactOperationResult = ArtifactRef | ArtifactContent | AvatarSource | AvatarImage | ReaderFile | FileListing | ArtifactListing | null;
