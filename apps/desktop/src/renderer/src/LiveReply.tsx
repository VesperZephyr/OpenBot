import type { ConversationSnapshot } from "@openbot/protocol";
import { Avatar } from "./Avatar";
import { Markdown } from "./markdown";
import { t } from "./i18n";
import { useStore } from "./store";

export function ActivityIndicator({ label, animated = true }: { label: string; animated?: boolean }) {
    return <div className={`reply-activity ${animated ? "is-active" : ""}`} role="status" aria-live="polite" aria-atomic="true">
        <span className="activity-dots" aria-hidden="true"><i /><i /><i /></span>
        <span>{t(label)}</span>
    </div>;
}

/** Snapshot state remains the authority; the dots never imply fabricated progress. */
export function LiveReply({ snapshot, botId = snapshot?.botId, queued = false }: {
    snapshot?: ConversationSnapshot | undefined;
    botId?: string | undefined;
    queued?: boolean;
}) {
    const author = useStore(state => state.bots.find(bot => bot.botId === botId));
    const paused = useStore(state => state.lifecycle?.blocked ?? false);
    const live = snapshot?.live;
    const state = live?.state ?? snapshot?.run?.state;
    const text = live?.partial?.map(part => part.text).join("\n\n") ?? "";
    const tool = snapshot?.items.findLast(item => item.kind === "tool" && (item.status === "running" || item.status === "pending"));
    const label = state === "cancelling" ? "Stopping work"
        : snapshot?.approvals.length || state === "waiting_approval" ? "Needs approval"
        : state === "waiting_user" ? "Waiting for your reply"
        : paused ? "Queued until work resumes"
        : queued || state === "queued" ? "Waiting for a free slot"
        : live?.retry ? "Retrying response"
        : tool||snapshot?.live?.toolRunning ? "Running a tool"
        : text.trim() ? "Replying" : "Thinking…";
    const animated = !["Needs approval", "Waiting for your reply", "Queued until work resumes"].includes(label);
    return <div className="live-reply">
        {author && <div className="message-author"><Avatar bot={author} size={28} /><strong>{author.name}</strong></div>}
        {text && <Markdown text={text} streaming />}
        <ActivityIndicator label={label} animated={animated} />
        {live?.retry && <div className="message-error">{t("Retrying after an error: ")}{live.retry.error}</div>}
    </div>;
}
