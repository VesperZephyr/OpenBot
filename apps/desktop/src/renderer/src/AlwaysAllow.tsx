import { t } from "./i18n";
import type { PendingApproval } from "@openbot/protocol";
import { useState } from "react";
import { api, report } from "./store";

/**
 * **Always allow** on an approval card: the scopes the Host offered, narrowest first, each shown as the exact rule or
 * folder grant it saves. Saving answers this request and stores the choice in one Host step.
 */
export function AlwaysAllow({ approval }: { readonly approval: PendingApproval }) {
	const options = approval.alwaysAllowOptions ?? [];
	const [open, setOpen] = useState(false);
	const [chosen, setChosen] = useState(0);
	if (options.length === 0) return null;
	const option = options[Math.min(chosen, options.length - 1)]!;
	const folder = option.scope.kind === "folder";

	if (!open) {
		return (
			<div className="always-allow">
				<button type="button" onClick={() => setOpen(true)}>{t("Always allow")}</button>
			</div>
		);
	}
	return (
		<div className="always-allow" role="group" aria-label={t("Always allow")}>
			<p className="muted">
				{t(folder
					? "Bots may use this folder without asking until you revoke it in Settings → Folders."
					: "Matching commands run without asking until you delete the rule in Settings → Commands.")}
			</p>
			<div className="always-allow-options" role="radiogroup" aria-label={t(folder ? "Folder" : "Rule")}>
				{options.map((candidate, index) => (
					<label key={candidate.label} className="always-allow-option">
						<input type="radio" name={`always-${approval.approvalId}`} checked={index === chosen} onChange={() => setChosen(index)} />
						<code>{candidate.label}</code>
					</label>
				))}
			</div>
			<div className="approval-actions">
				<button type="button" onClick={() => setOpen(false)}>{t("Cancel")}</button>
				<button
					type="button"
					className="primary"
					onClick={() =>
						void api["approvals.decide"]({
							approvalId: approval.approvalId,
							decision: { kind: "always_allow", scope: option.scope },
						}).catch(report)
					}
				>
					{t(folder ? "Grant and allow" : "Save rule and allow")}
				</button>
			</div>
		</div>
	);
}
