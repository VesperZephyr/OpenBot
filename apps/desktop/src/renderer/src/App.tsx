import type { BotSummary, ConversationSnapshot, ModelRef, ModelSummary, TranscriptItem } from "@openbot/protocol";
import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
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
				{view.kind === "bot" && <Conversation botId={view.botId} />}
				{view.kind === "settings" && <Settings />}
				{view.kind === "home" && <Home onNew={() => setCreating(true)} />}
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
		.toSorted((a, b) => Number(b.pinned) - Number(a.pinned) || a.createdAt - b.createdAt);
}

function Sidebar({ onNew }: { onNew: () => void }) {
	const bots = useStore((state) => state.bots);
	const view = useStore((state) => state.view);
	const showHidden = useStore((state) => state.showHidden);
	const visible = visibleBots(bots);
	const pinned = visible.filter((bot) => bot.pinned);
	const others = visible.filter((bot) => !bot.pinned);
	const hidden = bots.filter((bot) => bot.status === "hidden");
	const selected = view.kind === "bot" ? view.botId : undefined;

	return (
		<nav className="sidebar" aria-label="Bots">
			<div className="sidebar-titlebar" />
			<button type="button" className="new-button" onClick={onNew}>
				<span aria-hidden>＋</span> New <kbd>⌘N</kbd>
			</button>
			{pinned.length > 0 && <BotSection title="Pinned" bots={pinned} selected={selected} />}
			<BotSection title="Bots" bots={others} selected={selected} empty="No Bots yet" />
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
				<span className="bot-row-name">{bot.name}</span>
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
	const running = snapshot?.live !== undefined;

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
			<Composer bot={bot} running={running} />
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
	return (
		<ol className="messages">
			{snapshot.items.map((item) => (
				<Message key={item.id} item={item} />
			))}
			{snapshot.live !== undefined && (
				<li className="message message-assistant is-live">
					{snapshot.live.partial === undefined ? (
						<span className="thinking">Working</span>
					) : (
						<MessageText parts={snapshot.live.partial} />
					)}
					{snapshot.live.retry !== undefined && (
						<div className="message-error">Retrying after an error: {snapshot.live.retry.error}</div>
					)}
				</li>
			)}
		</ol>
	);
}

function Message({ item }: { readonly item: TranscriptItem }) {
	if (item.kind === "other") return null;
	return (
		<li className={`message message-${item.kind}`}>
			<MessageText parts={item.parts} />
			{item.kind === "assistant" && item.error !== undefined && <div className="message-error">{item.error}</div>}
		</li>
	);
}

function MessageText({ parts }: { readonly parts: readonly { readonly text: string }[] }) {
	return (
		<div className="message-text">
			{parts.map((part, index) => (
				// Parts have no identity of their own; their order is stable within one message.
				<p key={index}>{part.text}</p>
			))}
		</div>
	);
}

function BotMenu({ bot, onEdit }: { readonly bot: BotSummary; readonly onEdit: () => void }) {
	const [open, setOpen] = useState(false);
	const update = async (change: { pinned?: boolean; status?: BotSummary["status"] }): Promise<void> => {
		setOpen(false);
		try {
			await api["bots.update"]({ botId: bot.botId, ...change });
			await refreshBots();
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
				</div>
			)}
		</div>
	);
}

function EditProfile({ bot, onClose }: { readonly bot: BotSummary; readonly onClose: () => void }) {
	const [name, setName] = useState(bot.name);
	const [role, setRole] = useState(bot.role);
	const [instructions, setInstructions] = useState(bot.instructions);
	const [model, setModel] = useState<ModelRef | undefined>(bot.model);
	const save = async (event: FormEvent): Promise<void> => {
		event.preventDefault();
		try {
			await api["bots.update"]({ botId: bot.botId, name: name.trim() || bot.name, role, instructions, model: model ?? null });
			await refreshBots();
			onClose();
		} catch (error) {
			report(error);
		}
	};
	return (
		<form className="profile" onSubmit={save}>
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
			<label className="field">
				<span>Model</span>
				<ModelSelect value={model} onChange={setModel} emptyLabel="Use the default model" />
			</label>
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

function Composer({ bot, running }: { readonly bot: BotSummary; readonly running: boolean }) {
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
				{running && (
					<button
						type="button"
						className="stop"
						onClick={() => void api["runs.cancel"]({ botId: bot.botId }).catch(report)}
					>
						Stop
					</button>
				)}
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
			{props.value !== undefined && !configured.has(props.value.provider) && <option value={selected}>{selected}</option>}
			{groups.map(([provider, list]) => (
				<optgroup key={provider} label={provider}>
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

			<div className="settings-group">
				<h2>Model providers</h2>
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
								{provider.keyStored ? "Key stored" : "Key from config.json"}
								{provider.source === "config" && " · config.json"}
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
					Conversations are stored on this Mac in <code>{settings.dataDirectory}</code>.
				</p>
			</div>
		</section>
	);
}
