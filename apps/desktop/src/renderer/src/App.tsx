import { LocalTasks } from "./LocalTasks";
import "./local-tasks.css";
import { BotTemplateDialog, ExportTemplateItem, beginTemplateImport, useTemplateState } from "./BotTemplates";
import { HistoryTimeline } from "./HistoryTimeline";
import { RestoreNotice } from "./BackupSettings";
import { WorkspaceLayout } from "./WorkspaceLayout";
import { openFiles } from "./reader-store";
import { NewConversationDialog } from "./ui/new-conversation-dialog";
import { InterfaceIcon } from "./InterfaceIcon";
import { Avatar, AvatarStack, PersonalStar } from "./Avatar";
import { BotIdentity, GroupIdentity } from "./BotIdentity";
import { RoutineProposalCard } from "./BotResources";
import { BackgroundTask } from "./BackgroundTask";
import { ArtifactCard } from "./ArtifactCard";
import {LifecycleControls,InterruptedRun} from "./Lifecycle";
import { appManagementCapability, legacyManagementName, type AppExecution } from "@openbot/protocol";
import { ConversationSearch } from "./ConversationSearch";
import { ChatComposer } from "./ChatComposer";
import { ConversationShell, useDialogFocus } from "./ConversationUI";
import { MarkReadItem, RosterPreview, recentTime } from "./RosterPreview";
import { t } from "./i18n";
import { presentError } from "../../shared/i18n";
import type {
	BotSummary,
	PendingApproval,
	ConversationSnapshot,
	TranscriptItem,
} from "@openbot/protocol";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { LiveReply, ActivityIndicator } from "./LiveReply";
import { Markdown } from "./markdown";
import { Divider, RetryButton, retryTarget, Thinking } from "./TranscriptExtras";
import { PendingMessages, StopButton, StoppedNote } from "./runs";
import { ApprovalCard, TranscriptApprovals } from "./ApprovalCard";
import { GroupView, GroupRow, GroupEditor } from "./Groups";
import { ConfirmDeleteBot, DeleteBotItem, DuplicateBotItem } from "./BotLifecycle";
import { Onboarding } from "./features/onboarding/Onboarding";
import { ProfileDetails } from "./features/details/ProfileDetails";
import { toggleDetails, useDetailsOpen } from "./features/details/details-open";
import { SettingsWorkspace, type SettingsDestination } from "./features/settings/SettingsWorkspace";
import { transcriptRows } from "./steps";
import { MessageTime, RevealButton, StepsRow } from "./TranscriptDetails";
import { conversationPresence, headerStatusLabel } from "./conversation-status";
import { displayToolOutput } from "./tool-output";
import { botGreeting, conversationExamples } from "./examples";
import { composers } from "./useComposer";
import { api, closeSettings, closeSettingsFromEscape, connect, createBot, openBot, openSettings, refreshBots, report, sendMessage, useStore } from "./store";

export function App() {
	useDialogFocus();
	const language = useStore((state) => state.settings?.language ?? "en");
	useEffect(() => {
		document.documentElement.lang = language;
	}, [language]);
	const host = useStore((state) => state.host);
	const view = useStore((state) => state.view);
	const selectSettings = (kind: SettingsDestination): void => {
		openSettings(kind);
	};
	const notice = useStore((state) => state.notice);
	const onboarding = useStore((state) => state.onboarding);
	const wide = useWideLayout();
	const detailsOpen = useDetailsOpen();
	const [editorBotId, setEditorBotId] = useState<string>();
	const [creating, setCreating] = useState(false);
	const [newMenu, setNewMenu] = useState(false);
	const [creatingGroup, setCreatingGroup] = useState(false);
	const [query, setQuery] = useState("");
	const [searchOpen, setSearchOpen] = useState(false);
	useEffect(() => { if (searchOpen) document.querySelector<HTMLInputElement>(".conversation-search")?.focus(); }, [searchOpen]);
	useEffect(() => {
		const onKey = (event: KeyboardEvent): void => {
			closeSettingsFromEscape(event);
		};
		document.addEventListener("keydown", onKey, true);
		return () => document.removeEventListener("keydown", onKey, true);
	}, []);

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
				openSettings();
			} else if (event.shiftKey && event.key.toLowerCase() === "i") {
				event.preventDefault();
				if (useStore.getState().view.kind === "bot") toggleDetails();
			} else if (/^[1-9]$/.test(event.key)) {
                const entry = chatEntries(useStore.getState())[Number(event.key) - 1];
                if (entry) {
                    event.preventDefault();
                    if (entry.kind === "bot") void openBot(entry.bot.botId).catch(report);
                    else {
						closeSettings();
						useStore.setState({ view: { kind: "group", groupId: entry.group.groupId }, searchTarget: undefined });
					}
                }
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	return (
		<div className="app">
            <WorkspaceLayout
				sidebar={<Sidebar searchOpen={searchOpen} onSearchOpen={setSearchOpen} query={query} onQuery={setQuery} onNew={() => setNewMenu(true)} onSettings={() => openSettings()} />}
				inspector={onboarding === true ? undefined : wide && view.kind === "bot" && detailsOpen ? <BotIdentity key={view.botId} botId={view.botId} profileOpen={editorBotId === view.botId} /> : wide && view.kind === "group" ? <GroupIdentity key={view.groupId} groupId={view.groupId} /> : undefined}
			>
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
						{view.kind === "tasks" && <LocalTasks key={view.taskId??view.draftId??`list:${view.archived}:${view.cursor}`} view={view} renderHistory={(snapshot,taskId)=><HistoryTranscript snapshot={snapshot} taskId={taskId}/>}/>}
                        {view.kind === "bot" && <Conversation key={view.botId} botId={view.botId} editing={editorBotId === view.botId} onEditing={setEditorBotId} />}
						{(view.kind === "settings" || view.kind === "skills" || view.kind === "connectors" || view.kind === "routines") && (
							<SettingsWorkspace
								view={view}
								onBack={() => closeSettings()}
								onSelect={selectSettings}
								renderTranscript={(snapshot, occurrenceId) => <HistoryTranscript snapshot={snapshot} occurrenceId={occurrenceId} />}
							/>
						)}
						{view.kind === "group" && <GroupView key={view.groupId} groupId={view.groupId} renderExecution={(botId,deliveryId)=><HistoryTranscript snapshot={{botId,channelId:view.groupId,items:[],approvals:[]}} conversationKey={`group:${view.groupId}`} deliveryId={deliveryId}/>}/>}
						{view.kind === "home" && <Home onNew={() => setCreating(true)} />}
					</>
				)}
			</main>
            </WorkspaceLayout>
			<BotTemplateDialog />
			<NewConversationDialog
				open={newMenu}
				title={t("New conversation")}
				closeLabel={t("Close")}
				createBot={t("Create new Bot")}
				createBotDetail={t("A teammate with a specific job")}
				createGroup={t("Create group")}
				createGroupDetail={t("Bring your Bots together for a task")}
				importTemplate={t("Import template")}
				onClose={() => setNewMenu(false)}
				onCreateBot={() => {
					setNewMenu(false);
					setQuery("");
					setCreating(true);
				}}
				onCreateGroup={() => {
					setNewMenu(false);
					setQuery("");
					setCreatingGroup(true);
				}}
				onImport={() => {
					setNewMenu(false);
					beginTemplateImport();
				}}
			/>
			{creatingGroup && <GroupEditor onClose={() => setCreatingGroup(false)} />}
			{creating && <NewBotDialog onClose={() => setCreating(false)} />}
			{notice !== undefined && (
				<div className="toast" role="status">
					<span>{t(presentError(notice))}</span>
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

function Sidebar({ onNew, query, onQuery, searchOpen, onSearchOpen, onSettings }: { onNew: () => void; query: string; onQuery: (v: string) => void; searchOpen: boolean; onSearchOpen: (open: boolean) => void; onSettings: () => void }) {
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

function BotRow({ bot, selected }: { readonly bot: BotSummary; readonly selected: boolean }) {
	const label = bot.activity === "unread" ? undefined : ACTIVITY_LABEL[bot.activity];
	return (
		<button
			type="button"
			className={`bot-row ${selected ? "is-selected" : ""}`}
			onClick={() => void openBot(bot.botId).catch(report)}
			aria-current={selected ? "page" : undefined}
		>
			<Avatar bot={bot} working={bot.activity === "working"} />
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

function focusNewButton(): void {
	requestAnimationFrame(() => document.querySelector<HTMLElement>(".new-button")?.focus());
}

function NewBotDialog({ onClose }: { onClose: () => void }) {
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const nameInput = useRef<HTMLInputElement>(null);
	useEffect(() => {
		nameInput.current?.focus();
	}, []);
	const cancel = (): void => {
		onClose();
		focusNewButton();
	};
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
		<div className="dialog-backdrop" onMouseDown={cancel}>
			<form className="dialog" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
				<h2>{t("Create a Bot")}</h2>
				<label className="field">
					<span>{t("Bot name")}</span>
					<input
						ref={nameInput}
						autoFocus
						value={name}
						placeholder="Piper"
						onChange={(event) => setName(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Escape") cancel();
						}}
					/>
				</label>
				<div className="dialog-actions">
					<button type="button" data-dialog-close onClick={cancel}>
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

function Conversation({ botId, editing, onEditing }: { readonly botId: string; readonly editing: boolean; readonly onEditing: (botId: string | undefined) => void }) {
	const detailsOpen = useDetailsOpen();
	const nameButton = useRef<HTMLButtonElement>(null);
	const detailsWereOpen = useRef(detailsOpen);
	const bot = useStore((state) => state.bots.find((candidate) => candidate.botId === botId));
	const snapshot = useStore((state) => state.conversations[botId]);
	const setEditing = (open: boolean): void => onEditing(open ? botId : undefined);
	const importedProfile = useTemplateState(s => s.profileBotId === botId);
	useEffect(() => {
		if (importedProfile) {
			onEditing(botId);
			useTemplateState.setState({ profileBotId: null });
		}
	}, [importedProfile, botId, onEditing]);
	useEffect(() => () => onEditing(undefined), [onEditing]);
	useEffect(() => {
		if (detailsWereOpen.current && !detailsOpen) nameButton.current?.focus();
		detailsWereOpen.current = detailsOpen;
	}, [detailsOpen]);
 const count=useStore(state=>state.summaries[`bot:${botId}`]?.latest!==undefined);

	if (bot === undefined) return null;
	const running = snapshot?.live !== undefined || snapshot?.run !== undefined || (snapshot?.pending?.length ?? 0) > 0;
	const presence = conversationPresence({
		approvals: snapshot?.approvals.length ?? 0,
		live: snapshot?.live !== undefined,
		pending: snapshot?.pending?.length ?? 0,
		runState: snapshot?.run?.state,
	});

	return (
		<ConversationShell
			className={`conversation ${snapshot === undefined || (!count && !running) ? "is-empty" : ""}`}
			label={t("Conversation with {name}", { name: bot.name })}
			details={editing && <ProfileDetails bot={bot} onClose={() => setEditing(false)} />}
		>
			<header className="conversation-header">
				<Avatar bot={bot} size={29} working={presence !== "idle"} />
				<div className="conversation-title">
					<div className="conversation-name">
						<button ref={nameButton} type="button" className="conversation-name-button" aria-expanded={detailsOpen} aria-label={t("View details")} onClick={() => toggleDetails()}>
							<span title={bot.name}>{bot.name}</span>
							<InterfaceIcon name="chevronDown" />
						</button>
						{bot.kind === "core" && <PersonalStar />}
					</div>
					<p className="conversation-meta">
						{bot.role ? (
							<>
								<span className="conversation-role">{bot.role}</span>
								<span className="conversation-meta-sep" aria-hidden="true">·</span>
							</>
						) : null}
						{presence !== "idle" && <span className="status-dot" aria-hidden="true" />}
						<span className="conversation-status" role="status">{t(headerStatusLabel(presence))}</span>
					</p>
				</div>
				<button className="details-toggle" aria-label={t("Conversation details")} onClick={() => setEditing(!editing)}>
					<InterfaceIcon name="info" /><span>{t("Details")}</span>
				</button>
				<BotMenu bot={bot} readCursor={snapshot?.readCursor} onEdit={() => setEditing(true)} />
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
	const skills = useStore((state) => state.skills);
	const greeting = botGreeting(bot.instructions);
	const examples = conversationExamples(
		bot.instructions,
		(bot.defaultSkills ?? []).flatMap((ref) => {
			const skill = skills?.find((item) => item.name === ref.name && item.available && !item.deleted);
			return skill ? [{ description: skill.description }] : [];
		}),
	);
	const sendExample = (text: string): void => {
		const key = `bot:${bot.botId}` as const;
		composers.edit(key, { text });
		void composers
			.send(key, (attempt) =>
				sendMessage(
					bot.botId,
					attempt.text,
					attempt.requestId,
					attempt.attachments?.map((ref) => ref.artifactId),
					attempt.skills,
				).catch((error) => {
					report(error);
					throw error;
				}),
			)
			.then((sent) => {
				if (sent) window.dispatchEvent(new CustomEvent("openbot:sent", { detail: key }));
			});
	};
	return (
		<div className="empty-conversation">
			<AvatarStack bots={[bot]} size={84} />
			<h2>{bot.name}</h2>
			{greeting ? <p className="empty-greeting">{greeting}</p> : null}
			{examples.length > 0 && (
				<div className="example-list">
					{examples.map((example) => (
						<button key={example} type="button" disabled={!hasModel} onClick={() => sendExample(example)}>
							{example}
						</button>
					))}
				</div>
			)}
			{!hasModel && (
				<button type="button" onClick={() => openSettings()}>
					{t("Connect a model")}
				</button>
			)}
		</div>
	);
}

function useWideLayout(): boolean {
	const [wide, setWide] = useState(() => window.matchMedia("(min-width: 1180px)").matches);
	useEffect(() => {
		const query = window.matchMedia("(min-width: 1180px)");
		const apply = (): void => setWide(query.matches);
		apply();
		query.addEventListener("change", apply);
		return () => query.removeEventListener("change", apply);
	}, []);
	return wide;
}

function HistoryTranscript({
	snapshot,
 taskId,
	occurrenceId,
	deliveryId,
	conversationKey,
	empty,
}: {
	snapshot: ConversationSnapshot;
 taskId?:string;
	occurrenceId?: string;
	deliveryId?: string;
	conversationKey?: import("@openbot/protocol").ConversationKey;
	empty?: React.ReactNode;
}) {
	return (
		<HistoryTimeline
			conversationKey={conversationKey ?? `bot:${snapshot.botId}`}
			{...(taskId ? {taskId} : {})}
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
			{({ rows }) => {
				const run = snapshot.run;
				const missingInterruption = snapshot.messageMode && !snapshot.channelId && run?.state === "needs_attention" &&
					!rows.some(row => row.content.kind === "direct" && row.content.item.kind === "outcome" &&
						row.content.item.runId === run.runId && row.content.item.category === "interrupted");
				const retry = snapshot.messageMode && !snapshot.channelId && !snapshot.live && snapshot.retry?.outcomeId &&
					!rows.some(row => row.id === snapshot.retry!.outcomeId) ? snapshot.retry : undefined;
				return <>
					<Transcript snapshot={{ ...snapshot, items: missingInterruption
						? [{ kind: "outcome", id: `run-outcome:${run.runId}`, runId: run.runId, category: "interrupted" }]
						: [] }} />
					{retry && <ol className="messages"><OutcomeRow item={{ id: retry.outcomeId!, category: "failed" }} retry={{ botId: snapshot.botId, ...retry }} /></ol>}
				</>;
			}}
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
			<TranscriptApprovals snapshot={snapshot} historyOnly={historyOnly} />
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
	const output = displayToolOutput(item.tool, item.output, item.execution?.error, (text) => t(text));
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
	const failureLabel = item.failureReason
		? { approval_expired: "Approval expired", permission_revoked: "Permission revoked", approval_denied: "Denied" }[item.failureReason]
		: undefined;
	const label = failureLabel
		? t(failureLabel)
		: waiting
		? t(running)
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

function BotMenu({ bot, onEdit, readCursor }: { readonly bot: BotSummary; readonly onEdit: () => void; readonly readCursor: number | undefined }) {
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
					<MarkReadItem conversationKey={`bot:${bot.botId}`} cursor={readCursor} onDone={() => setOpen(false)} />
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


function OutcomeRow({
	item,
	retry,
}: {
	item: Pick<Extract<TranscriptItem, { kind: "outcome" }>, "id" | "category">;
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
