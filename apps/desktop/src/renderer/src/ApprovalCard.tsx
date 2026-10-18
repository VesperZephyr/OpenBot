import { useState } from "react";
import { legacyManagementName, type ApprovalDecision, type PendingApproval } from "@openbot/protocol";
import { api, report } from "./store";
import { t } from "./i18n";
import { AlwaysAllow } from "./AlwaysAllow";
import { ManagementPreview } from "./BotManagement";
import { GroupPreview } from "./GroupPreview";

export function ApprovalCard({ approval }: { readonly approval: PendingApproval }) {
	const [pending, setPending] = useState(false);
	const decide = (decision: ApprovalDecision): void => {
		if (pending) return;
		setPending(true);
		void api["approvals.decide"]({ approvalId: approval.approvalId, decision }).catch((error) => {
			setPending(false);
			report(error);
		});
	};
	const tool = legacyManagementName(approval.tool);
	const args = (approval.args ?? {}) as Record<string, unknown>;
	return (
		<div className="approval" data-approval-id={approval.approvalId} role="group" aria-label={t("Approval request")}>
			<div className="approval-reason">{t(approval.reason)}</div>
			{tool.startsWith("group_") ? (
				<GroupPreview args={args} action={tool.slice(6)} />
			) : ["bot_create", "bot_update", "bot_delete"].includes(tool) ? (
				<ManagementPreview args={{ ...args, action: tool.slice(4) }} />
			) : (
				<pre className="approval-args">
					{approval.tool === "local_exec"
						? `${String(args.command ?? "")}${args.cwd === undefined ? "" : `\n# in ${String(args.cwd)}`}`
						: JSON.stringify(approval.args, null, 2)}
				</pre>
			)}
			<div className="approval-actions">
				<button type="button" disabled={pending} onClick={() => decide("deny")}>
					{t("Deny")}
				</button>
				<button type="button" disabled={pending} className="primary" onClick={() => decide("allow_once")}>
					{t("Allow once")}
				</button>
			</div>
			<AlwaysAllow approval={approval} />
		</div>
	);
}
