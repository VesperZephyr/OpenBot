import { useState, useEffect } from "react";
import { legacyManagementName, type ApprovalDecision, type PendingApproval } from "@openbot/protocol";
import { api, report } from "./store";
import { t } from "./i18n";
import { AlwaysAllow } from "./AlwaysAllow";
import { ManagementPreview } from "./BotManagement";
import { GroupPreview } from "./GroupPreview";

export function ApprovalCard({ approval }: { readonly approval: PendingApproval }) {
	const [pending, setPending] = useState(false);
 const [now,setNow]=useState(Date.now);
 useEffect(()=>{if(!approval.deadline)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[approval.deadline]);
 const expired=approval.deadline!==undefined&&now>=approval.deadline;
	const decide = (decision: ApprovalDecision): void => {
		if (pending||expired) return;
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
   {approval.deadline!==undefined&&<p role="status">{expired?t("Approval expired"):t(approval.binding?.origin==="unattended"?"Unattended approval expires in {seconds}s":"Approval expires in {seconds}s",{seconds:Math.max(0,Math.ceil((approval.deadline-now)/1000))})}</p>}
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
				<button type="button" disabled={pending||expired} onClick={() => decide("deny")}>
					{t("Deny")}
				</button>
				<button type="button" disabled={pending||expired} className="primary" onClick={() => decide("allow_once")}>
					{t("Allow once")}
				</button>
			</div>
			{!expired&&<AlwaysAllow approval={approval} />}
		</div>
	);
}
