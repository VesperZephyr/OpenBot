import { useSyncExternalStore } from "react";
import { ComposerStore, type ConversationKey } from "./composers";
let storage: Storage | undefined;
try {
	storage = globalThis.localStorage;
} catch {
	/* Keep unsaved text in memory when storage is unavailable. */
}
export const composers = new ComposerStore(storage);
export function useComposer(key: ConversationKey) {
	return useSyncExternalStore(composers.subscribe, () => composers.get(key));
}
