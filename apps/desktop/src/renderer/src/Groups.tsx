import { BackgroundTask } from "./BackgroundTask";
import { ArtifactCard } from "./ArtifactCard";
import { ChatComposer } from "./ChatComposer";
import { ConversationShell, DetailsPanel, Timeline } from "./ConversationUI";
import { MarkReadButton, RosterPreview, recentTime } from "./RosterPreview";
import { useEffect, useRef, useState } from "react";
import type { Group } from "@openbot/protocol";
import { refreshGroupSnapshot, api, refreshGroups, report, useStore } from "./store";
import { t } from "./i18n";
import { Markdown } from "./markdown";
import { ApprovalCard } from "./ApprovalCard";
import "./groups.css";

export function GroupSidebar({ query = "", unreadOnly = false }: { query?: string; unreadOnly?: boolean }) {
	const groups = useStore((s) => s.groups);
	const summaries = useStore((s) => s.summaries);
	const visible = groups
		.filter(
			(g) =>
				(!unreadOnly || (summaries[`group:${g.groupId}`]?.unreadCount ?? 0) > 0) &&
				`${g.name} ${g.objective}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
		)
		.toSorted(
			(a, b) =>
				recentTime(`group:${b.groupId}`, summaries, b.createdAt) - recentTime(`group:${a.groupId}`, summaries, a.createdAt) ||
				a.groupId.localeCompare(b.groupId),
		);
	return visible.length > 0 ? (
		<div className="section group-sidebar">
			<span className="section-title">{t("Groups")}</span>
			{visible.map((g) => (
				<GroupRow key={g.groupId} group={g} />
			))}
		</div>
	) : null;
}

function GroupRow({ group: g }: { group: Group }) {
	const view = useStore((s) => s.view);
	return (
		<button
			type="button"
			className={`bot-row group-nav ${view.kind === "group" && view.groupId === g.groupId ? "is-selected" : ""}`}
			onClick={() => useStore.setState({ view: { kind: "group", groupId: g.groupId }, searchTarget: undefined })}
		>
			<span className="avatar group-avatar" aria-hidden>
				◈
			</span>
			<RosterPreview
				conversationKey={`group:${g.groupId}`}
				name={g.name}
				fallback={t(g.status === "dissolved" ? "Dissolved" : "{count} members", { count: g.memberIds.length })}
			/>
		</button>
	);
}
export function GroupEditor({ group: liveGroup, onClose }: { group?: Group; onClose: () => void }) {
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
				<p className="muted">
					{t("Ordinary messages go to Core. Choose @ recipients to assign work directly. Private chats stay separate.")}
				</p>
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
					<button type="button" data-dialog-close disabled={saving} onClick={onClose}>
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
	const snapshot = useStore((s) => s.groupSnapshots[groupId]);
	const [editing, setEditing] = useState(false);
	const [dissolving, setDissolving] = useState(false);
	const [busy, setBusy] = useState(false);
	const [details, setDetails] = useState(false);
	useEffect(() => {
		void refreshGroupSnapshot().catch(report);
	}, [groupId]);

	if (!snapshot) return <div className="empty-state">{t("Loading…")}</div>;
	const { group, posts, tasks, roots } = snapshot;
	const core = bots.find((b) => b.kind === "core");
	const availableIds = [...new Set([...(core ? [core.botId] : []), ...group.memberIds])];
	const name = (id: string) => bots.find((b) => b.botId === id)?.name ?? t("Deleted Bot");
	const active = group.status === "active";
	const canSend = active && group.memberIds.length >= 2 && !!core;

	return (
		<ConversationShell
			className="group-view"
			details={
				details && (
					<DetailsPanel title={t("Conversation details")} onClose={() => setDetails(false)}>
						<p>{group.objective}</p>
						<h3>{t("Members")}</h3>
						<ul>
							{group.memberIds.map((id) => (
								<li key={id}>{name(id)}</li>
							))}
						</ul>
						<p className="muted">
							{t("Ordinary messages go to Core. Choose @ recipients to assign work directly. Private chats stay separate.")}
						</p>
						{active && (
							<div className="detail-actions">
								<button onClick={() => setEditing(true)}>{t("Edit group")}</button>
								<button className="is-destructive" onClick={() => setDissolving(true)}>
									{t("Dissolve group")}
								</button>
							</div>
						)}
					</DetailsPanel>
				)
			}
		>
			<header className="conversation-header">
				<div>
					<h1>{group.name}</h1>
					<p className="muted">
						{t(active ? "{count} members" : "Dissolved", { count: group.memberIds.length })}
						{group.leadBotId ? ` · ${t("Lead")}: ${name(group.leadBotId)}` : ""}
					</p>
				</div>
				<MarkReadButton conversationKey={`group:${groupId}`} cursor={snapshot.readCursor} />
				<button className="icon-button details-toggle" aria-label={t("Conversation details")} onClick={() => setDetails(!details)}>
					ⓘ
				</button>
			</header>
			<Timeline
				readCursor={snapshot.readCursor}
				conversationKey={`group:${groupId}`}
				activity={`${posts.length}:${JSON.stringify(tasks.map((d) => [d.state, d.conversation?.live]))}`}
				className="group-timeline"
			>
				{!posts.length && (
					<div className="group-intro">
						<span className="group-symbol" aria-hidden>
							◈
						</span>
						<h2>{t("A shared place to work")}</h2>
						<p>{group.objective || t("Send a task to Core, or @ a Bot to assign it directly")}</p>
						<div className="group-members">
							{group.memberIds.map((id) => (
								<span key={id}>{name(id)}</span>
							))}
						</div>
					</div>
				)}
				{posts
					.filter((post) => post.text.trim())
					.map((post) => (
						<article
							data-message-id={post.postId}
							className={`group-post ${post.kind && post.kind !== "result" ? "handoff-event" : ""} ${post.senderId === "user" ? "from-user" : ""}`}
							key={post.postId}
						>
							<div className="group-post-meta">
								<strong>{post.senderId === "user" ? t("You") : name(post.senderId)}</strong>
								{post.recipientIds.length > 0 && <span> → {post.recipientIds.map(name).join(", ")}</span>}
							</div>
							{post.kind && (
								<small className="handoff-label">
									{t(
										post.kind === "handoff"
											? "Ownership transferred"
											: post.kind === "delegation"
												? "Subtask assigned"
												: "Results returned",
									)}
								</small>
							)}
							<Markdown text={post.text} />
							{post.attachments?.map((artifact) => (
								<ArtifactCard key={artifact.artifactId} artifact={artifact} />
							))}
						</article>
					))}
				{snapshot.backgroundTasks?.map(record=><BackgroundTask key={record.invocationId} record={record}/>)}
				{roots
					.filter((r) => r.state !== "completed")
					.map((root) => (
						<div className="collaboration-root" key={root.rootId} role="group" aria-label={t("Collaboration task")}>
							<div className="collaboration-heading">
								<strong>
									{t(root.state === "paused" ? "Needs your direction" : root.state === "cancelled" ? "Task chain stopped" : "Team working")}
								</strong>
								{root.state === "running" && (
									<button onClick={() => void api["collaboration.stop"]({ rootId: root.rootId }).catch(report)}>
										{t("Stop task chain")}
									</button>
								)}
							</div>
							<p className="task-subject">{posts.find((p) => p.postId === root.postId)?.text.slice(0, 180)}</p>
							<div className="ownership-trail">
								{[...new Set(tasks.filter((d) => d.rootId === root.rootId && d.origin !== "result").map((d) => name(d.botId)))].join(" → ")}
							</div>
							{root.reason && <p>{t(root.reason)}</p>}
							{root.state === "paused" && (
								<p>{t("Send a new instruction to start a new task. This chain will not restart automatically.")}</p>
							)}
							<details className="task-details">
								<summary>{t("Task details")}</summary>
								<small>{t("{count} of 12 automatic deliveries", { count: root.automaticDeliveries })}</small>
								{tasks
									.filter((d) => d.rootId === root.rootId)
									.map((task) => (
										<div key={task.deliveryId} className="task-status-row">
											<span>{name(task.botId)}</span>
											<span>
												{t(
													task.conversation?.approvals.length
														? "Needs approval"
														: task.state === "pending"
															? !task.runId || task.conversation?.run?.state === "queued"
																? "Queued"
																: "Working"
															: task.state === "completed"
																? "Completed"
																: task.state === "cancelled"
																	? "Task cancelled"
																	: "Task failed",
												)}
											</span>
											{task.state === "pending" && task.runId && (
												<button onClick={() => void api["runs.cancel"]({ runId: task.runId! }).catch(report)}>{t("Stop")}</button>
											)}
										</div>
									))}
							</details>
						</div>
					))}
				{tasks
					.filter((task) => task.state === "pending")
					.map((task) => (
						<div key={task.deliveryId} className="group-task-live">
							{task.conversation?.live?.partial?.length || task.conversation?.approvals.length ? <strong>{name(task.botId)}</strong> : null}
							{task.conversation?.live?.partial?.map((part, i) => (
								<p key={i}>{part.text}</p>
							))}
							{task.conversation?.approvals.map((a) => (
								<ApprovalCard key={a.approvalId} approval={a} />
							))}
						</div>
					))}
			</Timeline>
			{!canSend && (
				<p className="group-readonly">
					{t(
						active
							? "Choose members and a lead before sending a task"
							: "This group is dissolved. History is read-only and stored on this Mac.",
					)}
				</p>
			)}
			<ChatComposer
				conversationKey={`group:${groupId}`}
				label={t("Message group")}
				members={availableIds.filter((id) => bots.some((b) => b.botId === id)).map((id) => ({ id, name: name(id) }))}
				readOnly={!canSend}
			/>

			{editing && <GroupEditor group={group} onClose={() => setEditing(false)} />}
			{dissolving && (
				<div className="dialog-backdrop">
					<div className="dialog" role="dialog" aria-label={t("Dissolve group")}>
						<h2>
							{t("Dissolve group")}: {group.name}
						</h2>
						<p>{t("Stops all group tasks. History stays on this Mac. Bots are kept.")}</p>
						<div className="dialog-actions">
							<button data-dialog-close disabled={busy} onClick={() => setDissolving(false)}>
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
										await refreshGroupSnapshot();
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
		</ConversationShell>
	);
}
