import { ArtifactCard } from "./ArtifactCard";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { api, report, sendMessage, useStore } from "./store";
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
 const skills=useStore(s=>s.skills);
 const [skillPicker,setSkillPicker]=useState(false),[skillActive,setSkillActive]=useState(0),[skillDismissed,setSkillDismissed]=useState<string>();
 const skillListId=useId();
 const skillMatch=members?null:draft.text.match(/(?:^|\s)\/([a-z0-9-]*)$/);
 const skillShowing=!members&&!readOnly&&(skillPicker||!!skillMatch&&skillDismissed!==draft.text);
 const skillOptions=(skills??[]).filter(s=>s.available&&!s.deleted&&!draft.skills?.some(ref=>ref.name===s.name)&&s.name.includes(skillMatch?.[1]??""));
 useEffect(()=>setSkillActive(0),[skillMatch?.[1],skillOptions.length]);
 const chooseSkill=(skill:import("@openbot/protocol").SkillSummary)=>{
  if((draft.skills?.length??0)>=2)return;
  composers.edit(conversationKey,{skills:[...(draft.skills??[]),{name:skill.name,revision:skill.revision,sha256:skill.sha256}],...(skillMatch?{text:draft.text.slice(0,draft.text.lastIndexOf("/"))}:{})});
  setSkillPicker(false);setSkillDismissed(draft.text);input.current?.focus();
 };
	const [attaching, setAttaching] = useState(false);
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
			? sendMessage(
					conversationKey.slice(4),
					a.text,
					a.requestId,
					a.attachments?.map((ref) => ref.artifactId),
 a.skills,
				)
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
					{attempt.attachments?.map((ref) => (
						<span key={ref.artifactId} className="attachment-chip">
							{ref.name}
						</span>
					))}
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
 {draft.skills?.map(skill=><button type="button" disabled={readOnly} key={skill.name} className="skill-chip" aria-label={t("Detach skill {name}",{name:skill.name})} onClick={()=>composers.edit(conversationKey,{skills:draft.skills?.filter(s=>s.name!==skill.name)??[]})}>/{skill.name} <small>v{skill.revision}</small> ×</button>)}
 {skillShowing&&<div className="skill-options" role="listbox" id={skillListId} aria-label={t("Attach a skill")}>
 {(draft.skills?.length??0)>=2?<p>{t("Select up to two distinct skills")}</p>:skillOptions.length?skillOptions.map((skill,index)=><button type="button" role="option" id={`${skillListId}-${index}`} aria-selected={index===skillActive} key={skill.name} onMouseDown={e=>e.preventDefault()} onClick={()=>chooseSkill(skill)}>/{skill.name} · v{skill.revision}<small> · {skill.description}</small></button>):<p>{t("No matching skills. Create one in Skills.")}</p>}
 </div>}
				{!!draft.attachments?.length && (
					<div className="attachment-chips">
						{draft.attachments.map((ref) => (
							<ArtifactCard
								key={ref.artifactId}
								artifact={ref}
								detach={() =>
									composers.edit(conversationKey, { attachments: draft.attachments?.filter((a) => a.artifactId !== ref.artifactId) ?? [] })
								}
							/>
						))}
					</div>
				)}
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
					aria-controls={skillShowing?skillListId:showing ? listId : undefined}
					aria-expanded={members ? showing : skillShowing}
					aria-activedescendant={skillShowing&&skillOptions.length?`${skillListId}-${skillActive}`:showing && options.length ? `${listId}-${active}` : undefined}
					onChange={(e) => {
						composers.edit(conversationKey, { text: e.target.value });
						setDismissed(undefined);
 setSkillDismissed(undefined);
					}}
					onKeyDown={(e) => {
						if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
						if(skillShowing){
 if(e.key==="Escape"){e.preventDefault();e.stopPropagation();setSkillPicker(false);setSkillDismissed(draft.text);return;}
 if(["ArrowDown","ArrowUp"].includes(e.key)){e.preventDefault();setSkillActive(n=>(n+(e.key==="ArrowDown"?1:-1)+skillOptions.length)%(skillOptions.length||1));return;}
 if(["Enter","Tab"].includes(e.key)&&!e.shiftKey){e.preventDefault();if(skillOptions[skillActive])chooseSkill(skillOptions[skillActive]);return;}
 }
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
							{!members && (
								<button
									type="button"
									className="icon-button"
									aria-label={t("Attach files")}
									disabled={attaching || (draft.attachments?.length ?? 0) >= 4}
									onClick={() => {
										setAttaching(true);
										const key = conversationKey;
										void window.openbot
											.attachFiles()
											.then((result) => {
												const current = composers.get(key).draft;
												const attachments = [...(current.attachments ?? []), ...result.attachments];
												if (attachments.length > 4) {
													report(new Error("Choose at most four attachments"));
													return;
												}
												composers.edit(key, { attachments });
												if (result.errors.length) report(new Error(result.errors[0]));
											})
											.catch(report)
											.finally(() => setAttaching(false));
									}}
								>
									<span aria-hidden>＋</span>
								</button>
							)}
							{!members&&<button type="button" className="icon-button" aria-label={t("Attach a skill")} aria-expanded={skillShowing} onClick={()=>{setSkillPicker(!skillShowing);setSkillDismissed(skillShowing?draft.text:undefined);input.current?.focus();}}>/</button>}
 {controls}
							<button
								type="button"
								aria-label={t("Send")}
								className="primary send"
								disabled={(!draft.text.trim() && !draft.attachments?.length && !draft.skills?.length) || !!attempt || !!stale || attaching}
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
