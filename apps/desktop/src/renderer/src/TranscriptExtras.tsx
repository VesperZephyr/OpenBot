import { t } from "./i18n";
import type { TranscriptItem } from "@openbot/protocol";
import { report, sendMessage } from "./store";

const DIVIDER_LABEL: Record<Extract<TranscriptItem, { kind: "divider" }>["reason"], string> = {
	compaction: "Earlier messages summarized",
	reset: "New topic",
};

/** Where the model's context starts over: older messages above stay visible but are no longer sent in full. */
export function Divider({ item }: { readonly item: Extract<TranscriptItem, { kind: "divider" }> }) {
	return (
		<li className="divider" role="separator" aria-label={t(DIVIDER_LABEL[item.reason])}>
			<span>{t(DIVIDER_LABEL[item.reason])}</span>
		</li>
	);
}

/** The model's visible reasoning, collapsed by default. */
export function Thinking({ text }: { readonly text: string }) {
	return (
		<details className="thinking-block">
			<summary>{t("Thought")}</summary>
			<div className="thinking-text">{text}</div>
		</details>
	);
}

/** Resubmits `text` as a new message, under a new request ID, after a model error. */
export function RetryButton({
	botId,
	text,
	artifactIds,
 skills,
}: {
	readonly botId: string;
	readonly text: string;
	readonly artifactIds?: readonly string[];
 readonly skills?:readonly import("@openbot/protocol").SkillRef[];
}) {
	return (
		<button type="button" className="retry" onClick={() => void sendMessage(botId, text, undefined, artifactIds, skills).catch(report)}>
			{t("Retry")}
		</button>
	);
}

/**
 * The text Retry resubmits: offered only on the newest assistant error while no Run is live, and it is the last user
 * message before that error.
 */
export function retryTarget(
	items: readonly TranscriptItem[],
	live: boolean,
): { readonly id: string; readonly text: string; readonly artifactIds?: readonly string[];readonly skills?:readonly import("@openbot/protocol").SkillRef[] } | undefined {
	if (live) return undefined;
	const errorIndex = items.findLastIndex((item) => item.kind === "assistant");
	const failed = items[errorIndex];
	if (failed?.kind !== "assistant" || failed.error === undefined) return undefined;
	const user = items.slice(0, errorIndex).findLast((item) => item.kind === "user");
	if (user?.kind !== "user" || user.source === "background") return undefined;
	const text = user.parts.map((part) => part.text).join("\n\n");
	return text.trim() === "" && !user.attachments?.length && !user.skills?.length
		? undefined
		: { id: failed.id, text,...(user.skills?{skills:user.skills}:{}), ...(user.attachments?.length ? { artifactIds: user.attachments.map((a) => a.artifactId) } : {}) };
}
