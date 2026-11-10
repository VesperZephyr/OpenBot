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
	readonly placement?: "always" | "on-demand";
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
	| { readonly action: "placement"; readonly noteId: string; readonly placement: "always" | "on-demand" }
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

export type MemorySnapshot = {
	readonly content: string;
	readonly revision: number;
	readonly source: "legacy" | "user" | "model" | "restore";
	readonly updatedAt: number | null;
	readonly restoredFrom?: number;
	readonly notes?: readonly MemoryNote[];
};
export type MemoryState = MemorySnapshot & { readonly notes: readonly MemoryNote[]; readonly history: readonly MemorySnapshot[] };
export const MEMORY_HISTORY_LIMIT = 20;

/** Largest Bot memory, in UTF-8 bytes of Markdown. */
export const MEMORY_LIMIT_BYTES = 8192;
