import type { ReactNode } from "react";
import { appManagementCapability, legacyManagementName, type AppExecution } from "@openbot/protocol";
import type { ConversationSnapshot, PendingApproval, TranscriptItem } from "@openbot/protocol";
import { ApprovalCard, TranscriptApprovals } from "../../ApprovalCard";
import { ArtifactCard } from "../../ArtifactCard";
import { Avatar } from "../../Avatar";
import { BackgroundTask } from "../../BackgroundTask";
import { RoutineProposalCard } from "../../BotResources";
import { HistoryTimeline } from "../../HistoryTimeline";
import { InterruptedRun } from "../../Lifecycle";
import { LiveReply } from "../../LiveReply";
import { RevealButton, MessageTime, StepsRow } from "../../TranscriptDetails";
import { Divider, RetryButton, Thinking, retryTarget } from "../../TranscriptExtras";
import { t } from "../../i18n";
import { Markdown } from "../../markdown";
import { PendingMessages, StoppedNote } from "../../runs";
import { transcriptRows } from "../../steps";
import { openBot, report, useStore } from "../../store";
import { displayToolOutput } from "../../tool-output";

export function HistoryTranscript({
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
	empty?: ReactNode;
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
