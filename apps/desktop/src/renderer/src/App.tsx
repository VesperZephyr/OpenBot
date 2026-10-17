import type {
	ApprovalDecision,
	BotSummary,
	ConversationSnapshot,
	ModelRef,
	ModelSummary,
	PendingApproval,
	RunRecord,
	ThinkingLevel,
	TranscriptItem,
} from "@openbot/protocol";
import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "./markdown";
import { WebSearchSettings } from "./WebSearchSettings";
import { ProfileMemory } from "./ProfileMemory";
import { Divider, RetryButton, retryTarget, Thinking } from "./TranscriptExtras";
import { PendingMessages, StopButton, StoppedNote } from "./runs";
import { AlwaysAllow } from "./AlwaysAllow";
import { CommandSettings, FolderSettings } from "./PolicySettings";
import { ConfirmDeleteBot, DeleteBotItem, DuplicateBotItem } from "./BotLifecycle";
import { ModelSetup } from "./ModelSetup";
import { Onboarding } from "./Onboarding";
import { transcriptRows } from "./steps";
import { MessageTime, RevealButton, StepsRow } from "./TranscriptDetails";
import {
	api,
	connect,
	createBot,
	openBot,
	refreshBots,
	refreshSettings,
	report,
	sendMessage,
	useStore,
} from "./store";

export function App() {
	const host = useStore((state) => state.host);
	const view = useStore((state) => state.view);
	const notice = useStore((state) => state.notice);
	const onboarding = useStore((state) => state.onboarding);
	const [creating, setCreating] = useState(false);

	useEffect(() => connect(), []);

	useEffect(() => {
		const onKey = (event: globalThis.KeyboardEvent): void => {
			if (!event.metaKey) return;
			if (event.key === "n") {
				event.preventDefault();
				setCreating(true);
			} else if (event.key === ",") {
				event.preventDefault();
				useStore.setState({ view: { kind: "settings" } });
			} else if (/^[1-9]$/.test(event.key)) {
				const bot = visibleBots(useStore.getState().bots)[Number(event.key) - 1];
				if (bot !== undefined) {
					event.preventDefault();
					void openBot(bot.botId).catch(report);
				}
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	return (
		<div className="app">
			<Sidebar onNew={() => setCreating(true)} />
			<main className="main">
				{host.status !== "ready" && (
					<div className={`banner banner-${host.status}`}>
						{host.status === "starting" ? "Starting OpenBot…" : `OpenBot stopped. ${host.detail ?? ""}`}
					</div>
				)}
				{onboarding === true ? (
					<Onboarding />
				) : (
					<>
						{view.kind === "bot" && <Conversation botId={view.botId} />}
						{view.kind === "settings" && <Settings />}
						{view.kind === "home" && <Home onNew={() => setCreating(true)} />}
					</>
				)}
			</main>
			{creating && <NewBotDialog onClose={() => setCreating(false)} />}
			{notice !== undefined && (
				<div className="toast" role="status">
					<span>{notice}</span>
					<button type="button" className="toast-close" onClick={() => useStore.setState({ notice: undefined })}>
						Dismiss
					</button>
				</div>
			)}
		</div>
	);
}

/** Sidebar order: pinned first, then by creation time; hidden Bots only in their own section. */
function visibleBots(bots: readonly BotSummary[]): BotSummary[] {
	return bots
		.filter((bot) => bot.status === "active")
		.toSorted((a, b) => Number(b.kind === "core") - Number(a.kind === "core") || Number(b.pinned) - Number(a.pinned) || a.createdAt - b.createdAt);
}

function Sidebar({ onNew }: { onNew: () => void }) {
	const bots = useStore((state) => state.bots);
	const view = useStore((state) => state.view);
	const showHidden = useStore((state) => state.showHidden);
	const visible = visibleBots(bots);
	const core = visible.filter((bot) => bot.kind === "core");
	const pinned = visible.filter((bot) => bot.pinned && bot.kind !== "core");
	const others = visible.filter((bot) => !bot.pinned);
	const hidden = bots.filter((bot) => bot.status === "hidden");
	const selected = view.kind === "bot" ? view.botId : undefined;

	return (
		<nav className="sidebar" aria-label="Bots">
			<div className="sidebar-titlebar" />
			<button type="button" className="new-button" onClick={onNew}>
				<span aria-hidden>＋</span> New <kbd>⌘N</kbd>
			</button>
			<BotSection title="Your assistant" bots={core} selected={selected} />
			{pinned.length > 0 && <BotSection title="Pinned" bots={pinned} selected={selected} />}
			<BotSection title="Bots" bots={others} selected={selected} empty="Create a Bot for a specific job" />
			{hidden.length > 0 && (
				<div className="section">
					<button
						type="button"
						className="section-toggle"
						aria-expanded={showHidden}
						onClick={() => useStore.setState({ showHidden: !showHidden })}
					>
						Hidden Bots · {hidden.length}
					</button>
					{showHidden && hidden.map((bot) => <BotRow key={bot.botId} bot={bot} selected={bot.botId === selected} />)}
				</div>
			)}
			<div className="sidebar-footer">
				<button
					type="button"
					className={`nav-item ${view.kind === "settings" ? "is-selected" : ""}`}
					onClick={() => useStore.setState({ view: { kind: "settings" } })}
				>
					Settings <kbd>⌘,</kbd>
				</button>
			</div>
		</nav>
	);
}

function BotSection(props: {
	readonly title: string;
	readonly bots: readonly BotSummary[];
	readonly selected: string | undefined;
	readonly empty?: string;
}) {
	return (
		<div className="section">
			<div className="section-title">{props.title}</div>
			{props.bots.length === 0 && props.empty !== undefined && <div className="section-empty">{props.empty}</div>}
			{props.bots.map((bot) => (
				<BotRow key={bot.botId} bot={bot} selected={bot.botId === props.selected} />
			))}
		</div>
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
	const label = ACTIVITY_LABEL[bot.activity];
	return (
		<button
			type="button"
			className={`bot-row ${selected ? "is-selected" : ""}`}
			onClick={() => void openBot(bot.botId).catch(report)}
			aria-current={selected ? "page" : undefined}
		>
			<Avatar name={bot.name} />
			<span className="bot-row-text">
				<span className="bot-row-name">{bot.name}{bot.kind === "core" && <span className="core-badge">Core</span>}</span>
				<span className="bot-row-role">{label ?? bot.role}</span>
			</span>
			{label !== undefined && <span className={`activity activity-${bot.activity}`} aria-label={label} />}
		</button>
	);
}

/** Stable hue per name so a Bot keeps its color across sessions. */
function Avatar({ name, size = 28 }: { readonly name: string; readonly size?: number }) {
	let hash = 0;
	for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
	const initials = name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((word) => word[0]?.toUpperCase())
		.join("");
	return (
		<span className="avatar" style={{ width: size, height: size, background: `hsl(${hash % 360} 45% 38%)` }} aria-hidden>
			{initials || "?"}
		</span>
	);
}

function Home({ onNew }: { onNew: () => void }) {
	const bots = useStore((state) => state.bots);
	return (
		<div className="home">
			<h1>Meet your teammates</h1>
			<p>
				A Bot is a long-lived teammate with one job. Give it a name and a role, then message it like a colleague. Every Bot
				works on this Mac.
			</p>
			<button type="button" className="primary" onClick={onNew}>
				{bots.length === 0 ? "Create your first Bot" : "Create a Bot"}
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
				<h2>New chat</h2>
				<label className="field">
					<span>Bot name</span>
					<input
						autoFocus
						value={name}
						placeholder="Piper"
						onChange={(event) => setName(event.target.value)}
						onKeyDown={(event) => event.key === "Escape" && onClose()}
					/>
				</label>
				<div className="dialog-actions">
					<button type="button" onClick={onClose}>
						Cancel
					</button>
					<button type="submit" className="primary" disabled={name.trim() === "" || busy}>
						{name.trim() === "" ? "Create new Bot" : `Create “${name.trim()}” Bot`}
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
	const transcriptEnd = useRef<HTMLDivElement>(null);

	useEffect(() => {
		transcriptEnd.current?.scrollIntoView({ block: "end" });
	}, [snapshot]);

	if (bot === undefined) return null;
	const running = snapshot?.live !== undefined || snapshot?.run !== undefined || (snapshot?.pending?.length ?? 0) > 0;

	return (
		<section className="conversation" aria-label={`Conversation with ${bot.name}`}>
			<header className="conversation-header">
				<Avatar name={bot.name} size={32} />
				<div className="conversation-title">
					<div className="conversation-name">{bot.name}</div>
					<div className="conversation-role">{bot.role || "No label"}</div>
				</div>
				<BotMenu bot={bot} onEdit={() => setEditing(true)} />
			</header>
			{editing && <EditProfile bot={bot} onClose={() => setEditing(false)} />}
			<div className="transcript">
				{snapshot === undefined || (snapshot.items.length === 0 && !running) ? (
					<EmptyConversation bot={bot} />
				) : (
					<Transcript snapshot={snapshot} />
				)}
				<div ref={transcriptEnd} />
			</div>
			<Composer bot={bot} run={snapshot?.run} />
		</section>
	);
}

function EmptyConversation({ bot }: { readonly bot: BotSummary }) {
	return (
		<div className="empty-conversation">
			<Avatar name={bot.name} size={56} />
			<h2>{bot.name}</h2>
			<p>
				Lead with the result you need, the sources that matter, what {bot.name} must not do without asking, and what
				finished work looks like.
			</p>
		</div>
	);
}

function Transcript({ snapshot }: { readonly snapshot: ConversationSnapshot }) {
	const approvals = new Map(snapshot.approvals.map((approval) => [approval.callId, approval]));
	const retry = retryTarget(snapshot.items, snapshot.live !== undefined);
	const item = (entry: TranscriptItem) =>
		entry.kind === "tool" ? (
			<ToolCard key={entry.id} item={entry} approval={approvals.get(entry.id)} />
		) : entry.kind === "divider" ? (
			<Divider key={entry.id} item={entry} />
		) : (
			<Message key={entry.id} item={entry} retry={retry?.id === entry.id ? { botId: snapshot.botId, text: retry.text } : undefined} />
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
			<PendingMessages snapshot={snapshot} />
			{snapshot.live !== undefined && snapshot.live.state !== "waiting_approval" && (
				<li className="message message-assistant is-live">
					{snapshot.live.partial === undefined ? (
						<span className="thinking">Working</span>
					) : (
						<MessageText parts={snapshot.live.partial} markdown />
					)}
					{snapshot.live.retry !== undefined && (
						<div className="message-error">Retrying after an error: {snapshot.live.retry.error}</div>
					)}
				</li>
			)}
		</ol>
	);
}

function Message(props: {
	readonly item: Exclude<TranscriptItem, { kind: "tool" | "divider" }>;
	readonly retry: { readonly botId: string; readonly text: string } | undefined;
}) {
	const { item, retry } = props;
	if (item.kind === "other") return null;
	if (item.kind === "stopped") return <StoppedNote />;
	return (
		<li className={`message message-${item.kind}`}>
			<MessageTime at={item.at} />
			{item.kind === "assistant" && item.thinking !== undefined && <Thinking text={item.thinking} />}
			<MessageText parts={item.parts} markdown={item.kind === "assistant"} />
			{item.kind === "assistant" && item.error !== undefined && (
				<div className="message-error">
					{item.error}
					{retry !== undefined && <RetryButton botId={retry.botId} text={retry.text} />}
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

const TOOL_VERBS: Record<string, readonly [running: string, done: string]> = {
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
function ToolCard({ item, approval }: { readonly item: Extract<TranscriptItem, { kind: "tool" }>; readonly approval: PendingApproval | undefined }) {
	const args = (item.args ?? {}) as Record<string, unknown>;
	const [running, done] = TOOL_VERBS[item.tool] ?? [item.tool, item.tool];
	const subject = String(args.description ?? args.path ?? args.url ?? args.command ?? args.query ?? args.section ?? args.taskId ?? "");
	const waiting = approval !== undefined;
	const label = waiting
		? "Waiting for approval"
		: item.status === "running" || item.status === "pending"
			? running
			: item.status === "failed"
				? `${done} · failed`
				: item.status === "interrupted"
					? "Interrupted"
					: item.status === "cancelled"
						? `${running} · stopped`
						: done;
	const open = waiting || item.status === "failed" || item.status === "interrupted";
	return (
		<li className={`tool-card tool-${waiting ? "waiting" : item.status}`}>
			<details open={open}>
				<summary>
					<span className="tool-status" aria-hidden />
					<span className="tool-verb">{label}</span>
					<span className="tool-subject">{subject}</span>
					{item.tool === "local_exec" && item.taskId !== undefined && <span className="tool-task">background · {item.taskId}</span>}
					<RevealButton item={item} />
				</summary>
				{item.tool === "local_exec" && typeof args.command === "string" && <pre className="tool-command">$ {args.command}</pre>}
				{item.output !== undefined && item.output !== "" && <pre className="tool-output">{item.output}</pre>}
			</details>
			{approval !== undefined && <ApprovalCard approval={approval} />}
		</li>
	);
}

function ApprovalCard({ approval }: { readonly approval: PendingApproval }) {
	const decide = (decision: ApprovalDecision): void =>
		void api["approvals.decide"]({ approvalId: approval.approvalId, decision }).catch(report);
	const args = (approval.args ?? {}) as Record<string, unknown>;
	return (
		<div className="approval" role="group" aria-label="Approval request">
			<div className="approval-reason">{approval.reason}</div>
			<pre className="approval-args">
				{approval.tool === "local_exec"
					? `${String(args.command ?? "")}${args.cwd === undefined ? "" : `\n# in ${String(args.cwd)}`}`
					: JSON.stringify(approval.args, null, 2)}
			</pre>
			<div className="approval-actions">
				<button type="button" onClick={() => decide("deny")}>
					Deny
				</button>
				<button type="button" className="primary" onClick={() => decide("allow_once")} autoFocus>
					Allow once
				</button>
			</div>
			<AlwaysAllow approval={approval} />
		</div>
	);
}

function BotMenu({ bot, onEdit }: { readonly bot: BotSummary; readonly onEdit: () => void }) {
	const [open, setOpen] = useState(false);
	const [deleting, setDeleting] = useState(false);
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
		<div className="menu">
			<button type="button" className="icon-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
				•••
			</button>
			{open && (
				<div className="menu-popover" role="menu" onMouseLeave={() => setOpen(false)}>
					<button type="button" role="menuitem" onClick={() => (setOpen(false), onEdit())}>
						Edit profile
					</button>
					{bot.kind !== "core" && <>
					<button type="button" role="menuitem" onClick={() => void update({ pinned: !bot.pinned })}>
						{bot.pinned ? "Unpin" : "Pin"}
					</button>
					<button
						type="button"
						role="menuitem"
						onClick={() => void update({ status: bot.status === "hidden" ? "active" : "hidden" })}
					>
						{bot.status === "hidden" ? "Show in sidebar" : "Hide from sidebar"}
					</button>
					</>}
					<button type="button" role="menuitem" onClick={() => void newTopic()}>
						New topic
					</button>
					<DuplicateBotItem bot={bot} onDone={() => setOpen(false)} />
					{bot.kind !== "core" && <DeleteBotItem onChoose={() => (setOpen(false), setDeleting(true))} />}
				</div>
			)}
			{deleting && <ConfirmDeleteBot bot={bot} onClose={() => setDeleting(false)} />}
		</div>
	);
}

function EditProfile({ bot, onClose }: { readonly bot: BotSummary; readonly onClose: () => void }) {
	const [tab, setTab] = useState<"profile" | "memory">("profile");
	return (
		<div className="profile">
			<div className="profile-tabs" role="tablist">
				<button type="button" role="tab" aria-selected={tab === "profile"} onClick={() => setTab("profile")}>
					Profile
				</button>
				<button type="button" role="tab" aria-selected={tab === "memory"} onClick={() => setTab("memory")}>
					Memory
				</button>
			</div>
			{tab === "profile" ? <ProfileForm bot={bot} onClose={onClose} /> : <ProfileMemory botId={bot.botId} onClose={onClose} />}
		</div>
	);
}

const THINKING_LABEL: Record<ThinkingLevel, string> = { off: "Off", low: "Low", medium: "Medium", high: "High" };

function ProfileForm({ bot, onClose }: { readonly bot: BotSummary; readonly onClose: () => void }) {
	const [name, setName] = useState(bot.name);
	const [role, setRole] = useState(bot.role);
	const [instructions, setInstructions] = useState(bot.instructions);
	const [model, setModel] = useState<ModelRef | undefined>(bot.model);
	const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(bot.thinkingLevel ?? "off");
	const models = useStore((state) => state.models);
	const defaultModel = useStore((state) => state.settings?.defaultModel);
	const effective = model ?? defaultModel;
	const reasoning = models.some(
		(candidate) => candidate.reasoning && candidate.provider === effective?.provider && candidate.modelId === effective.modelId,
	);
	const save = async (event: FormEvent): Promise<void> => {
		event.preventDefault();
		try {
			await api["bots.update"]({
				botId: bot.botId,
				name: name.trim() || bot.name,
				role,
				instructions,
				model: model ?? null,
				...(reasoning ? { thinkingLevel } : {}),
			});
			await refreshBots();
			onClose();
		} catch (error) {
			report(error);
		}
	};
	return (
		<form className="profile-form" onSubmit={save}>
			<div className="profile-grid">
				<label className="field">
					<span>Name</span>
					<input value={name} onChange={(event) => setName(event.target.value)} />
				</label>
				<label className="field">
					<span>Label</span>
					<input value={role} placeholder="Research" onChange={(event) => setRole(event.target.value)} />
				</label>
			</div>
			<label className="field">
				<span>Description</span>
				<textarea
					rows={4}
					value={instructions}
					placeholder="Own the weekly account review. Never send external messages without approval."
					onChange={(event) => setInstructions(event.target.value)}
				/>
			</label>
			<div className="profile-grid">
				<label className="field">
					<span>Model</span>
					<ModelSelect value={model} onChange={setModel} emptyLabel="Use the default model" />
				</label>
				{reasoning && (
					<label className="field">
						<span>Thinking</span>
						<select value={thinkingLevel} onChange={(event) => setThinkingLevel(event.target.value as ThinkingLevel)}>
							{(Object.keys(THINKING_LABEL) as ThinkingLevel[]).map((level) => (
								<option key={level} value={level}>
									{THINKING_LABEL[level]}
								</option>
							))}
						</select>
					</label>
				)}
			</div>
			<div className="dialog-actions">
				<button type="button" onClick={onClose}>
					Cancel
				</button>
				<button type="submit" className="primary">
					Save profile
				</button>
			</div>
		</form>
	);
}

function Composer({ bot, run }: { readonly bot: BotSummary; readonly run: RunRecord | undefined }) {
	const [text, setText] = useState("");
	const input = useRef<HTMLTextAreaElement>(null);

	useEffect(() => input.current?.focus(), [bot.botId]);

	const send = async (): Promise<void> => {
		const message = text.trim();
		if (message === "") return;
		setText("");
		try {
			await sendMessage(bot.botId, message);
		} catch (error) {
			setText(message);
			report(error);
		}
	};
	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
		if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
			event.preventDefault();
			void send();
		}
	};
	return (
		<div className="composer">
			<textarea
				ref={input}
				rows={1}
				value={text}
				placeholder={`Message ${bot.name}`}
				onChange={(event) => setText(event.target.value)}
				onKeyDown={onKeyDown}
				aria-label={`Message ${bot.name}`}
			/>
			<div className="composer-actions">
				<span className="composer-hint">Enter to send · Shift+Enter for a new line</span>
				<StopButton run={run} />
				<button type="button" className="primary send" disabled={text.trim() === ""} onClick={() => void send()}>
					Send
				</button>
			</div>
		</div>
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
			<option value="">{props.emptyLabel}</option>
			{/* Keep a stored model selectable even when its provider key was removed. */}
			{props.value !== undefined && !groups.some(([, list]) => list.some((m) => `${m.provider}/${m.modelId}` === selected)) && <option value={selected}>{selected} · Unavailable</option>}
			{groups.map(([provider, list]) => (
				<optgroup key={provider} label={`${provider} · ${list[0]?.source === "custom" ? "Custom" : "Built-in"}${list[0]?.overridden ? " · Local override" : ""}`}>
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
	const settings = useStore((state) => state.settings);
	const [providerId, setProviderId] = useState("openai");
	const [apiKey, setApiKey] = useState("");

	if (settings === undefined) return null;
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
		<section className="settings" aria-label="Settings">
			<h1>Settings</h1>

			<div className="settings-group">
				<h2>Default model</h2>
				<p className="muted">Bots without a model of their own use this one.</p>
				<ModelSelect
					value={settings.defaultModel}
					emptyLabel={configured.length === 0 ? "Add an API key below first" : "Choose a model"}
					onChange={(model) =>
						void api["settings.update"]({ defaultModel: model ?? null }).then(refreshSettings).catch(report)
					}
				/>
			</div>

			<div className="settings-group"><h2>Connect a model</h2><ModelSetup /></div>

			<div className="settings-group">
				<h2>Provider credentials</h2>
				<p className="muted">Keys are stored in the macOS Keychain and never shown again.</p>
				<form className="key-form" onSubmit={saveKey}>
					<select value={providerId} onChange={(event) => setProviderId(event.target.value)} aria-label="Provider">
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
						placeholder="API key"
						onChange={(event) => setApiKey(event.target.value)}
						aria-label="API key"
					/>
					<button type="submit" className="primary" disabled={apiKey.trim() === ""}>
						Save key
					</button>
				</form>
				<ul className="provider-list">
					{configured.length === 0 && <li className="muted">No provider keys yet.</li>}
					{configured.map((provider) => (
						<li key={provider.providerId}>
							<span>{provider.name}</span>
							<span className="muted">
								{provider.keyStored ? "Key stored" : "Key from models.json"}
								{provider.source === "config" && " · models.json"}
							</span>
							{provider.keyStored && (
								<button
									type="button"
									onClick={() =>
										void api["credentials.delete"]({ providerId: provider.providerId })
											.then(refreshSettings)
											.catch(report)
									}
								>
									Remove
								</button>
							)}
						</li>
					))}
				</ul>
			</div>
			<WebSearchSettings />
			<CommandSettings />
			<FolderSettings workspace={settings.workspace} />

			<div className="settings-group">
				<h2>Your own providers</h2>
				<p className="muted">
					Add OpenAI- or Anthropic-compatible endpoints in <code>{settings.modelConfig.path}</code>. Changes apply
					when you open Settings or choose a model.
				</p>
				{settings.providers.some((provider) => provider.source === "config" && !provider.configured) && (
					<p className="muted">
						Without a key:{" "}
						{settings.providers
							.filter((provider) => provider.source === "config" && !provider.configured)
							.map((provider) => provider.name)
							.join(", ")}
						. Save one above or fix its <code>apiKey</code>.
					</p>
				)}
				{settings.modelConfig.errors.length > 0 && (
					<ul className="config-errors" aria-label="Configuration problems">
						{settings.modelConfig.errors.map((error) => (
							<li key={error}>{error}</li>
						))}
					</ul>
				)}
				<button type="button" onClick={() => void refreshSettings().catch(report)}>
					Reload
				</button>
			</div>

			<div className="settings-group">
				<h2>Data</h2>
				<p className="muted">
					Conversations, Bot memory and operation logs are stored on this Mac in <code>{settings.dataDirectory}</code>. No automatic analytics or log uploads. Your selected model and search providers receive task-relevant input when you use them.
				</p>
			</div>
		</section>
	);
}
