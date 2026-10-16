import type { TranscriptItem } from "@openbot/protocol";
import { report, sendMessage } from "./store";

const DIVIDER_LABEL: Record<Extract<TranscriptItem, { kind: "divider" }>["reason"], string> = {
	compaction: "Earlier messages summarized",
	reset: "New topic",
};

/** Where the model's context starts over: older messages above stay visible but are no longer sent in full. */
export function Divider({ item }: { readonly item: Extract<TranscriptItem, { kind: "divider" }> }) {
	return (
		<li className="divider" role="separator" aria-label={DIVIDER_LABEL[item.reason]}>
			<span>{DIVIDER_LABEL[item.reason]}</span>
		</li>
	);
}

/** The model's visible reasoning, collapsed by default. */
export function Thinking({ text }: { readonly text: string }) {
	return (
		<details className="thinking-block">
			<summary>Thought</summary>
			<div className="thinking-text">{text}</div>
		</details>
	);
}

/** Resubmits `text` as a new message, under a new request ID, after a model error. */
export function RetryButton({ botId, text }: { readonly botId: string; readonly text: string }) {
	return (
		<button type="button" className="retry" onClick={() => void sendMessage(botId, text).catch(report)}>
			Retry
		</button>
	);
}

/**
 * The text Retry resubmits: offered only on the newest assistant error while no Run is live, and it is the last user
 * message before that error.
 */
export function retryTarget(items: readonly TranscriptItem[], live: boolean): { readonly id: string; readonly text: string } | undefined {
	if (live) return undefined;
	const errorIndex = items.findLastIndex((item) => item.kind === "assistant");
	const failed = items[errorIndex];
	if (failed?.kind !== "assistant" || failed.error === undefined) return undefined;
	const user = items.slice(0, errorIndex).findLast((item) => item.kind === "user");
	if (user?.kind !== "user") return undefined;
	const text = user.parts.map((part) => part.text).join("\n\n");
	return text.trim() === "" ? undefined : { id: failed.id, text };
}
