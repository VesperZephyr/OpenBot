/**
 * Transcript details from B7: the collapsed "Ran N steps" row, message times shown on hover, and Reveal in Finder for
 * files a Bot wrote.
 */
import type { TranscriptItem } from "@openbot/protocol";
import type { ReactNode } from "react";
import { report } from "./store";

/** Consecutive successful tool calls, collapsed; expanding shows each call's own row. */
export function StepsRow({ count, children }: { readonly count: number; readonly children: ReactNode }) {
	return (
		<li className="steps-row">
			<details>
				<summary>
					<span className="tool-status" aria-hidden />
					<span className="tool-verb">Ran {count} steps</span>
				</summary>
				<ol className="steps-list">{children}</ol>
			</details>
		</li>
	);
}

const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const DATE_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** When a message was sent or answered; visible while the pointer is over the message. */
export function MessageTime({ at }: { readonly at: number | undefined }) {
	if (at === undefined) return null;
	const date = new Date(at);
	const today = date.toDateString() === new Date().toDateString();
	return (
		<time className="message-time" dateTime={date.toISOString()} title={DATE_TIME.format(date)}>
			{today ? TIME.format(date) : DATE_TIME.format(date)}
		</time>
	);
}

/** Files the Bot created or edited: show them in Finder. Main asks the Host whether the path may be revealed. */
export function RevealButton({ item }: { readonly item: Extract<TranscriptItem, { kind: "tool" }> }) {
	if (item.status !== "succeeded" || (item.tool !== "local_write" && item.tool !== "local_edit")) return null;
	const args = item.args;
	const path = typeof args === "object" && args !== null && "path" in args && typeof args.path === "string" ? args.path : undefined;
	if (path === undefined) return null;
	return (
		<button type="button" className="reveal" onClick={() => void window.openbot.revealPath(path).catch(report)}>
			Reveal in Finder
		</button>
	);
}
