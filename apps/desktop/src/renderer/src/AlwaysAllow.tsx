import { t } from "./i18n";
import type { PendingApproval } from "@openbot/protocol";
import { useState } from "react";
import { api, report } from "./store";
import { ChoiceCard } from "./ui/ChoiceCard";

/**
 * **Always allow** on an approval card: the scopes the Host offered, narrowest first, each shown as the exact rule or
 * folder grant it saves. Saving answers this request and stores the choice in one Host step.
 */
export function AlwaysAllow({
	approval,
	disabled = false,
	pending = false,
	onAllowed,
	onFailed,
}: {
	readonly approval: PendingApproval;
	readonly disabled?: boolean;
	readonly pending?: boolean;
	readonly onAllowed?: () => void;
	readonly onFailed?: () => void;
}) {
	const options = approval.alwaysAllowOptions ?? [];
	const [open, setOpen] = useState(false);
	const [chosen, setChosen] = useState(0);
	if (options.length === 0) return null;
	const option = options[Math.min(chosen, options.length - 1)]!;
	const folder = option.scope.kind === "folder";

	if (!open) {
		return (
			<button type="button" className="always-allow-link" disabled={disabled} onClick={() => setOpen(true)}>
				{pending ? t("Loading") : t("Always allow")}
			</button>
		);
	}
	return (
		<ChoiceCard
			className="always-allow"
			label={t("Always allow")}
			question={t(
				folder
					? "Bots may use this folder without asking until you revoke it in Settings → Folders."
					: "Matching commands run without asking until you delete the rule in Settings → Commands.",
			)}
			options={
				<>
					<div className="always-allow-options" role="radiogroup" aria-label={t(folder ? "Folder" : "Rule")}>
						{options.map((candidate, index) => (
							<label key={candidate.label} className="always-allow-option">
								<input
									type="radio"
									name={`always-${approval.approvalId}`}
									checked={index === chosen}
									disabled={disabled || pending}
									onChange={() => setChosen(index)}
								/>
								<code>{candidate.label}</code>
							</label>
						))}
					</div>
					<div className="approval-actions">
						<button type="button" disabled={disabled || pending} onClick={() => setOpen(false)}>
							{t("Cancel")}
						</button>
						<button
							type="button"
							className="primary"
							disabled={disabled || pending}
							aria-busy={pending}
							onClick={() => {
								if (disabled || pending) return;
								onAllowed?.();
								void api["approvals.decide"]({
									approvalId: approval.approvalId,
									decision: { kind: "always_allow", scope: option.scope },
								}).catch((error) => {
									onFailed?.();
									report(error);
								});
							}}
						>
							{pending ? t("Loading") : t(folder ? "Grant and allow" : "Save rule and allow")}
						</button>
					</div>
				</>
			}
		/>
	);
}
