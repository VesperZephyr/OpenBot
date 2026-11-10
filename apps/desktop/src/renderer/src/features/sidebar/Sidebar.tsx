import { useState } from "react";
import type { BotSummary } from "@openbot/protocol";
import { Avatar } from "../../Avatar";
import { ConfirmDeleteConversation } from "../../BotLifecycle";
import { ConversationSearch } from "../../ConversationSearch";
import { GroupRow } from "../../Groups";
import { InterfaceIcon } from "../../InterfaceIcon";
import { LifecycleControls } from "../../Lifecycle";
import { RosterPreview, recentTime } from "../../RosterPreview";
import { awaitingNewChat, conversationRemoved, directChatVisible } from "../../conversation-delete";
import { t } from "../../i18n";
import { openFiles } from "../../reader-store";
import { openBot, report, startConversation, useStore } from "../../store";

/** Core and pinned chats keep priority; all other conversations share recency ordering. */
export function chatEntries(state: Pick<ReturnType<typeof useStore.getState>, "bots" | "groups" | "summaries">) {
    const entries = [
        ...state.bots.filter(bot => directChatVisible(bot, state.summaries, bot.botId)).map(bot => ({ kind: "bot" as const, bot, key: `bot:${bot.botId}` as const, priority: bot.kind === "core" ? 2 : bot.pinned ? 1 : 0, at: bot.createdAt })),
        ...state.groups.map(group => ({ kind: "group" as const, group, key: `group:${group.groupId}` as const, priority: 0, at: group.createdAt })),
    ];
    return entries.toSorted((a, b) => b.priority - a.priority || recentTime(b.key, state.summaries, b.at) - recentTime(a.key, state.summaries, a.at) || a.key.localeCompare(b.key));
}

export function Sidebar({ onNew, query, onQuery, searchOpen, onSearchOpen, onSettings }: { onNew: () => void; query: string; onQuery: (v: string) => void; searchOpen: boolean; onSearchOpen: (open: boolean) => void; onSettings: () => void }) {
	const bots = useStore((state) => state.bots);
	const summaries = useStore((state) => state.summaries);
	const groups = useStore(state => state.groups);
	const [unreadOnly, setUnreadOnly] = useState(false);
	const eligible = (key: string) => !unreadOnly || (summaries[key]?.unreadCount ?? 0) > 0;
	const view = useStore((state) => state.view);
	const showHidden = useStore((state) => state.showHidden);
    const visible = chatEntries({bots, groups, summaries}).filter(entry => eligible(entry.key) &&
        (entry.kind === "bot" ? `${entry.bot.name} ${entry.bot.role}` : `${entry.group.name} ${entry.group.objective}`).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
	const hidden = bots.filter(
		(bot) =>
			bot.status === "hidden" &&
			!conversationRemoved(summaries, `bot:${bot.botId}`) &&
			eligible(`bot:${bot.botId}`) &&
			`${bot.name} ${bot.role}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
	);
	const awaiting = bots
		.filter(
			(bot) =>
				awaitingNewChat(bot, summaries, bot.botId) &&
				`${bot.name} ${bot.role}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
		)
		.toSorted((a, b) => a.createdAt - b.createdAt || a.botId.localeCompare(b.botId));
	const selected = view.kind === "bot" ? view.botId : undefined;
	const onboarding = useStore((state) => state.onboarding);

	return (
		<nav className="sidebar" aria-label={t("Bots")}>
			<div className="sidebar-titlebar">{onboarding === true ? <span className="sidebar-product">OpenBot</span> : null}</div>
            <div className="sidebar-toolbar">
                <span className="sidebar-brand">OpenBot</span>
                <button className="icon-button" aria-label={t("Search conversations")} title={t("Search conversations")} aria-expanded={searchOpen} onClick={() => { onSearchOpen(!searchOpen); if (searchOpen) { onQuery(""); setUnreadOnly(false); } }}><InterfaceIcon name="search" /></button>
                <button className="icon-button new-button" aria-label={t("New")} title={t("New")} onClick={onNew}><InterfaceIcon name="plus" /></button>
            </div>
            <div className="sidebar-search-panel" hidden={!searchOpen}>
			<div className="sidebar-actions">
				<InterfaceIcon name="search" />
				<input
					className="conversation-search"
					type="search"
					aria-label={t("Search conversations")}
					placeholder={t("Find a conversation")}
					value={query}
					maxLength={200}
					onChange={(e) => onQuery(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Escape" && !e.nativeEvent.isComposing) {
                        if (query) onQuery("");
                        else { onSearchOpen(false); setUnreadOnly(false); document.querySelector<HTMLButtonElement>(".sidebar-toolbar button")?.focus(); }
                    }
					}}
				/>
				{query && (
					<button className="clear-search" aria-label={t("Clear search")} onClick={() => onQuery("")}>
						×
					</button>
				)}
				<kbd>⌘ K</kbd>
			</div>
			<div className="conversation-filters" role="group" aria-label={t("Conversation filter")}>
				<button aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>
					{t("All")}
				</button>
				<button aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>
					{t("Unread")}
				</button>
			</div>
			{unreadOnly && !Object.values(summaries).some((r) => r.unreadCount > 0) && (
				<p className="search-status">{t("No unread conversations")}</p>
			)}
			</div>
			<div className="sidebar-conversations">
                <div className="section chat-list" aria-label={t("Chats")}>
                    {visible.map(entry => entry.kind === "bot"
                        ? <BotRow key={entry.key} bot={entry.bot} selected={entry.bot.botId === selected} />
                        : <GroupRow key={entry.key} group={entry.group} />)}
                    {!visible.length && awaiting.length === 0 && <p className="section-empty">{t(query || unreadOnly ? "No matching conversations" : "Create a Bot for a specific job")}</p>}
                </div>
				{awaiting.length > 0 && (
					<div className="section" aria-label={t("Start a chat")}>
						<p className="section-title">{t("Start a chat · ")}{awaiting.length}</p>
						{awaiting.map((bot) => <AwaitingChatRow key={bot.botId} bot={bot} />)}
					</div>
				)}
				{hidden.length > 0 && (
					<div className="section">
						<button
							type="button"
							className="section-toggle"
							aria-expanded={showHidden}
							onClick={() => useStore.setState({ showHidden: !showHidden })}
						>
							{t("Hidden Bots · ")}
							{hidden.length}
						</button>
						{(showHidden || query.trim()) &&
							hidden.map((bot) => <BotRow key={bot.botId} bot={bot} selected={bot.botId === selected} />)}
					</div>
				)}
				<ConversationSearch query={query} unreadOnly={unreadOnly} />
			</div>
			<div className="sidebar-footer">
                <button type="button" className="icon-button" aria-label={t("Files")} title={t("Files")} onClick={openFiles}><InterfaceIcon name="file" /></button>
				<button
					type="button"
					aria-label={t("Settings")} title={t("Settings")}
					className={`settings-icon icon-button ${view.kind === "settings" || view.kind === "skills" || view.kind === "connectors" || view.kind === "routines" ? "is-selected" : ""}`}
					onClick={onSettings}
				>
					<InterfaceIcon name="settings" />
				</button>
			</div>
			{view.kind !== "settings" && view.kind !== "skills" && view.kind !== "connectors" && view.kind !== "routines" && <LifecycleControls contextual />}
		</nav>
	);
}

const ACTIVITY_LABEL: Record<BotSummary["activity"], string | undefined> = {
	needs_attention: "Needs attention",
	working: "Working",
	queued: "Queued",
	unread: "Unread",
	idle: undefined,
};

function AwaitingChatRow({ bot }: { readonly bot: BotSummary }) {
	return (
		<div className="bot-row-line">
			<button
				type="button"
				className="bot-row"
				onClick={() => void startConversation(bot.botId).catch(report)}
				aria-label={t("Start a new chat with {name}", { name: bot.name })}
			>
				<Avatar bot={bot} />
				<span className="bot-row-text">
					<span className="bot-row-name">
						<span className="roster-name">{bot.name}</span>
					</span>
					<span className="roster-preview-line">
						<span className="bot-row-role">{t("New chat")}</span>
					</span>
				</span>
			</button>
		</div>
	);
}

function BotRow({ bot, selected }: { readonly bot: BotSummary; readonly selected: boolean }) {
	const label = bot.activity === "unread" ? undefined : ACTIVITY_LABEL[bot.activity];
	const [deleting, setDeleting] = useState(false);
	return (
		<div className="bot-row-line">
			<button
				type="button"
				className={`bot-row ${selected ? "is-selected" : ""}`}
				onClick={() => void openBot(bot.botId).catch(report)}
				aria-current={selected ? "page" : undefined}
			>
				<Avatar bot={bot} working={bot.activity === "working"} />
				<RosterPreview conversationKey={`bot:${bot.botId}`} name={bot.name} core={bot.kind === "core"} fallback={bot.role} activity={label} />
			</button>
			{bot.kind !== "core" && (
				<button type="button" className="bot-row-delete" aria-label={t("Delete conversation")} onClick={() => setDeleting(true)}>
					<InterfaceIcon name="close" size={14} />
				</button>
			)}
			{deleting && <ConfirmDeleteConversation bot={bot} onClose={() => setDeleting(false)} />}
		</div>
	);
}
