import type { ConversationSnapshot } from "./conversations.ts";
import type { LifecycleState } from "./lifecycle.ts";

// ---------------------------------------------------------------------------
// Host-to-Desktop events

export type HostEvents = {
 "lifecycle.changed": LifecycleState;
	"groups.changed": Record<string, never>;
	/** The roster or a Bot's sidebar state changed; fetch `bots.list` again. */
	"bots.changed": Record<string, never>;
	/** A conversation's view changed; the payload is the new snapshot. */
	"conversation.updated": ConversationSnapshot;
};

export type HostEventType = keyof HostEvents;

/** One event as a discriminated union, so consumers narrow on `type`. */
export type HostEvent = { [T in HostEventType]: { readonly type: T; readonly payload: HostEvents[T] } }[HostEventType];
