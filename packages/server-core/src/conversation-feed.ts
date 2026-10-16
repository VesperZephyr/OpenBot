/**
 * Which conversation snapshots reach Desktop (architecture 6.1, B7 streaming cost). Only the one subscribed Bot gets
 * `conversation.updated` events; every other Bot's changes reach the sidebar through `bots.changed`. Updates of the
 * subscribed Bot are coalesced so streaming text crosses IPC at most once per window, always ending on the latest
 * snapshot.
 */
import type { BotId, ConversationSnapshot } from "@openbot/protocol";
import { Coalescer, type Timers } from "./coalescer.ts";

export type ConversationFeedOptions = {
	readonly deliver: (snapshot: ConversationSnapshot) => void;
	readonly windowMs?: number;
	readonly timers?: Timers;
};

export class ConversationFeed {
	readonly #updates: Coalescer<BotId, ConversationSnapshot>;
	#subscribed: BotId | null = null;

	constructor(options: ConversationFeedOptions) {
		this.#updates = new Coalescer(
			// A window can close after the subscription moved on; its held snapshot is for a Bot nobody watches now.
			(botId, snapshot) => {
				if (botId === this.#subscribed) options.deliver(snapshot);
			},
			{
				...(options.windowMs === undefined ? {} : { windowMs: options.windowMs }),
				...(options.timers === undefined ? {} : { timers: options.timers }),
			},
		);
	}

	get subscribed(): BotId | null {
		return this.#subscribed;
	}

	/** Replace the subscribed Bot. The caller fetches a fresh snapshot afterwards; nothing held for the old one is sent. */
	subscribe(botId: BotId | null): void {
		if (this.#subscribed === botId) return;
		if (this.#subscribed !== null) this.#updates.cancel(this.#subscribed);
		this.#subscribed = botId;
	}

	publish(snapshot: ConversationSnapshot): void {
		if (snapshot.botId === this.#subscribed) this.#updates.push(snapshot.botId, snapshot);
	}

	stop(): void {
		this.#subscribed = null;
		this.#updates.cancelAll();
	}
}
