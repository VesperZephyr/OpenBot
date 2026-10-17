import type { ApprovalDecision, PendingApproval } from "@openbot/protocol";
import { api, report } from "./store";
import { t } from "./i18n";
import { AlwaysAllow } from "./AlwaysAllow";
import { ManagementPreview } from "./BotManagement";
import { GroupPreview } from "./GroupPreview";

export function ApprovalCard({ approval }: { readonly approval: PendingApproval }) {
	const decide = (decision: ApprovalDecision): void =>
		void api["approvals.decide"]({ approvalId: approval.approvalId, decision }).catch(report);
	const args = (approval.args ?? {}) as Record<string, unknown>;
	return (
		<div className="approval" role="group" aria-label={t("Approval request")}>
			<div className="approval-reason">{t(approval.reason)}</div>
			{approval.tool.startsWith("group_") ? (
				<GroupPreview args={args} action={approval.tool.slice(6)} />
			) : ["bot_create", "bot_update", "bot_delete"].includes(approval.tool) ? (
				<ManagementPreview args={{ ...args, action: approval.tool.slice(4) }} />
			) : (
				<pre className="approval-args">
					{approval.tool === "local_exec"
						? `${String(args.command ?? "")}${args.cwd === undefined ? "" : `\n# in ${String(args.cwd)}`}`
						: JSON.stringify(approval.args, null, 2)}
				</pre>
			)}
			<div className="approval-actions">
				<button type="button" onClick={() => decide("deny")}>
					{t("Deny")}
				</button>
				<button type="button" className="primary" onClick={() => decide("allow_once")} autoFocus>
					{t("Allow once")}
				</button>
			</div>
			<AlwaysAllow approval={approval} />
		</div>
	);
}
