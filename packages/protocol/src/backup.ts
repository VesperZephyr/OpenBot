/** Offline maintenance is desktop-only; it is never a model-selected tool. */
export type BackupResult = {
	readonly action: "export" | "restore" | "recover";
	readonly path?: string;
	readonly rollbackPath?: string;
	readonly files: number;
	readonly bytes: number;
};
export type BackupRequest =
	| { readonly action: "export"; readonly directory: string }
	| { readonly action: "restore"; readonly directory: string }
	| { readonly action: "recover" };
