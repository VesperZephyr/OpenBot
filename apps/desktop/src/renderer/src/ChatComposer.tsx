import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { api, report, sendMessage } from "./store";
import { t } from "./i18n";
import { composers, useComposer } from "./useComposer";
import type { ConversationKey, SendAttempt } from "./composers";

export function ChatComposer({
	conversationKey,
	label,
	members,
	readOnly = false,
	controls,
}: {
	conversationKey: ConversationKey;
	label: string;
	members?: readonly { id: string; name: string }[];
	readOnly?: boolean;
	controls?: ReactNode;
}) {
	const { draft, attempt } = useComposer(conversationKey);
	const input = useRef<HTMLTextAreaElement>(null);
	const [picker, setPicker] = useState(false),
		[active, setActive] = useState(0),
		[dismissed, setDismissed] = useState<string>();
	const listId = useId();
	const match = members && draft.text.match(/(?:^|\s)@([^@\s]*)$/);
	const query = match?.[1] ?? "";
	const showing = !!members && (picker || (!!match && dismissed !== draft.text));
	const options = (members ?? []).filter((m) => m.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
	const selected = draft.recipientIds;
	const stale = members && selected.some((id) => !members.some((m) => m.id === id));
	useEffect(() => {
		setActive(0);
	}, [query, options.length]);
	useEffect(() => {
		const el = input.current;
		if (el) {
			el.style.height = "auto";
			el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
		}
	}, [draft.text]);
	const choose = (id: string) => {
		composers.edit(conversationKey, {
			recipientIds: [...new Set([...selected, id])],
			...(match ? { text: draft.text.slice(0, draft.text.lastIndexOf("@")) } : {}),
		});
		setPicker(false);
		setDismissed(draft.text);
		input.current?.focus();
	};
	const dispatch = (a: SendAttempt) =>
		conversationKey.startsWith("bot:")
			? sendMessage(conversationKey.slice(4), a.text, a.requestId)
			: api["groups.send"]({
					groupId: conversationKey.slice(6),
					requestId: a.requestId,
					text: a.text,
					...(a.recipientIds.length ? { recipientIds: a.recipientIds } : {}),
				});
	const send = async (retry = false) => {
		if (readOnly || (!retry && stale)) return;
		if (
			await composers.send(
				conversationKey,
				(a) =>
					dispatch(a).catch((error) => {
						report(error);
						throw error;
					}),
				retry,
			)
		)
			window.dispatchEvent(new CustomEvent("openbot:sent", { detail: conversationKey }));
	};
	const copy = (text: string) => void navigator.clipboard.writeText(text).catch(report);
	return (
		<div className="compose-area">
			{composers.warning && (
				<p className="compose-notice" role="alert">
					{t(composers.warning)}
				</p>
			)}
			{attempt?.state === "uncertain" && (
				<div className="send-recovery" role="status">
					<strong>{t("Message delivery is uncertain")}</strong>
					<p>
						{t("It may already be sent. Retry checks the same request. Dismiss only removes this recovery record; it does not stop work.")}
					</p>
					<pre>{attempt.text}</pre>
					<div className="recovery-actions">
						<button type="button" disabled={readOnly} onClick={() => void send(true)}>
							{t("Retry send")}
						</button>
						<button type="button" onClick={() => copy(attempt.text)}>
							{t("Copy")}
						</button>
						<button type="button" onClick={() => composers.dismiss(conversationKey)}>
							{t("Dismiss attempt")}
						</button>
					</div>
				</div>
			)}
			{stale && (
				<p className="compose-notice" role="alert">
					{t("A selected Bot is no longer available. Remove it or choose Core before sending.")}
				</p>
			)}
			<div className="composer">
				{members && (
					<div className="group-recipients">
						<button
							type="button"
							disabled={readOnly}
							aria-pressed={!selected.length}
							onClick={() => composers.edit(conversationKey, { recipientIds: [] })}
						>
							{t("Core · automatic")}
						</button>
						{selected.map((id) => (
							<button
								type="button"
								disabled={readOnly}
								key={id}
								className={members.some((m) => m.id === id) ? "recipient-chip" : "recipient-chip is-stale"}
								aria-label={t("Remove {name}", { name: members.find((m) => m.id === id)?.name ?? t("Unavailable Bot") })}
								onClick={() => composers.edit(conversationKey, { recipientIds: selected.filter((v) => v !== id) })}
							>
								@{members.find((m) => m.id === id)?.name ?? t("Unavailable Bot")} ×
							</button>
						))}
					</div>
				)}
				{showing && (
					<div className="mention-options" role="listbox" id={listId} aria-label={t("Mention a Bot")}>
						{options.length ? (
							options.map((m, index) => (
								<button
									type="button"
									role="option"
									id={`${listId}-${index}`}
									key={m.id}
									aria-selected={index === active}
									onMouseDown={(e) => e.preventDefault()}
									onClick={() => choose(m.id)}
								>
									@{m.name}
								</button>
							))
						) : (
							<p>{t("No matching Bots")}</p>
						)}
					</div>
				)}
				<textarea
					ref={input}
					value={draft.text}
					rows={1}
					readOnly={readOnly}
					aria-label={label}
					placeholder={label}
					aria-controls={showing ? listId : undefined}
					aria-expanded={members ? showing : undefined}
					aria-activedescendant={showing && options.length ? `${listId}-${active}` : undefined}
					onChange={(e) => {
						composers.edit(conversationKey, { text: e.target.value });
						setDismissed(undefined);
					}}
					onKeyDown={(e) => {
						if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
						if (showing) {
							if (e.key === "Escape") {
								e.preventDefault();
								e.stopPropagation();
								setPicker(false);
								setDismissed(draft.text);
								return;
							}
							if (["ArrowDown", "ArrowUp"].includes(e.key)) {
								e.preventDefault();
								setActive((n) => (n + (e.key === "ArrowDown" ? 1 : -1) + options.length) % (options.length || 1));
								return;
							}
							if (["Enter", "Tab"].includes(e.key) && !e.shiftKey) {
								e.preventDefault();
								if (options[active]) choose(options[active].id);
								return;
							}
						}
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							void send();
						}
					}}
				/>
				<div className="composer-actions">
					<span className="composer-hint">
						{t(
							readOnly
								? "Unsent draft · read-only"
								: members
									? "Core coordinates by default · @ selects recipients"
									: "Enter to send · Shift+Enter for a new line",
						)}
					</span>
					{readOnly ? (
						<button type="button" onClick={() => copy(draft.text)}>
							{t("Copy draft")}
						</button>
					) : (
						<>
							{members && (
								<button
									type="button"
									className="icon-button"
									aria-label={t("Mention a Bot")}
									aria-expanded={showing}
									onClick={() => {
										setPicker(!showing);
										setDismissed(showing ? draft.text : undefined);
										input.current?.focus();
									}}
								>
									@
								</button>
							)}
							{controls}
							<button
								type="button"
								aria-label={t("Send")}
								className="primary send"
								disabled={!draft.text.trim() || !!attempt || !!stale}
								onClick={() => void send()}
							>
								<span aria-hidden>↑</span>
							</button>
						</>
					)}
				</div>
			</div>
		</div>
	);
}
