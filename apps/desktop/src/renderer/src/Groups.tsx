import { useEffect, useRef, useState } from "react";
import type { Group, GroupSnapshot } from "@openbot/protocol";
import { api, refreshGroups, report, useStore } from "./store";
import { t } from "./i18n";
import { Markdown } from "./markdown";
import { ApprovalCard } from "./ApprovalCard";
import "./groups.css";

export function GroupSidebar() {
	const groups = useStore((s) => s.groups);
	const view = useStore((s) => s.view);
	const [creating, setCreating] = useState(false);
	return (
		<div className="section group-sidebar">
			<div className="group-section-heading">
				<span className="section-title">{t("Groups")}</span>
				<button type="button" aria-label={t("Create group")} onClick={() => setCreating(true)}>
					＋
				</button>
			</div>
			{!groups.length && <p className="section-empty">{t("Bring your Bots together for a task")}</p>}
			{groups.map((g) => (
				<button
					key={g.groupId}
					type="button"
					className={`nav-item group-nav ${view.kind === "group" && view.groupId === g.groupId ? "is-selected" : ""}`}
					onClick={() => useStore.setState({ view: { kind: "group", groupId: g.groupId } })}
				>
					<span aria-hidden>◈</span>
					<span>
						{g.name}
						<small>{t(g.status === "dissolved" ? "Dissolved" : "{count} members", { count: g.memberIds.length })}</small>
					</span>
				</button>
			))}
			{creating && <GroupEditor onClose={() => setCreating(false)} />}
		</div>
	);
}
function GroupEditor({ group: liveGroup, onClose }: { group?: Group; onClose: () => void }) {
	const [group, setGroup] = useState(liveGroup);
	const bots = useStore((s) => s.bots).filter((b) => b.status !== "deleted");
	const [name, setName] = useState(group?.name ?? "");
	const [objective, setObjective] = useState(group?.objective ?? "");
	const [members, setMembers] = useState<readonly string[]>(group?.memberIds ?? []);
	const [lead, setLead] = useState(group?.leadBotId ?? "");
	const [saving, setSaving] = useState(false);
	const requestId = useRef(crypto.randomUUID());
	const valid =
		(!liveGroup || (liveGroup.status === "active" && liveGroup.revision === group?.revision)) &&
		name.trim() &&
		members.length >= 2 &&
		members.length <= 6 &&
		members.includes(lead);
	return (
		<div className="dialog-backdrop">
			<form
				className="dialog group-editor"
				role="dialog"
				aria-label={t(group ? "Edit group" : "Create group")}
				onSubmit={async (e) => {
					e.preventDefault();
					if (!valid || saving) return;
					setSaving(true);
					try {
						const result = await api["groups.change"]({
							requestId: requestId.current,
							action: group ? "update" : "create",
							groupId: group?.groupId ?? `group_${requestId.current}`,
							expectedRevision: group?.revision ?? 0,
							fields: { name: name.trim(), objective, memberIds: members, leadBotId: lead },
						});
						await refreshGroups();
						useStore.setState({ view: { kind: "group", groupId: result.groupId } });
						onClose();
					} catch (error) {
						report(error);
					} finally {
						setSaving(false);
					}
				}}
			>
				<h2>{t(group ? "Edit group" : "Create group")}</h2>
				<label>
					{t("Group name")}
					<input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus required />
				</label>
				<label>
					{t("Objective")}
					<textarea value={objective} onChange={(e) => setObjective(e.target.value)} maxLength={4000} rows={3} />
				</label>
				<fieldset>
					<legend>{t("Members · choose 2–6")}</legend>
					<div className="group-member-options">
						{bots.map((b) => (
							<label key={b.botId}>
								<input
									type="checkbox"
									checked={members.includes(b.botId)}
									disabled={!members.includes(b.botId) && members.length >= 6}
									onChange={(e) => {
										const ids = e.target.checked ? [...members, b.botId] : members.filter((id) => id !== b.botId);
										setMembers(ids);
										if (!ids.includes(lead)) setLead(ids[0] ?? "");
									}}
								/>
								{b.name}
							</label>
						))}
					</div>
				</fieldset>
				{bots.length < 2 && <p className="muted">{t("Create another Bot before starting a group")}</p>}
				<label>
					{t("Lead")}
					<select aria-label={t("Lead")} value={lead} onChange={(e) => setLead(e.target.value)}>
						<option value="">{t("Choose a lead")}</option>
						{bots
							.filter((b) => members.includes(b.botId))
							.map((b) => (
								<option key={b.botId} value={b.botId}>
									{b.name}
								</option>
							))}
					</select>
				</label>
				<p className="muted">{t("Messages go to the lead unless you choose recipients. Bot replies do not start other Bots.")}</p>
				{group && liveGroup && liveGroup.revision !== group.revision && (
					<div className="group-conflict">
						<p>{t("Group changed. Reload before trying again.")}</p>
						<button
							type="button"
							onClick={() => {
								setGroup(liveGroup);
								setName(liveGroup.name);
								setObjective(liveGroup.objective);
								setMembers(liveGroup.memberIds);
								setLead(liveGroup.leadBotId ?? "");
								requestId.current = crypto.randomUUID();
							}}
						>
							{t("Reload group")}
						</button>
					</div>
				)}
				<div className="dialog-actions">
					<button type="button" disabled={saving} onClick={onClose}>
						{t("Cancel")}
					</button>
					<button className="primary" disabled={!valid || saving}>
						{t(group ? "Save changes" : "Create group")}
					</button>
				</div>
			</form>
		</div>
	);
}
export function GroupView({ groupId }: { groupId: string }) {
	const bots = useStore((s) => s.bots);
	const [snapshot, setSnapshot] = useState<GroupSnapshot>();
	const [editing, setEditing] = useState(false);
	const [dissolving, setDissolving] = useState(false);
	const [busy, setBusy] = useState(false);
	const [text, setText] = useState("");
	const [recipients, setRecipients] = useState<readonly string[]>([]);
	const sendId = useRef(crypto.randomUUID());
	const end = useRef<HTMLDivElement>(null);
	useEffect(() => {
		let alive = true;
		let timer: ReturnType<typeof setTimeout>;
		const refresh = async () => {
			try {
				const next = await api["groups.snapshot"]({ groupId });
				if (alive) setSnapshot(next);
			} catch (error) {
				if (alive) report(error);
			} finally {
				if (alive) timer = setTimeout(refresh, 700);
			}
		};
		void refresh();
		return () => {
			alive = false;
			clearTimeout(timer);
		};
	}, [groupId]);
	useEffect(() => {
		end.current?.scrollIntoView({ block: "end" });
	}, [snapshot?.posts.length]);
	if (!snapshot) return <div className="empty-state">{t("Loading…")}</div>;
	const { group, posts, tasks } = snapshot;
	const name = (id: string) => bots.find((b) => b.botId === id)?.name ?? t("Deleted Bot");
	const active = group.status === "active";
	const canSend = active && group.memberIds.length >= 2 && !!group.leadBotId;
	const selected = recipients.filter((id) => group.memberIds.includes(id));
	const send = async () => {
		if (!text.trim() || busy || !canSend) return;
		setBusy(true);
		try {
			await api["groups.send"]({ groupId, requestId: sendId.current, text, ...(selected.length ? { recipientIds: selected } : {}) });
			setText("");
			sendId.current = crypto.randomUUID();
			setSnapshot(await api["groups.snapshot"]({ groupId }));
		} catch (error) {
			report(error);
		} finally {
			setBusy(false);
		}
	};
	return (
		<section className="group-view">
			<header className="conversation-header">
				<div>
					<h1>{group.name}</h1>
					<p className="muted">
						{t(active ? "{count} members" : "Dissolved", { count: group.memberIds.length })}
						{group.leadBotId ? ` · ${t("Lead")}: ${name(group.leadBotId)}` : ""}
					</p>
				</div>
				{active && (
					<div className="group-header-actions">
						<button onClick={() => setEditing(true)}>{t("Edit group")}</button>
						<button onClick={() => setDissolving(true)}>{t("Dissolve group")}</button>
					</div>
				)}
			</header>
			<div className="group-timeline">
				<div className="group-intro">
					<span className="group-symbol" aria-hidden>
						◈
					</span>
					<h2>{t("A shared place to work")}</h2>
					<p>{group.objective || t("Choose a member or send a task to the lead")}</p>
					<div className="group-members">
						{group.memberIds.map((id) => (
							<span key={id}>{name(id)}</span>
						))}
					</div>
				</div>
				{posts.map((post) => (
					<article className={`group-post ${post.senderId === "user" ? "from-user" : ""}`} key={post.postId}>
						<div className="group-post-meta">
							<strong>{post.senderId === "user" ? t("You") : name(post.senderId)}</strong>
							{post.recipientIds.length > 0 && <span> → {post.recipientIds.map(name).join(", ")}</span>}
						</div>
						<Markdown text={post.text} />
					</article>
				))}
				{tasks.map((task) =>
					task.state === "pending" ? (
						<div key={task.deliveryId} className="group-task">
							<strong>{name(task.botId)}</strong>
							<span>{t(task.conversation?.run?.state === "queued" ? "Queued" : "Working")}</span>
							{task.runId && <button onClick={() => void api["runs.cancel"]({ runId: task.runId! }).catch(report)}>{t("Stop")}</button>}
							{task.conversation?.live?.partial?.map((part, i) => (
								<p key={i}>{part.text}</p>
							))}
							{task.conversation?.approvals.map((a) => (
								<ApprovalCard key={a.approvalId} approval={a} />
							))}
						</div>
					) : task.state !== "completed" ? (
						<p className="muted" key={task.deliveryId}>
							{name(task.botId)} · {t(task.state === "cancelled" ? "Task cancelled" : "Task failed")}
						</p>
					) : null,
				)}
				<div ref={end} />
			</div>
			{canSend ? (
				<div className="group-compose">
					<div className="group-recipients">
						<span>{t("Send to")}</span>
						<button aria-pressed={!selected.length} onClick={() => setRecipients([])}>
							{t("Lead")}
						</button>
						{group.memberIds.map((id) => (
							<button
								key={id}
								aria-pressed={selected.includes(id)}
								onClick={() => setRecipients(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])}
							>
								{name(id)}
							</button>
						))}
					</div>
					<div className="composer">
						<textarea
							aria-label={t("Message group")}
							placeholder={t("Message group")}
							value={text}
							onChange={(e) => {
								setText(e.target.value);
								sendId.current = crypto.randomUUID();
							}}
							maxLength={32000}
							onKeyDown={(e) => {
								if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
									e.preventDefault();
									void send();
								}
							}}
						/>
						<div className="composer-actions">
							<span className="composer-hint">{t("Only selected members receive this task")}</span>
							<button className="primary" disabled={!text.trim() || busy} onClick={() => void send()}>
								{t("Send")}
							</button>
						</div>
					</div>
				</div>
			) : (
				<p className="group-readonly">
					{t(
						active
							? "Choose members and a lead before sending a task"
							: "This group is dissolved. History is read-only and stored on this Mac.",
					)}
				</p>
			)}
			{editing && <GroupEditor group={group} onClose={() => setEditing(false)} />}
			{dissolving && (
				<div className="dialog-backdrop">
					<div className="dialog" role="dialog" aria-label={t("Dissolve group")}>
						<h2>
							{t("Dissolve group")}: {group.name}
						</h2>
						<p>{t("Stops all group tasks. History stays on this Mac. Bots are kept.")}</p>
						<div className="dialog-actions">
							<button disabled={busy} onClick={() => setDissolving(false)}>
								{t("Cancel")}
							</button>
							<button
								className="danger"
								disabled={busy}
								onClick={async () => {
									setBusy(true);
									try {
										await api["groups.change"]({
											requestId: crypto.randomUUID(),
											action: "dissolve",
											groupId,
											expectedRevision: group.revision,
										});
										setSnapshot(await api["groups.snapshot"]({ groupId }));
										await refreshGroups();
										setDissolving(false);
									} catch (error) {
										report(error);
									} finally {
										setBusy(false);
									}
								}}
							>
								{t("Dissolve group")}
							</button>
						</div>
					</div>
				</div>
			)}
		</section>
	);
}
