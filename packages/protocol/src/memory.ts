export type MemoryScope = "bot" | "shared";

/** Attribution of the learning operation, not proof that a source entails the note. */
export type MemoryProvenance = {
	readonly kind: "legacy" | "user" | "model" | "restore";
	readonly at: number | null;
	readonly botId?: string;
	readonly runId?: string;
	readonly conversationId?: string;
	readonly invocationId?: string;
	readonly requestIds?: readonly string[];
};

export type MemoryNote = {
	readonly id: string;
	readonly key: string;
	/** Empty for an imported Markdown preamble. */
	readonly heading: string;
	readonly content: string;
	readonly status: "active" | "forgotten" | "shared";
	readonly protected: boolean;
	readonly original: MemoryProvenance;
	readonly changed: MemoryProvenance;
};

export type MemoryNoteChange = {
	readonly botId: string;
	readonly requestId: string;
	readonly scope: MemoryScope;
	readonly expectedRevision: number;
} & (
	| { readonly action: "add"; readonly heading: string; readonly content: string }
	| { readonly action: "edit"; readonly noteId: string; readonly content: string }
	| { readonly action: "forget"; readonly noteId: string }
	| { readonly action: "share" | "unshare"; readonly noteId: string; readonly otherRevision: number }
);

export type MemorySourceEvidence = {
	readonly source: MemoryProvenance;
	readonly available: boolean;
	readonly requests: readonly { readonly requestId: string; readonly text: string }[];
	readonly truncated: boolean;
};

export const SHARED_MEMORY_LIMIT_BYTES = 4096;
export const MEMORY_NOTE_LIMIT = 128;
