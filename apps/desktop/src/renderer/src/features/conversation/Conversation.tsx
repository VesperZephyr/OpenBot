import { useEffect, useRef, useState } from "react";
import type { BotSummary } from "@openbot/protocol";
import { Avatar, AvatarStack, PersonalStar } from "../../Avatar";
import { ConfirmDeleteBot, ConfirmDeleteConversation, DeleteBotItem, DeleteConversationItem, DuplicateBotItem } from "../../BotLifecycle";
import { ExportTemplateItem, useTemplateState } from "../../BotTemplates";
import { ChatComposer } from "../../ChatComposer";
import { ConversationShell } from "../../ConversationUI";
import { InterfaceIcon } from "../../InterfaceIcon";
import { ActivityIndicator } from "../../LiveReply";
import { ProfileDetails } from "../details/ProfileDetails";
import { toggleDetails, useDetailsOpen } from "../details/details-open";
import { HistoryTranscript } from "../transcript/HistoryTranscript";
import { MarkReadItem } from "../../RosterPreview";
import { conversationPresence, headerStatusLabel } from "../../conversation-status";
import { botGreeting, conversationExamples } from "../../examples";
import { t } from "../../i18n";
import { StopButton } from "../../runs";
import { api, openSettings, refreshBots, report, sendMessage, useStore } from "../../store";
import { composers } from "../../useComposer";

export function Conversation({ botId, editing, onEditing }: { readonly botId: string; readonly editing: boolean; readonly onEditing: (botId: string | undefined) => void }) {
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

function BotMenu({ bot, onEdit, readCursor }: { readonly bot: BotSummary; readonly onEdit: () => void; readonly readCursor: number | undefined }) {
	const [open, setOpen] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [deletingChat, setDeletingChat] = useState(false);
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
					{bot.kind !== "core" && <DeleteConversationItem onChoose={() => (setOpen(false), setDeletingChat(true))} />}
					{bot.kind !== "core" && <DeleteBotItem onChoose={() => (setOpen(false), setDeleting(true))} />}
				</div>
			)}
			{deletingChat && <ConfirmDeleteConversation bot={bot} onClose={() => setDeletingChat(false)} />}
			{deleting && <ConfirmDeleteBot bot={bot} onClose={() => setDeleting(false)} />}
		</div>
	);
}
