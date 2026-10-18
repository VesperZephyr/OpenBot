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
export type ArtifactOperation =
	| { readonly action: "import"; readonly path: string }
	| { readonly action: "get" | "preview" | "content" | "remove"; readonly artifactId: string }
	| { readonly action: "export"; readonly artifactId: string; readonly path: string };
export type ArtifactOperationResult = ArtifactRef | ArtifactContent | null;
