/** Read-only documents never imply model input or a filesystem grant. */
export type ReaderFile = {
	readonly name: string;
	readonly mediaType: string;
	readonly bytes: number;
	readonly text?: string;
	readonly base64?: string;
};
export type FileEntry = { readonly name: string; readonly path: string; readonly kind: "directory" | "file" | "unsupported" };
export type FileListing = { readonly path: string; readonly entries: readonly FileEntry[]; readonly limited: boolean };
export const READER_LIMITS = {
	bytes: 8 * 1024 * 1024,
	textBytes: 2 * 1024 * 1024,
	entries: 500,
	imageSide: 8192,
	imagePixels: 32_000_000,
} as const;
