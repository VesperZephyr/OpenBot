import { BotTemplateDialog, ExportTemplateItem, beginTemplateImport, useTemplateState } from "./BotTemplates";
import { HistoryTimeline } from "./HistoryTimeline";
import { BackupSettings, RestoreNotice } from "./BackupSettings";
import { WorkspaceLayout } from "./WorkspaceLayout";
import { openFiles } from "./reader-store";
import { AppearanceSelect } from "./appearance";
import { InterfaceIcon } from "./InterfaceIcon";
import { Avatar, PersonalStar } from "./Avatar";
import { AvatarEditor } from "./AvatarEditor";
import type { AvatarChange } from "@openbot/protocol";
import { RoleSkills } from "./RoleSkills";
import { BotRoutines, BotLibrary, RoutineProposalCard } from "./BotResources";
import {RoutinesPanel} from "./Routines";
import { CredentialStorage } from "./CredentialStorage";
import {ConnectorsPanel} from "./Connectors";
import { BackgroundTask } from "./BackgroundTask";
import { SkillLibrary } from "./Skills";
import { UsagePanel } from "./UsagePanel";
import { ArtifactCard } from "./ArtifactCard";
import {LifecycleControls,InterruptedRun} from "./Lifecycle";
import { appManagementCapability, legacyManagementName, type AppExecution } from "@openbot/protocol";
import { ConversationSearch } from "./ConversationSearch";
import { ChatComposer } from "./ChatComposer";
import { ConversationShell, DetailsPanel, useDialogFocus } from "./ConversationUI";
import { MarkReadButton, RosterPreview, recentTime } from "./RosterPreview";
import { ManagementHistory } from "./BotManagement";
import { t } from "./i18n";
import type {
	BotSummary,
	PendingApproval,
	ConversationSnapshot,
	ModelRef,
	ModelSummary,
	RunRecord,
	ThinkingLevel,
	SkillRef,
	TranscriptItem,
} from "@openbot/protocol";
import { type ReactNode, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { LiveReply, ActivityIndicator } from "./LiveReply";
import { Markdown } from "./markdown";
import { WebSearchSettings } from "./WebSearchSettings";
import { ProfileMemory } from "./ProfileMemory";
import { Divider, RetryButton, retryTarget, Thinking } from "./TranscriptExtras";
import { PendingMessages, StopButton, StoppedNote } from "./runs";
import { ApprovalCard } from "./ApprovalCard";
import { GroupView, GroupRow, GroupEditor } from "./Groups";
import { CommandSettings, FolderSettings } from "./PolicySettings";
import { ConfirmDeleteBot, DeleteBotItem, DuplicateBotItem } from "./BotLifecycle";
import { ModelSetup } from "./ModelSetup";
import { Onboarding } from "./Onboarding";
import { transcriptRows } from "./steps";
import { MessageTime, RevealButton, StepsRow } from "./TranscriptDetails";
import { api, connect, createBot, openBot, refreshBots, refreshSettings, report, errorMessage, sendMessage, useStore } from "./store";

export function App() {
	useDialogFocus();
	const language = useStore((state) => state.settings?.language ?? "en");
	useEffect(() => {
		document.documentElement.lang = language;
	}, [language]);
	const host = useStore((state) => state.host);
	const view = useStore((state) => state.view);
	const lastChat = useRef(view);
	if (["bot", "group", "home"].includes(view.kind)) lastChat.current = view;
	const notice = useStore((state) => state.notice);
	const onboarding = useStore((state) => state.onboarding);
	const [creating, setCreating] = useState(false);
	const [newMenu, setNewMenu] = useState(false);
	const [creatingGroup, setCreatingGroup] = useState(false);
	const [query, setQuery] = useState("");
	const [searchOpen, setSearchOpen] = useState(false);
	useEffect(() => { if (searchOpen) document.querySelector<HTMLInputElement>(".conversation-search")?.focus(); }, [searchOpen]);

	useEffect(() => connect(), []);

	useEffect(() => {
		const onKey = (event: globalThis.KeyboardEvent): void => {
			if ((!event.metaKey && !event.ctrlKey) || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
			if (event.key === "k") {
				event.preventDefault();
				setSearchOpen(true);
				document.querySelector<HTMLInputElement>(".conversation-search")?.focus();
				return;
			}
			if (event.key === "n") {
				event.preventDefault();
				setNewMenu(true);
			} else if (event.key === ",") {
				event.preventDefault();
				useStore.setState({ view: { kind: "settings" } });
			} else if (/^[1-9]$/.test(event.key)) {
                const entry = chatEntries(useStore.getState())[Number(event.key) - 1];
                if (entry) {
                    event.preventDefault();
                    if (entry.kind === "bot") void openBot(entry.bot.botId).catch(report);
                    else useStore.setState({ view: { kind: "group", groupId: entry.group.groupId }, searchTarget: undefined });
                }
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	return (
		<div className="app">
            <WorkspaceLayout sidebar={<Sidebar searchOpen={searchOpen} onSearchOpen={setSearchOpen} query={query} onQuery={setQuery} onNew={() => setNewMenu(true)} />}>
			<main className="main">
				<RestoreNotice />
				{host.status !== "ready" && (
					<div className={`banner banner-${host.status}`}>
						{host.status === "starting" ? t("Starting OpenBot…") : t("OpenBot stopped. {detail}", { detail: host.detail ?? "" })}
					</div>
				)}
				{onboarding === true ? (
					<Onboarding />
				) : (
					<>
						{view.kind === "bot" && <Conversation key={view.botId} botId={view.botId} />}
						{["settings", "skills", "connectors", "routines"].includes(view.kind) && (
							<div className="settings-workspace">
								<nav className="settings-navigation" aria-label={t("Settings navigation")}>
									<button className="back-to-chat" aria-label={t("Back to chat")} onClick={() => useStore.setState({ view: lastChat.current })}>
										← {t("Back to chat")}
									</button>
									<p className="settings-nav-title">{t("Settings")}</p>
									{([
										["settings", "General", "settings"],
										["skills", "Skills", "skills"],
										["connectors", "Connect apps", "apps"],
										["routines", "Routines", "routines"],
									] as const).map(([kind, label, icon]) => (
										<button key={kind} aria-current={view.kind === kind ? "page" : undefined} onClick={() => useStore.setState({ view: { kind } })}>
											<InterfaceIcon name={icon} />{t(label)}
										</button>
									))}
								</nav>
								<div className="settings-content">
									{view.kind === "settings" && <Settings />}
									{view.kind === "skills" && <SkillLibrary />}
									{view.kind === "connectors" && <ConnectorsPanel />}
									{view.kind === "routines" && <RoutinesPanel key={view.proposal?.requestId ?? view.routineId ?? view.botId ?? view.groupId ?? "all"} renderTranscript={(snapshot,occurrenceId) => <HistoryTranscript snapshot={snapshot} occurrenceId={occurrenceId} />} />}
								</div>
							</div>
						)}
						{view.kind === "group" && <GroupView key={view.groupId} groupId={view.groupId} renderExecution={(botId,deliveryId)=><HistoryTranscript snapshot={{botId,channelId:view.groupId,items:[],approvals:[]}} conversationKey={`group:${view.groupId}`} deliveryId={deliveryId}/>}/>}
						{view.kind === "home" && <Home onNew={() => setCreating(true)} />}
					</>
				)}
			</main>
            </WorkspaceLayout>
			<BotTemplateDialog />
			{newMenu && (
				<div className="dialog-backdrop">
					<div className="dialog new-conversation" role="dialog" aria-label={t("New conversation")}>
						<div className="details-heading">
							<h2>{t("New conversation")}</h2>
							<button data-dialog-close aria-label={t("Close")} onClick={() => setNewMenu(false)}>
								×
							</button>
						</div>
						<button
							onClick={() => {
								setNewMenu(false);
								setQuery("");
								setCreating(true);
							}}
						>
							{t("Create new Bot")}
							<small>{t("A teammate with a specific job")}</small>
						</button>
						<button
							onClick={() => {
								setNewMenu(false);
								setQuery("");
								setCreatingGroup(true);
							}}
						>
							{t("Create group")}
							<small>{t("Bring your Bots together for a task")}</small>
						</button>
						<button onClick={() => { setNewMenu(false); beginTemplateImport(); }}>{t("Import template")}</button>
					</div>
				</div>
			)}
			{creatingGroup && <GroupEditor onClose={() => setCreatingGroup(false)} />}
			{creating && <NewBotDialog onClose={() => setCreating(false)} />}
			{notice !== undefined && (
				<div className="toast" role="status">
					<span>{t(notice)}</span>
					<button type="button" className="toast-close" onClick={() => useStore.setState({ notice: undefined })}>
						{t("Dismiss")}
					</button>
				</div>
			)}
		</div>
	);
}

/** Core and pinned chats keep priority; all other conversations share recency ordering. */
function chatEntries(state: Pick<ReturnType<typeof useStore.getState>, "bots" | "groups" | "summaries">) {
    const entries = [
        ...state.bots.filter(bot => bot.status === "active").map(bot => ({ kind: "bot" as const, bot, key: `bot:${bot.botId}` as const, priority: bot.kind === "core" ? 2 : bot.pinned ? 1 : 0, at: bot.createdAt })),
        ...state.groups.map(group => ({ kind: "group" as const, group, key: `group:${group.groupId}` as const, priority: 0, at: group.createdAt })),
    ];
    return entries.toSorted((a, b) => b.priority - a.priority || recentTime(b.key, state.summaries, b.at) - recentTime(a.key, state.summaries, a.at) || a.key.localeCompare(b.key));
}

function Sidebar({ onNew, query, onQuery, searchOpen, onSearchOpen }: { onNew: () => void; query: string; onQuery: (v: string) => void; searchOpen: boolean; onSearchOpen: (open: boolean) => void }) {
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
			eligible(`bot:${bot.botId}`) &&
			`${bot.name} ${bot.role}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
	);
	const selected = view.kind === "bot" ? view.botId : undefined;

	return (
		<nav className="sidebar" aria-label={t("Bots")}>
			<div className="sidebar-titlebar" />
            <div className="sidebar-toolbar">
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
                    {!visible.length && <p className="section-empty">{t(query || unreadOnly ? "No matching conversations" : "Create a Bot for a specific job")}</p>}
                </div>
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
					className={`settings-icon icon-button ${["settings", "skills", "connectors", "routines"].includes(view.kind) ? "is-selected" : ""}`}
					onClick={() => useStore.setState({ view: { kind: "settings" } })}
				>
					<InterfaceIcon name="settings" />
				</button>
			</div>
			{!["settings", "skills", "connectors", "routines"].includes(view.kind) && <LifecycleControls contextual />}
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

function BotRow({ bot, selected }: { readonly bot: BotSummary; readonly selected: boolean }) {
	const label = bot.activity === "unread" ? undefined : ACTIVITY_LABEL[bot.activity];
	return (
		<button
			type="button"
			className={`bot-row ${selected ? "is-selected" : ""}`}
			onClick={() => void openBot(bot.botId).catch(report)}
			aria-current={selected ? "page" : undefined}
		>
			<Avatar bot={bot} />
			<RosterPreview conversationKey={`bot:${bot.botId}`} name={bot.name} core={bot.kind === "core"} fallback={bot.role} activity={label} />
		</button>
	);
}

function Home({ onNew }: { onNew: () => void }) {
	const bots = useStore((state) => state.bots);
	return (
		<div className="home">
			<h1>{t("Meet your teammates")}</h1>
			<p>
				{t(
					"A Bot is a long-lived teammate with one job. Give it a name and a role, then message it like a colleague. Every Bot works on this Mac.",
				)}
			</p>
			<button type="button" className="primary" onClick={onNew}>
				{t(bots.length === 0 ? "Create your first Bot" : "Create a Bot")}
			</button>
		</div>
	);
}

function NewBotDialog({ onClose }: { onClose: () => void }) {
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const submit = async (event: FormEvent): Promise<void> => {
		event.preventDefault();
		if (name.trim() === "" || busy) return;
		setBusy(true);
		try {
			await createBot(name.trim());
			onClose();
		} catch (error) {
			report(error);
			setBusy(false);
		}
	};
	return (
		<div className="dialog-backdrop" onMouseDown={onClose}>
			<form className="dialog" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
				<h2>{t("Create a Bot")}</h2>
				<label className="field">
					<span>{t("Bot name")}</span>
					<input
						autoFocus
						value={name}
						placeholder="Piper"
						onChange={(event) => setName(event.target.value)}
						onKeyDown={(event) => event.key === "Escape" && onClose()}
					/>
				</label>
				<div className="dialog-actions">
					<button type="button" data-dialog-close onClick={onClose}>
						{t("Cancel")}
					</button>
					<button type="submit" className="primary" disabled={name.trim() === "" || busy}>
						{name.trim() === "" ? t("Create new Bot") : t("Create “{name}” Bot", { name: name.trim() })}
					</button>
				</div>
			</form>
		</div>
	);
}

function Conversation({ botId }: { readonly botId: string }) {
	const bot = useStore((state) => state.bots.find((candidate) => candidate.botId === botId));
	const snapshot = useStore((state) => state.conversations[botId]);
	const [editing, setEditing] = useState(false);
	const importedProfile = useTemplateState(s => s.profileBotId === botId);
	useEffect(() => {
		if (importedProfile) {
			setEditing(true);
			useTemplateState.setState({ profileBotId: null });
		}
	}, [importedProfile]);
 const count=useStore(state=>state.summaries[`bot:${botId}`]?.latest!==undefined);

	if (bot === undefined) return null;
	const running = snapshot?.live !== undefined || snapshot?.run !== undefined || (snapshot?.pending?.length ?? 0) > 0;

	return (
		<ConversationShell
			className={`conversation ${snapshot === undefined || (!count && !running) ? "is-empty" : ""}`}
			label={t("Conversation with {name}", { name: bot.name })}
			details={
				editing && (
					<DetailsPanel modal heading={<span className="bot-profile-heading"><Avatar bot={bot} size={32} />{bot.name}</span>} title={t("Conversation details")} onClose={() => setEditing(false)}>
						<EditProfile bot={bot} onClose={() => setEditing(false)} />
					</DetailsPanel>
				)
			}
		>
			<header className="conversation-header">
				<Avatar bot={bot} size={29} />
				<div className="conversation-title">
					<div className="conversation-name"><span title={bot.name}>{bot.name}</span>{bot.kind === "core" && <PersonalStar />}</div>
					<div className="conversation-role">{bot.role || t("No label")}</div>
				</div>
				<MarkReadButton conversationKey={`bot:${botId}`} cursor={snapshot?.readCursor} />
				<button className="details-toggle" aria-label={t("Conversation details")} onClick={() => setEditing(!editing)}>
					<InterfaceIcon name="info" /><span>{t("Details")}</span>
				</button>
				<BotMenu bot={bot} onEdit={() => setEditing(true)} />
			</header>
   {snapshot?<HistoryTranscript snapshot={snapshot} empty={<EmptyConversation bot={bot}/>} />:<ActivityIndicator label="Loading conversation"/>}
			<ChatComposer
				conversationKey={`bot:${botId}`}
				label={t("Message {name}", { name: bot.name })}
				controls={<StopButton run={snapshot?.run} />}
			/>
		</ConversationShell>
	);
}

function EmptyConversation({ bot }: { readonly bot: BotSummary }) {
	const hasModel = useStore((state) => bot.model !== undefined || state.settings?.defaultModel !== undefined);
	return (
		<div className="empty-conversation">
			<div className="welcome-copy">
				<p className="greeting-label">
					<InterfaceIcon name="routines" />
					{t("A little room for you")}
				</p>
				<h2>
					{t("Good to see you.")}
					<br />
					<em>{t("What’s on your mind?")}</em>
				</h2>
				<p>{t("We can think it through, make a plan, or just untangle one small thing.")}</p>
				{!hasModel && (
					<button type="button" onClick={() => useStore.setState({ view: { kind: "settings" } })}>
						{t("Connect a model")}
					</button>
				)}
			</div>
			<div className="welcome-character">
				<span className="welcome-note">{t("One thing at a time.")}</span>
				<Avatar bot={bot} size={164} />
			</div>
		</div>
	);
}

function HistoryTranscript({
	snapshot,
	occurrenceId,
	deliveryId,
	conversationKey,
	empty,
}: {
	snapshot: ConversationSnapshot;
	occurrenceId?: string;
	deliveryId?: string;
	conversationKey?: import("@openbot/protocol").ConversationKey;
	empty?: React.ReactNode;
}) {
	return (
		<HistoryTimeline
			conversationKey={conversationKey ?? `bot:${snapshot.botId}`}
			{...(occurrenceId ? { occurrenceId } : {})}
			{...(deliveryId ? { deliveryId } : {})}
			activity={JSON.stringify(snapshot)}
			empty={empty}
			renderRow={(row, context) => {
				if (row.content.kind !== "direct") return null;
				const items = context.rows.flatMap((r) => (r.content.kind === "direct" ? [r.content.item] : [])),
					latest = items.findLast((i) => i.kind === "assistant");
				const retry =
					!snapshot.channelId && snapshot.retry && (snapshot.retry.outcomeId ? snapshot.retry.outcomeId === row.id : context.atLatest && latest?.id === row.id)
						? { id: row.id, ...snapshot.retry }
						: undefined;
				const item = row.content.item;
				const active = item.kind === "tool" && item.status === "pending" ? snapshot.live?.tools?.find(tool => tool.callId === item.id) : undefined;
				const displayed = active && item.kind === "tool" ? { ...item, status: "running" as const, ...(active.output ? { output: active.output } : {}) } : item;
				return (
					<Transcript snapshot={{ ...snapshot, items: [displayed] }} historyOnly {...(retry ? { retryOverride: retry } : {})} />
				);
			}}
		>
			<Transcript snapshot={{ ...snapshot, items: [] }} />
		</HistoryTimeline>
	);
}

function Transcript({ snapshot,historyOnly=false,retryOverride }: { readonly snapshot: ConversationSnapshot;historyOnly?:boolean;retryOverride?:ReturnType<typeof retryTarget> }) {
	const approvals = new Map(snapshot.approvals.map((approval) => [approval.callId, approval]));
	const retry = retryOverride??(snapshot.channelId ? undefined : retryTarget(snapshot.items, snapshot.live !== undefined));
	const item = (entry: TranscriptItem) =>
		entry.kind === "tool" ? (
			<ToolCard
				key={entry.id}
    showApprovals={!historyOnly}
				item={entry}
				background={snapshot.backgroundTasks?.find(record=>record.taskId===entry.taskId)}
				approval={approvals.get(entry.id)}
				childApprovals={entry.execution?.children.flatMap((c) => (approvals.get(c.callId) ? [approvals.get(c.callId)!] : [])) ?? []}
			/>
		) : entry.kind === "outcome" ? (
            entry.category === "interrupted" && !snapshot.channelId && snapshot.run?.runId === entry.runId && snapshot.run.state === "needs_attention" ? <InterruptedRun key={entry.id} run={snapshot.run} /> : <OutcomeRow key={entry.id} item={entry} retry={retry?.id === entry.id ? { botId: snapshot.botId, ...retry } : undefined} />
        ) : entry.kind === "divider" ? (
			<Divider key={entry.id} item={entry} />
		) : (
			<Message
				key={entry.id}
				botId={snapshot.botId}
				item={entry}
				retry={
					retry?.id === entry.id
						? { botId: snapshot.botId, text: retry.text,...(retry.skills?{skills:retry.skills}:{}), ...(retry.artifactIds ? { artifactIds: retry.artifactIds } : {}) }
						: undefined
				}
			/>
		);
	return (
		<ol className="messages">
			{transcriptRows(snapshot.items, new Set(approvals.keys())).map((row) =>
				row.kind === "item" ? (
					item(row.item)
				) : (
					<StepsRow key={row.id} count={row.items.length}>
						{row.items.map(item)}
					</StepsRow>
				),
			)}
			{!historyOnly&&<PendingMessages snapshot={snapshot} />}
 {!historyOnly&&snapshot.approvals.map(approval=><li key={approval.approvalId} className="approval-slot"><ApprovalCard approval={approval}/></li>)}
 {!historyOnly&&!snapshot.channelId?.startsWith("routine_")&&!snapshot.messageMode&&snapshot.run?.state==="needs_attention"&&<InterruptedRun key={snapshot.run.runId} run={snapshot.run}/>}
            {!historyOnly&&(snapshot.live || snapshot.run?.state === "running" || snapshot.run?.state === "queued") && (
                <li className="message message-assistant is-live"><LiveReply snapshot={snapshot} /></li>
            )}
		</ol>
	);
}

function Message(props: {
	readonly botId: string;
	readonly item: Exclude<TranscriptItem, { kind: "tool" | "divider" }>;
	readonly retry: { readonly botId: string; readonly text: string; readonly artifactIds?: readonly string[];readonly skills?:readonly import("@openbot/protocol").SkillRef[] } | undefined;
}) {
	const { item, retry } = props;
	const author = useStore(state => state.bots.find(bot => bot.botId === props.botId));
	if (item.kind === "other" || item.kind === "outcome") return null;
	if (item.kind === "stopped") return <StoppedNote />;
	return (
		<li data-message-id={item.id} className={`message message-${item.kind==="user"&&!!item.source?"background":item.kind}`}>
			{item.kind === "assistant" && author ? <div className="message-author"><Avatar bot={author} size={28} /><strong>{author.name}</strong><MessageTime at={item.at} /></div> : <MessageTime at={item.at} />}
 {item.kind==="assistant"&&item.routine&&<div className="routine-report-label"><span>{t("Routine report")} · {item.routine.name} · {t(item.routine.state==="needs_attention"?"Needs attention":item.routine.state[0]!.toUpperCase()+item.routine.state.slice(1))}</span><button onClick={()=>useStore.setState({view:{kind:"routines",routineId:item.routine!.routineId,occurrenceId:item.routine!.occurrenceId}})}>{t("View routine")}</button></div>}
 {item.kind==="assistant"&&item.artifacts?.map(ref=><ArtifactCard key={ref.artifactId} artifact={ref}/>)}
			{item.kind === "assistant" && item.thinking !== undefined && <Thinking text={item.thinking} />}
			{item.kind==="user"&&!!item.source?<details><summary>{t(item.kind==="user"&&item.source==="routine"?"Scheduled workflow":"Background task result")}</summary><MessageText parts={item.parts}/></details>:<MessageText parts={item.parts} markdown={item.kind === "assistant"} />}
			{item.kind === "user" && item.skills?.map(skill=><span className="skill-chip" key={skill.name}>/{skill.name} <small>v{skill.revision}</small></span>)}
 {item.kind === "user" && item.attachments?.map((ref) => <ArtifactCard key={ref.artifactId} artifact={ref} />)}
			{item.kind === "user" && item.error && <p className="message-error">{t(item.error)}</p>}
			{item.kind === "assistant" && item.error !== undefined && (
				<div className="message-error">
					{item.error}
					{retry !== undefined && (
						<RetryButton botId={retry.botId} text={retry.text} {...(retry.skills?{skills:retry.skills}:{})} {...(retry.artifactIds ? { artifactIds: retry.artifactIds } : {})} />
					)}
				</div>
			)}
		</li>
	);
}

function MessageText({ parts, markdown = false }: { readonly parts: readonly { readonly text: string }[]; readonly markdown?: boolean }) {
	const text = parts.map((part) => part.text).join("\n\n");
	if (markdown) return <Markdown text={text} />;
	return (
		<div className="message-text">
			{parts.map((part, index) => (
				// Parts have no identity of their own; their order is stable within one message.
				<p key={index}>{part.text}</p>
			))}
		</div>
	);
}

const TOOL_VERBS: Record<string, readonly [running: string, done: string, action?: string]> = {
 routine_propose: ["Preparing routine", "Routine proposed"],
 tool_search:["Finding connector tools","Found connector tools"],
	skill_load: ["Load skill", "Loaded skill"],
 skill_save: ["Review skill", "Reviewed skill"],
 artifact_publish: ["Publish result file", "Published result file"],
	codemode: ["Reading application data", "Read application data"],
	app_conversations_search: ["Searching chat history", "Searched chat history", "Search chat history"],
	app_conversations_read: ["Reading chat context", "Read chat context", "Read chat context"],
	app_conversations_list: ["Listing conversations", "Listed conversations", "List conversations"],
	app_bots_list: ["Inspecting Bots", "Inspected Bots", "Inspect Bots"],
	app_groups_list: ["Inspecting groups", "Inspected groups", "Inspect groups"],
	group_inspect: ["Inspecting groups", "Inspected groups", "Inspect groups"],
	group_create: ["Creating group", "Created group", "Create group"],
	group_update: ["Updating group", "Updated group", "Update group"],
	group_dissolve: ["Dissolving group", "Dissolved group", "Dissolve group"],
	bot_inspect: ["Inspecting Bots", "Inspected Bots", "Inspect Bots"],
	bot_create: ["Creating Bot", "Created Bot", "Create Bot"],
	bot_update: ["Updating Bot", "Updated Bot", "Update Bot"],
	bot_delete: ["Deleting Bot", "Deleted Bot", "Delete Bot"],
	local_read: ["Reading", "Read"],
	local_list: ["Listing", "Listed"],
	local_write: ["Writing", "Wrote"],
	local_edit: ["Editing", "Edited"],
	local_exec: ["Running", "Ran"],
	web_fetch: ["Fetching", "Fetched"],
	web_search: ["Searching", "Searched"],
	memory_update: ["Updating memory", "Updated memory"],
	task_output: ["Checking task", "Checked task"],
	task_stop: ["Stopping task", "Stopped task"],
};

/** One row per tool call: a verb and subject, expandable to the arguments and output; failures open by default. */
function ToolCard({
	item,
	background,
	approval,
	childApprovals = [],
 showApprovals=true,
}: {
 readonly showApprovals?:boolean;
	readonly item: Extract<TranscriptItem, { kind: "tool" }>;
	readonly background?:import("@openbot/protocol").BackgroundRecord|undefined;
	readonly approval: PendingApproval | undefined;
	readonly childApprovals?: readonly PendingApproval[];
}) {
	const args = (item.args ?? {}) as Record<string, unknown>;
	let output = item.output;
	if (item.tool === "codemode" && item.execution?.error) output = t(item.execution.error);
	if (item.tool.startsWith("app_") && output) {
		try {
			const result = JSON.parse(output);
			if (result.ok === false && typeof result.error?.message === "string") output = t(result.error.message);
		} catch {
			/* Interrupted tools may not have a complete result envelope. */
		}
	}
	const managedName = useStore(
		(state) =>
			state.bots.find((bot) => bot.botId === args.botId)?.name ?? state.groups.find((group) => group.groupId === args.groupId)?.name,
	);
	const [running, done] = item.execution?.children.some((c) => appManagementCapability(c.capability))
		? ["Working with application", "Application work completed"]
		: (TOOL_VERBS[item.tool] ?? [item.tool, item.tool]);
	const subject = String(
		args.name ??
			managedName ??
			args.botId ??
			args.description ??
			args.path ??
			args.url ??
			args.command ??
			args.query ??
			args.section ??
			args.taskId ??
			"",
	);
	const waiting = approval !== undefined || childApprovals.length > 0;
	const failureLabel=item.failureReason?{approval_expired:"Approval expired",permission_revoked:"Permission revoked",approval_denied:"Approval denied"}[item.failureReason]:undefined;
 const label = failureLabel?t(failureLabel):waiting
		? t("Waiting for approval")
		: item.status === "running" || item.status === "pending"
			? t(running)
			: item.status === "failed"
				? t("{action} · failed", { action: t(done) })
				: item.status === "interrupted"
					? t("Interrupted")
					: item.status === "cancelled"
						? t("{action} · stopped", { action: t(running) })
						: t(done);
	const selected=useStore(state=>state.searchTarget?.messageId===item.id);
 const open = selected || waiting || item.status === "failed" || item.status === "interrupted";
	return (
		<li data-message-id={item.id} className={`tool-card tool-${waiting ? "waiting" : item.status} ${selected?"search-target":""}`}>
			<details open={open}>
				<summary>
					<span className="tool-status" aria-hidden />
					<span className="tool-verb">{label}</span>
					<span className="tool-subject">{subject}</span>
					{item.tool === "local_exec" && item.taskId !== undefined && (
						<span className="tool-task">
							{t("background · ")}
							{item.taskId}
						</span>
					)}
					<RevealButton item={item} />
				</summary>
				{item.execution ? <CodeActivity children={item.execution.children} /> : null}
				{item.tool === "codemode" && typeof args.code === "string" ? (
					<details className="code-source">
						<summary>{t("View script")}</summary>
						<pre className="tool-output">{args.code}</pre>
					</details>
				) : null}
				{item.tool === "local_exec" && typeof args.command === "string" && <pre className="tool-command">$ {args.command}</pre>}
				{output !== undefined && output !== "" && <pre className="tool-output">{output}</pre>}
			</details>
			{background&&<BackgroundTask record={background}/>}
			{item.routineProposal && item.status === "succeeded" && <RoutineProposalCard proposal={item.routineProposal} />}
			{item.artifact && item.status === "succeeded" && <ArtifactCard artifact={item.artifact} />}
			{showApprovals&&approval !== undefined && <ApprovalCard approval={approval} />}
			{showApprovals&&childApprovals.map((child) => (
				<ApprovalCard key={child.approvalId} approval={child} />
			))}
		</li>
	);
}

function CodeActivity({ children }: { readonly children: AppExecution["children"] }) {
	return (
		<ul className="code-activity" aria-label={t("Application steps")}>
			{children.map((child) => {
				const verb = TOOL_VERBS[legacyManagementName(child.capability)];
				const status =
					child.outcome === "expired"
						? "Expired"
						: child.outcome === "denied"
							? "Denied"
							: child.outcome === "unknown"
								? "Needs attention"
								: child.state === "running"
									? "Running"
									: child.state === "succeeded"
										? "Completed"
										: child.state === "cancelled"
											? "Stopped"
											: "Failed";
				return (
					<li key={child.callId} data-state={child.state}>
						<span>{t(verb?.[child.state === "running" ? 0 : child.state === "succeeded" ? 1 : 2] ?? child.capability)}</span>
						<span>{t(status)}</span>
						{child.object ? <CodeObject object={child.object} /> : null}
					</li>
				);
			})}
		</ul>
	);
}
function CodeObject({ object }: { readonly object: NonNullable<AppExecution["children"][number]["object"]> }) {
	const resource = useStore((state) =>
		object.kind === "bot" ? state.bots.find((b) => b.botId === object.id) : state.groups.find((g) => g.groupId === object.id),
	);
	const label = `${resource?.name ?? `${t(object.kind === "bot" ? "Bot" : "Group")} · ${object.id.slice(-8)}`} · ${t("Revision")} ${object.revision}`;
	return resource ? (
		<button
			className="code-object"
			type="button"
			title={object.id}
			onClick={() => {
				if (object.kind === "bot") void openBot(object.id).catch(report);
				else useStore.setState({ view: { kind: "group", groupId: object.id } });
			}}
		>
			{label}
		</button>
	) : (
		<span className="code-object" title={object.id}>
			{label}
		</span>
	);
}

function BotMenu({ bot, onEdit }: { readonly bot: BotSummary; readonly onEdit: () => void }) {
	const [open, setOpen] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const menu = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) return;
		menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
		const close = (event: PointerEvent) => {
			if (!menu.current?.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener("pointerdown", close);
		return () => document.removeEventListener("pointerdown", close);
	}, [open]);
	const update = async (change: { pinned?: boolean; status?: "active" | "hidden" }): Promise<void> => {
		setOpen(false);
		try {
			await api["bots.update"]({ botId: bot.botId, ...change });
			await refreshBots();
		} catch (error) {
			report(error);
		}
	};
	const newTopic = async (): Promise<void> => {
		setOpen(false);
		try {
			await api["conversations.reset"]({ botId: bot.botId });
		} catch (error) {
			report(error);
		}
	};
	return (
		<div className="menu" ref={menu}>
			<button type="button" className="icon-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
				•••
			</button>
			{open && (
				<div
					className="menu-popover"
					role="menu"
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							setOpen(false);
							e.currentTarget.parentElement?.querySelector<HTMLElement>("button")?.focus();
						}
						if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
							e.preventDefault();
							const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
							const index = items.indexOf(document.activeElement as HTMLElement);
							items[
								e.key === "Home"
									? 0
									: e.key === "End"
										? items.length - 1
										: (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length
							]?.focus();
						}
					}}
				>
					<button type="button" role="menuitem" onClick={() => (setOpen(false), onEdit())}>
						{t("Edit profile")}
					</button>
					{bot.kind !== "core" && (
						<>
							<button type="button" role="menuitem" onClick={() => void update({ pinned: !bot.pinned })}>
								{t(bot.pinned ? "Unpin" : "Pin")}
							</button>
							<button type="button" role="menuitem" onClick={() => void update({ status: bot.status === "hidden" ? "active" : "hidden" })}>
								{t(bot.status === "hidden" ? "Show in sidebar" : "Hide from sidebar")}
							</button>
						</>
					)}
					<button type="button" role="menuitem" onClick={() => void newTopic()}>
						{t("New topic")}
					</button>
					<ExportTemplateItem botId={bot.botId} onDone={() => setOpen(false)} />
					<DuplicateBotItem bot={bot} onDone={() => setOpen(false)} />
					{bot.kind !== "core" && <DeleteBotItem onChoose={() => (setOpen(false), setDeleting(true))} />}
				</div>
			)}
			{deleting && <ConfirmDeleteBot bot={bot} onClose={() => setDeleting(false)} />}
		</div>
	);
}

function EditProfile({ bot, onClose }: { readonly bot: BotSummary; readonly onClose: () => void }) {
	const [tab, setTab] = useState<"profile" | "memory" | "routines" | "library">("profile");
	return (
		<div className="profile">
			<div className="profile-tabs" role="tablist">
				<button type="button" role="tab" aria-selected={tab === "profile"} onClick={() => setTab("profile")}>
					{t("Profile")}
				</button>
				<button type="button" role="tab" aria-selected={tab === "memory"} onClick={() => setTab("memory")}>
					{t("Memory")}
				</button>
				<button type="button" role="tab" aria-selected={tab === "routines"} onClick={() => setTab("routines")}>{t("Routines")}</button>
				<button type="button" role="tab" aria-selected={tab === "library"} onClick={() => setTab("library")}>{t("Library")}</button>
			</div>
			{tab === "routines" && <BotRoutines botId={bot.botId} onClose={onClose} />}
			{tab === "library" && <BotLibrary botId={bot.botId} onClose={onClose} />}
			<div hidden={tab !== "profile"}>
				<ProfileForm bot={bot} onClose={onClose} />
				<UsagePanel botId={bot.botId} onNavigate={onClose} />
			</div>
			<div hidden={tab !== "memory"}>
				<ProfileMemory botId={bot.botId} onClose={onClose} />
			</div>
		</div>
	);
}

const THINKING_LABEL: Record<ThinkingLevel, string> = { off: "Off", low: "Low", medium: "Medium", high: "High" };

function ProfileForm({ bot, onClose }: { readonly bot: BotSummary; readonly onClose: () => void }) {
	const [revision, setRevision] = useState(bot.revision);
	const [avatar, setAvatar] = useState<AvatarChange>();
	const [profileBase, setProfileBase] = useState(bot);
	const [defaultSkills, setDefaultSkills] = useState<readonly SkillRef[]>(bot.defaultSkills ?? []);
	const [saveError, setSaveError] = useState("");
	const [saving, setSaving] = useState(false);
	const [name, setName] = useState(bot.name);
	const [role, setRole] = useState(bot.role);
	const [instructions, setInstructions] = useState(bot.instructions);
	const [model, setModel] = useState<ModelRef | undefined>(bot.model);
	const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(bot.thinkingLevel ?? "off");
	const models = useStore((state) => state.models);
	const defaultModel = useStore((state) => state.settings?.defaultModel);
	const effective = model ?? defaultModel;
	const reasoning = models.some(
		(candidate) =>
			candidate.reasoning && candidate.provider === effective?.provider && candidate.modelId === effective.modelId,
	);
	const save = async (event: FormEvent): Promise<void> => {
		event.preventDefault();
		if (saving || !name.trim()) return;
		setSaving(true);
		try {
			await api["bots.update"]({
				botId: bot.botId,
				expectedRevision: revision,
				...(avatar ? { avatar } : {}),
				defaultSkills,
				name: name.trim() || bot.name,
				role,
				instructions,
				model: model ?? null,
				...(reasoning ? { thinkingLevel } : {}),
			});
			await refreshBots();
			onClose();
		} catch (error) {
			setSaveError(errorMessage(error));
		} finally {
			setSaving(false);
		}
	};
	return (
		<form className="profile-form" onSubmit={save}>
			<div className="profile-layout">
				<AvatarEditor bot={profileBase} role={role} value={avatar} onChange={setAvatar} disabled={saving} />
				<div className="profile-fields">
					{saveError && (
						<div role="alert">
							{t(saveError)}{" "}
							<button
								type="button"
								disabled={saving}
								onClick={() =>
									void api["bots.list"]({})
										.then((bots) => {
											const fresh = bots.find((item) => item.botId === bot.botId);
											if (!fresh) return;
											setRevision(fresh.revision);
											setAvatar(undefined);
											setProfileBase(fresh);
											setDefaultSkills(fresh.defaultSkills ?? []);
											setName(fresh.name);
											setRole(fresh.role);
											setInstructions(fresh.instructions);
											setModel(fresh.model);
											setThinkingLevel(fresh.thinkingLevel ?? "off");
											setSaveError("");
										})
										.catch(report)
								}
							>
								{t("Reload profile")}
							</button>
						</div>
					)}
					<div className="profile-grid">
						<label className="field">
							<span>{t("Name")}</span>
							<input required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} />
						</label>
						<label className="field">
							<span>{t("Label")}</span>
							<input
								maxLength={200}
								value={role}
								placeholder={t("Research")}
								onChange={(event) => setRole(event.target.value)}
							/>
						</label>
					</div>
					<label className="field">
						<span>{t("Prompt")}</span>
						<textarea
							rows={4}
							aria-label={t("Prompt")}
							value={instructions}
							placeholder={t("Own the weekly account review. Never send external messages without approval.")}
							onChange={(event) => setInstructions(event.target.value)}
						/>
					</label>
					<details className="profile-advanced">
						<summary>{t("Model and skills")}</summary>
						<p className="field-hint">
							{t(
								"Prompt defines this Bot's role and behavior. Saved changes apply to the next model request; a reply already in progress uses its existing context.",
							)}
						</p>
						<div className="memory-meta">
							{t("Revision")} {revision}
						</div>
						<div className="profile-grid">
							<label className="field">
								<span>{t("Model")}</span>
								<ModelSelect value={model} onChange={setModel} emptyLabel={t("Use the default model")} />
							</label>
							{reasoning && (
								<label className="field">
									<span>{t("Thinking")}</span>
									<select
										value={thinkingLevel}
										onChange={(event) => setThinkingLevel(event.target.value as ThinkingLevel)}
									>
										{(Object.keys(THINKING_LABEL) as ThinkingLevel[]).map((level) => (
											<option key={level} value={level}>
												{t(THINKING_LABEL[level])}
											</option>
										))}
									</select>
								</label>
							)}
						</div>
						<RoleSkills value={defaultSkills} onChange={setDefaultSkills} disabled={saving} />
					</details>
					{bot.kind === "core" && (
						<p className="profile-protection">
							<PersonalStar /> {t("Your personal assistant. Change its name and avatar; it cannot be deleted.")}
						</p>
					)}
				</div>
			</div>
			<div className="dialog-actions">
				<button type="button" onClick={onClose}>
					{t("Cancel")}
				</button>
				<button type="submit" className="primary" disabled={saving || !name.trim()}>
					{t("Save profile")}
				</button>
			</div>
		</form>
	);
}

function ModelSelect(props: {
	readonly value: ModelRef | undefined;
	readonly onChange: (model: ModelRef | undefined) => void;
	readonly emptyLabel: string;
}) {
	const models = useStore((state) => state.models);
	const settings = useStore((state) => state.settings);
	const configured = new Set(settings?.providers.filter((p) => p.configured).map((p) => p.providerId));
	const groups = useMemo(() => {
		const byProvider = new Map<string, ModelSummary[]>();
		for (const model of models) {
			if (!configured.has(model.provider)) continue;
			byProvider.set(model.provider, [...(byProvider.get(model.provider) ?? []), model]);
		}
		return [...byProvider];
	}, [models, settings]);
	const selected = props.value === undefined ? "" : `${props.value.provider}/${props.value.modelId}`;

	return (
		<select
			value={selected}
			onChange={(event) => {
				const separator = event.target.value.indexOf("/");
				props.onChange(
					separator < 0
						? undefined
						: { provider: event.target.value.slice(0, separator), modelId: event.target.value.slice(separator + 1) },
				);
			}}
		>
			<option value="">{t(props.emptyLabel)}</option>
			{/* Keep a stored model selectable even when its provider key was removed. */}
			{props.value !== undefined && !groups.some(([, list]) => list.some((m) => `${m.provider}/${m.modelId}` === selected)) && (
				<option value={selected}>
					{selected}
					{t(" · Unavailable")}
				</option>
			)}
			{groups.map(([provider, list]) => (
				<optgroup
					key={provider}
					label={`${provider} · ${t(list[0]?.source === "custom" ? "Custom" : "Built-in")}${list[0]?.overridden ? t(" · Local override") : ""}`}
				>
					{list.map((model) => (
						<option key={model.modelId} value={`${model.provider}/${model.modelId}`}>
							{model.name}
						</option>
					))}
				</optgroup>
			))}
		</select>
	);
}

function Settings() {
	useEffect(() => {
		void refreshSettings().catch(report);
	}, []);
	const settings = useStore((state) => state.settings);
	const [providerId, setProviderId] = useState("openai");
	const [apiKey, setApiKey] = useState("");

	if (settings === undefined) return <CredentialStorage />;
	const configured = settings.providers.filter((provider) => provider.configured);

	const saveKey = async (event: FormEvent): Promise<void> => {
		event.preventDefault();
		const key = apiKey;
		// Clear the field immediately: the key must not linger in renderer state.
		setApiKey("");
		try {
			await api["credentials.set"]({ providerId, apiKey: key });
			await refreshSettings();
		} catch (error) {
			report(error);
		}
	};

	return (
		<section className="settings" aria-label={t("Settings")}>
			<header className="settings-heading">
				<span className="eyebrow">{t("MAKE IT YOURS")}</span>
				<h1>{t("Settings")}</h1>
				<p className="muted">{t("Your models, preferences and permissions. On your Mac.")}</p>
			</header>
			<AppearanceSelect />
            <LifecycleControls />
			<nav className="settings-jump" aria-label={t("Settings sections")}>
				{[
					["models", "Models"],
					["language", "Language"],
					["permissions", "Permissions"],
					["data", "Data"],
				].map(([id, label]) => (
					<button type="button" key={id} onClick={() => document.getElementById(`settings-${id}`)?.scrollIntoView({ block: "start" })}>
						{t(label!)}
					</button>
				))}
			</nav>

			<div className="settings-group" id="settings-models">
				<h2>{t("Default model")}</h2>
				<p className="muted">{t("Bots without a model of their own use this one.")}</p>
				<ModelSelect
					value={settings.defaultModel}
					emptyLabel={configured.length === 0 ? "Add an API key below first" : "Choose a model"}
					onChange={(model) =>
						void api["settings.update"]({ defaultModel: model ?? null })
							.then(refreshSettings)
							.catch(report)
					}
				/>
			</div>

			<div className="settings-group" id="settings-language">
				<label className="field">
					<span>{t("Language")}</span>
					<select
						aria-label={t("Language")}
						value={settings.language ?? "en"}
						onChange={(event) =>
							void api["settings.update"]({ language: event.target.value as "en" | "zh-CN" })
								.then(refreshSettings)
								.catch(report)
						}
					>
						<option value="en">English</option>
						<option value="zh-CN">简体中文</option>
					</select>
				</label>
				<p className="model-caption">{t("Changes the app interface. Your conversations and Bot instructions stay as written.")}</p>
			</div>
			<div className="settings-group">
				<h2>{t("Connect a model")}</h2>
				<ModelSetup />
			</div>

			<div className="settings-group">
				<h2>{t("Provider credentials")}</h2>
				<p className="muted">{t("Keys are stored in the macOS Keychain and never shown again.")}</p>
				<form className="key-form" onSubmit={saveKey}>
					<select value={providerId} onChange={(event) => setProviderId(event.target.value)} aria-label={t("Provider")}>
						{settings.providers.map((provider) => (
							<option key={provider.providerId} value={provider.providerId}>
								{provider.name}
							</option>
						))}
					</select>
					<input
						type="password"
						autoComplete="off"
						value={apiKey}
						placeholder={t("API key")}
						onChange={(event) => setApiKey(event.target.value)}
						aria-label={t("API key")}
					/>
					<button type="submit" className="primary" disabled={apiKey.trim() === ""}>
						{t("Save key")}
					</button>
				</form>
				<ul className="provider-list">
					{configured.length === 0 && <li className="muted">{t("No provider keys yet.")}</li>}
					{configured.map((provider) => (
						<li key={provider.providerId}>
							<span>{provider.name}</span>
							<span className="muted">
								{t(provider.keyStored ? "Key stored" : "Key from models.json")}
								{provider.source === "config" && " · models.json"}
							</span>
							{provider.keyStored && (
								<button
									type="button"
									onClick={() => void api["credentials.delete"]({ providerId: provider.providerId }).then(refreshSettings).catch(report)}
								>
									{t("Remove")}
								</button>
							)}
						</li>
					))}
				</ul>
			</div>
			<CredentialStorage />
			<BackupSettings />
			<WebSearchSettings />
			<div id="settings-permissions">
				<CommandSettings />
			</div>
			<FolderSettings workspace={settings.workspace} />

			<div className="settings-group">
				<h2>{t("Your own providers")}</h2>
				<p className="muted">
					{t("Add OpenAI- or Anthropic-compatible endpoints in ")}
					<code>{settings.modelConfig.path}</code>
					{t(". Changes apply when you open Settings or choose a model.")}
				</p>
				{settings.providers.some((provider) => provider.source === "config" && !provider.configured) && (
					<p className="muted">
						{t("Without a key:")}{" "}
						{settings.providers
							.filter((provider) => provider.source === "config" && !provider.configured)
							.map((provider) => provider.name)
							.join(", ")}
						{t(". Save one above or fix its ")}
						<code>apiKey</code>.
					</p>
				)}
				{settings.modelConfig.errors.length > 0 && (
					<ul className="config-errors" aria-label={t("Configuration problems")}>
						{settings.modelConfig.errors.map((error) => (
							<li key={error}>{error}</li>
						))}
					</ul>
				)}
				<button type="button" onClick={() => void refreshSettings().catch(report)}>
					{t("Reload")}
				</button>
			</div>

			<ManagementHistory />
			<div className="settings-group" id="settings-data">
				<h2>{t("Data")}</h2>
				<p className="muted">
					{t("Conversations, Bot memory and operation logs are stored on this Mac in ")}
					<code>{settings.dataDirectory}</code>
					{t(
						". No automatic analytics or log uploads. Your selected model and search providers receive task-relevant input when you use them.",
					)}
				</p>
			</div>
		</section>
	);
}

function OutcomeRow({
	item,
	retry,
}: {
	item: Extract<TranscriptItem, { kind: "outcome" }>;
	retry:
		| { botId: string; text: string; artifactIds?: readonly string[]; skills?: readonly import("@openbot/protocol").SkillRef[] }
		| undefined;
}) {
	const labels = {
		failed: "This input could not be completed.",
		cancelled: "Work was cancelled.",
		withdrawn: "Not processed",
		empty: "No final text was returned for this input.",
		stopping: "Stopping work",
		interrupted: "Review completed actions before continuing. An interrupted action may have partly run.",
		queued_cancelled: "Cancelled before starting",
	};
	return (
		<li className="message message-outcome" data-message-id={item.id}>
			<p>{t(labels[item.category])}</p>
			{retry && <RetryButton {...retry} />}
			{item.category === "failed" && !retry && <p>{t("Retry is unavailable for this outcome.")}</p>}
			{item.category === "interrupted" && <p>{t("Recovery is unavailable for this historical task.")}</p>}
		</li>
	);
}
