import type { ConversationKey, ConversationSummary } from "@openbot/protocol";
import { useComposer } from "./useComposer";
import { markRead, report, useStore } from "./store";
import { t } from "./i18n";

export function recentTime(key: string, summaries: Readonly<Record<string, ConversationSummary>>, createdAt: number): number {
	return summaries[key]?.latest?.at || createdAt;
}
export function RosterPreview({
	conversationKey,
	name,
	fallback,
	activity,
	core = false,
}: {
	conversationKey: ConversationKey;
	name: string;
	fallback: string;
	activity?: string | undefined;
	core?: boolean;
}) {
	const row = useStore((s) => s.summaries[conversationKey]);
	const language = useStore((s) => s.settings?.language ?? "en");
	const sender = useStore((s) => s.bots.find((b) => b.botId === row?.latest?.senderId)?.name);
	const { draft } = useComposer(conversationKey);
	const latest = row?.latest;
	const from = latest?.senderId === "user" ? t("You") : (sender ?? t("Deleted Bot"));
	const preview = activity
		? t(activity)
		: draft.text.trim()
			? t("Draft: {text}", { text: draft.text })
			: latest
				? `${from}: ${latest.text}`
				: fallback;
	const unread = row?.unreadCount ?? 0;
	const date = latest?.at ? new Date(latest.at) : undefined;
	const today = date?.toDateString() === new Date().toDateString();
	const locale = language === "zh-CN" ? "zh-CN" : "en-US";
	return (
		<span className={`bot-row-text ${unread ? "has-unread" : ""}`}>
			<span className="bot-row-name">
				<span className="roster-name">{name}</span>
				{core && <span className="core-badge">{t("Core")}</span>}
				{date && (
					<time dateTime={date.toISOString()} title={date.toLocaleString(locale)}>
						{new Intl.DateTimeFormat(locale, today ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric" }).format(
							date,
						)}
					</time>
				)}
			</span>
			<span className="roster-preview-line">
				{activity && <span className={`activity activity-${activity.toLowerCase().replaceAll(" ", "_")}`} aria-hidden />}
				<span className="bot-row-role" title={preview}>
					{preview}
				</span>
				{unread > 0 && (
					<span
						className="unread-count"
						role="img"
						aria-label={t("{count} unread messages", { count: unread })}
						title={t("{count} unread messages", { count: unread })}
					>
						{unread > 99 ? "99+" : unread}
					</span>
				)}
			</span>
		</span>
	);
}
export function MarkReadButton({ conversationKey, cursor }: { conversationKey: ConversationKey; cursor?: number | undefined }) {
	const unread = useStore((s) => s.summaries[conversationKey]?.unreadCount ?? 0);
	return unread > 0 && cursor !== undefined ? (
		<button className="mark-read" disabled={cursor === 0} onClick={() => void markRead(conversationKey, cursor).catch(report)}>
			{t("Mark as read")}
		</button>
	) : null;
}
