import { LocalTasks } from "./LocalTasks";
import "./local-tasks.css";
import { BotTemplateDialog, beginTemplateImport } from "./BotTemplates";
import { RestoreNotice } from "./BackupSettings";
import { WorkspaceLayout } from "./WorkspaceLayout";
import { NewConversationDialog } from "./ui/new-conversation-dialog";
import { BotIdentity, GroupIdentity } from "./BotIdentity";
import { useDialogFocus } from "./ConversationUI";
import { t } from "./i18n";
import { presentError } from "../../shared/i18n";
import { useEffect, useState } from "react";
import { GroupView, GroupEditor } from "./Groups";
import { Onboarding } from "./features/onboarding/Onboarding";
import { toggleDetails, useDetailsOpen } from "./features/details/details-open";
import { SettingsWorkspace, type SettingsDestination } from "./features/settings/SettingsWorkspace";
import { Home } from "./features/home/Home";
import { NewBotDialog } from "./features/new-bot/NewBotDialog";
import { Conversation } from "./features/conversation/Conversation";
import { HistoryTranscript } from "./features/transcript/HistoryTranscript";
import { Sidebar, chatEntries } from "./features/sidebar/Sidebar";
import { closeSettings, closeSettingsFromEscape, connect, openBot, openSettings, report, useStore } from "./store";

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
