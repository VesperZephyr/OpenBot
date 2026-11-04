import { SkillReview } from "./Skills";
import { validSkillOperation, type SkillChange } from "@openbot/protocol";
import { useEffect, useState, useSyncExternalStore } from "react";
import { legacyManagementName, type ApprovalDecision, type PendingApproval } from "@openbot/protocol";
import { api, report, useStore } from "./store";
import { t } from "./i18n";
import { AlwaysAllow } from "./AlwaysAllow";
import { ManagementPreview } from "./BotManagement";
import { GroupPreview } from "./GroupPreview";
import { ChoiceCard } from "./ui/ChoiceCard";

type DecisionKind = "allow_once" | "deny" | "always_allow";

type SettledApproval = {
	readonly approvalId: string;
	readonly botId: string;
	readonly conversationId?: string;
	readonly decision: DecisionKind;
	readonly action: string;
	readonly detail: string;
	readonly at: number;
};

let settledList: readonly SettledApproval[] = [];
const listeners = new Set<() => void>();

function publish(next: readonly SettledApproval[]) {
	settledList = next;
	for (const listener of listeners) listener();
}

function rememberApproval(record: SettledApproval) {
	publish([...settledList.filter((item) => item.approvalId !== record.approvalId), record]);
}

function forgetApproval(approvalId: string) {
	publish(settledList.filter((item) => item.approvalId !== approvalId));
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

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

function recordCopy(decision: DecisionKind): "Allowed once: {action} · {time}" | "Always allowed: {action} · {time}" | "Denied: {action} · {time}" {
	if (decision === "deny") return "Denied: {action} · {time}";
	if (decision === "always_allow") return "Always allowed: {action} · {time}";
	return "Allowed once: {action} · {time}";
}

function ApprovalRecord({ record }: { readonly record: SettledApproval }) {
	const [open, setOpen] = useState(false);
	useStore((state) => state.settings?.language);
	return (
		<div className="approval-record" role="group" aria-label={t("Approval record")}>
			<button type="button" className="approval-record-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
				<span className={`status-dot ${record.decision === "deny" ? "is-danger" : "is-ready"}`} aria-hidden="true" />
				<span>{t(recordCopy(record.decision), { action: record.action, time: clock(record.at) })}</span>
			</button>
			{open ? <pre className="approval-args">{record.detail}</pre> : null}
		</div>
	);
}

export function SettledApprovals({
	botId,
	pending,
	conversationId,
}: {
	readonly botId: string;
	readonly pending: readonly string[];
	readonly conversationId?: string;
}) {
	const records = useSyncExternalStore(subscribe, () => settledList, () => settledList);
	const pendingIds = new Set(pending);
	const visible = records.filter(
		(record) =>
			record.botId === botId &&
			!pendingIds.has(record.approvalId) &&
			(conversationId === undefined || record.conversationId === undefined || record.conversationId === conversationId),
	);
	if (visible.length === 0) return null;
	return (
		<>
			{visible.map((record) => (
				<li key={record.approvalId} className="approval-slot">
					<ApprovalRecord record={record} />
				</li>
			))}
		</>
	);
}

function settle(approval: PendingApproval, decision: DecisionKind) {
	rememberApproval({
		approvalId: approval.approvalId,
		botId: approval.botId,
		...(approval.conversationId ? { conversationId: approval.conversationId } : {}),
		decision,
		action: actionOf(approval),
		detail: detailOf(approval),
		at: Date.now(),
	});
}

export function ApprovalCard({ approval }: { readonly approval: PendingApproval }) {
	const [pending, setPending] = useState(false);
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		if (!approval.deadline) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [approval.deadline]);
	const expired = approval.deadline !== undefined && now >= approval.deadline;
	const decide = (decision: ApprovalDecision, kind: DecisionKind): void => {
		if (pending || expired) return;
		setPending(true);
		settle(approval, kind);
		void api["approvals.decide"]({ approvalId: approval.approvalId, decision }).catch((error) => {
			forgetApproval(approval.approvalId);
			setPending(false);
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
				<div className="approval-actions">
					<button
						type="button"
						disabled={pending || expired}
						className="primary"
						aria-describedby={describedBy}
						onClick={() => decide("allow_once", "allow_once")}
					>
						{t("Allow once")}
					</button>
					{!expired && (
						<AlwaysAllow
							approval={approval}
							onAllowed={() => settle(approval, "always_allow")}
							onFailed={() => forgetApproval(approval.approvalId)}
						/>
					)}
					<button type="button" disabled={pending || expired} onClick={() => decide("deny", "deny")}>
						{t("Deny")}
					</button>
				</div>
			}
		>
			{preview}
			<p id={scopeId} className="approval-scope">
				{t("Allow once applies only to this request.")}
			</p>
		</ChoiceCard>
	);
}
