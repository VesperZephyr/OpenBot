import { SkillReview } from "./Skills";
import { validSkillOperation, type SkillChange } from "@openbot/protocol";
import { useEffect, useState, useSyncExternalStore } from "react";
import { legacyManagementName, type ApprovalDecision, type ConversationSnapshot, type PendingApproval } from "@openbot/protocol";
import { api, report, useStore } from "./store";
import { t } from "./i18n";
import { AlwaysAllow } from "./AlwaysAllow";
import { ManagementPreview } from "./BotManagement";
import { GroupPreview } from "./GroupPreview";
import { ChoiceCard } from "./ui/ChoiceCard";
import {
	approvalChoices,
	approvalRecordSnapshot,
	forgetApproval,
	rememberApproval,
	retireApprovalRecords,
	settledApprovals,
	subscribeApprovalRecords,
	type ApprovalPress,
	type SettledApproval,
} from "./approval-records";

function clock(at: number): string {
	const language = useStore.getState().settings?.language === "zh-CN" ? "zh-CN" : "en-GB";
	return new Date(at).toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

function actionOf(approval: PendingApproval): string {
	const args = (approval.args ?? {}) as Record<string, unknown>;
	const described = args.description ?? args.path ?? args.command ?? args.url ?? args.name;
	return typeof described === "string" && described.trim() !== "" ? described : approval.reason;
}

function detailOf(approval: PendingApproval): string {
	const args = (approval.args ?? {}) as Record<string, unknown>;
	if (approval.tool === "local_exec") return `${String(args.command ?? "")}${args.cwd === undefined ? "" : `\n# in ${String(args.cwd)}`}`;
	return JSON.stringify(approval.args, null, 2);
}

function recordCopy(decision: ApprovalPress): "Allowed once: {action} · {time}" | "Set to always allow: {action} · {time}" | "Denied: {action} · {time}" {
	if (decision === "deny") return "Denied: {action} · {time}";
	if (decision === "always_allow") return "Set to always allow: {action} · {time}";
	return "Allowed once: {action} · {time}";
}

function summaryAction(record: SettledApproval): string {
	const line = record.action.split("\n")[0] ?? record.action;
	return line;
}

export function ApprovalRecord({ record }: { readonly record: SettledApproval }) {
	const [open, setOpen] = useState(false);
	useStore((state) => state.settings?.language);
	return (
		<div className="approval-record" role="group" aria-label={t("Approval record")}>
			<button type="button" className="approval-record-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
				<span className={`status-dot ${record.decision === "deny" ? "is-danger" : "is-ready"}`} aria-hidden="true" />
				<span className="approval-record-summary">{t(recordCopy(record.decision), { action: summaryAction(record), time: clock(record.at) })}</span>
			</button>
			{open ? <pre className="approval-args">{record.detail}</pre> : null}
		</div>
	);
}

export function ApprovalRecordLifetime({
	conversationId,
	runActive,
	latestUserAt,
}: {
	readonly conversationId: string | undefined;
	readonly runActive: boolean;
	readonly latestUserAt?: number;
}) {
	useEffect(() => {
		retireApprovalRecords({ conversationId, runActive, ...(latestUserAt === undefined ? {} : { latestUserAt }) });
	}, [conversationId, runActive, latestUserAt]);
	return null;
}

export function SettledApprovals({
	conversationId,
	pending,
	skipCallIds,
	runActive,
	latestUserAt,
	listItem = false,
}: {
	readonly conversationId: string | undefined;
	readonly pending: readonly string[];
	readonly skipCallIds?: ReadonlySet<string>;
	readonly runActive?: boolean;
	readonly latestUserAt?: number;
	readonly listItem?: boolean;
}) {
	const records = useSyncExternalStore(subscribeApprovalRecords, approvalRecordSnapshot, approvalRecordSnapshot);
	useEffect(() => {
		if (runActive === undefined) return;
		retireApprovalRecords({ conversationId, runActive, ...(latestUserAt === undefined ? {} : { latestUserAt }) });
	}, [conversationId, runActive, latestUserAt]);
	const visible = settledApprovals(conversationId, pending).filter((record) => !skipCallIds?.has(record.callId));
	void records;
	if (visible.length === 0) return null;
	return (
		<>
			{visible.map((record) =>
				listItem ? (
					<li key={record.approvalId} className="approval-slot">
						<ApprovalRecord record={record} />
					</li>
				) : (
					<ApprovalRecord key={record.approvalId} record={record} />
				),
			)}
		</>
	);
}

export function TranscriptApprovals({
	snapshot,
	historyOnly = false,
	latestUserAt: userAt,
}: {
	readonly snapshot: ConversationSnapshot;
	readonly historyOnly?: boolean;
	readonly latestUserAt?: number;
}) {
	if (historyOnly) return null;
	const runActive =
		snapshot.run !== undefined && snapshot.run.state !== "completed" && snapshot.run.state !== "failed" && snapshot.run.state !== "cancelled";
	return (
		<>
			<SettledApprovals
				conversationId={snapshot.conversationId}
				pending={snapshot.approvals.map((approval) => approval.approvalId)}
				runActive={runActive}
				{...(userAt === undefined ? {} : { latestUserAt: userAt })}
				listItem
			/>
			{snapshot.approvals.map((approval) => (
				<li key={approval.approvalId} className="approval-slot">
					<ApprovalCard approval={approval} />
				</li>
			))}
		</>
	);
}

function settle(approval: PendingApproval, decision: ApprovalPress) {
	if (!approval.conversationId) return;
	rememberApproval({
		approvalId: approval.approvalId,
		botId: approval.botId,
		conversationId: approval.conversationId,
		callId: approval.callId,
		decision,
		action: actionOf(approval),
		detail: detailOf(approval),
		at: Date.now(),
	});
}

export function ApprovalCard({ approval }: { readonly approval: PendingApproval }) {
	const [busy, setBusy] = useState<ApprovalPress | null>(null);
	const [now, setNow] = useState(Date.now);
	const choices = approvalChoices(busy);
	useEffect(() => {
		if (!approval.deadline) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [approval.deadline]);
	const expired = approval.deadline !== undefined && now >= approval.deadline;
	const decide = (decision: ApprovalDecision, kind: ApprovalPress): void => {
		if (busy || expired) return;
		setBusy(kind);
		settle(approval, kind);
		void api["approvals.decide"]({ approvalId: approval.approvalId, decision }).catch((error) => {
			forgetApproval(approval.approvalId);
			setBusy(null);
			report(error);
		});
	};
	const tool = legacyManagementName(approval.tool);
	const args = (approval.args ?? {}) as Record<string, unknown>;
	const scopeId = `approval-scope-${approval.approvalId}`;
	const argsId = `approval-args-${approval.approvalId}`;
	const skillChange = tool === "skill_save" && validSkillOperation(args) && (args.action === "save" || args.action === "delete") ? (args as SkillChange) : undefined;
	const preview = skillChange ? (
		<SkillReview change={skillChange} />
	) : tool.startsWith("group_") ? (
		<GroupPreview args={args} action={tool.slice(6)} />
	) : ["bot_create", "bot_update", "bot_delete"].includes(tool) ? (
		<ManagementPreview args={{ ...args, action: tool.slice(4) }} />
	) : (
		<pre id={argsId} className="approval-args">
			{approval.tool === "local_exec" ? `${String(args.command ?? "")}${args.cwd === undefined ? "" : `\n# in ${String(args.cwd)}`}` : JSON.stringify(approval.args, null, 2)}
		</pre>
	);
	const describedBy = skillChange || tool.startsWith("group_") || ["bot_create", "bot_update", "bot_delete"].includes(tool) ? scopeId : `${scopeId} ${argsId}`;
	const label = (kind: ApprovalPress, text: string) => (choices[kind === "allow_once" ? "allow" : kind === "deny" ? "deny" : "always"].loading ? t("Loading") : text);
	return (
		<ChoiceCard
			className="approval"
			label={t("Approval request")}
			marker={approval.approvalId}
			kicker={
				approval.deadline !== undefined || approval.tool.startsWith("mcp__") ? (
					<>
						{approval.tool.startsWith("mcp__") ? <strong className="connector-approval-tool">{approval.tool.slice(5).replace("__", " / ")}</strong> : null}
						{approval.deadline !== undefined ? (
							<p role="status">
								{expired
									? t("Approval expired")
									: t(approval.binding?.origin === "unattended" ? "Unattended approval expires in {seconds}s" : "Approval expires in {seconds}s", {
											seconds: Math.max(0, Math.ceil((approval.deadline - now) / 1000)),
										})}
							</p>
						) : null}
					</>
				) : null
			}
			question={<span className="approval-reason">{t(approval.reason)}</span>}
			options={
				<>
					<div className="approval-actions">
						<button
							type="button"
							disabled={choices.allow.disabled || expired}
							className="primary"
							aria-describedby={describedBy}
							aria-busy={choices.allow.loading}
							onClick={() => decide("allow_once", "allow_once")}
						>
							{label("allow_once", t("Allow once"))}
						</button>
						<button type="button" disabled={choices.deny.disabled || expired} aria-busy={choices.deny.loading} onClick={() => decide("deny", "deny")}>
							{label("deny", t("Deny"))}
						</button>
					</div>
					{!expired && (
						<AlwaysAllow
							approval={approval}
							disabled={choices.always.disabled}
							pending={choices.always.loading}
							onAllowed={() => {
								if (busy) return;
								setBusy("always_allow");
								settle(approval, "always_allow");
							}}
							onFailed={() => {
								forgetApproval(approval.approvalId);
								setBusy(null);
							}}
						/>
					)}
				</>
			}
		>
			{preview}
			<p id={scopeId} className="approval-scope">
				{t("Allow once applies only to this request.")}
			</p>
		</ChoiceCard>
	);
}
