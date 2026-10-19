import { useState } from "react";
import type { BackgroundRecord } from "@openbot/protocol";
import { api, errorMessage } from "./store";
import { t } from "./i18n";
import "./background.css";
const labels: Record<BackgroundRecord["state"], string> = {
	reserved: "Starting background task",
	running: "Command running",
	ready: "Waiting to deliver",
	queued: "Waiting to deliver",
	delivering: "Delivering result",
	delivered: "Result delivered",
	suppressed: "Automatic follow-up stopped",
	attention: "Needs attention",
};
export function BackgroundTask({ record }: { record: BackgroundRecord }) {
	const [busy, setBusy] = useState(false),
		[error, setError] = useState<string>();
	const pending = !["delivered", "suppressed", "attention"].includes(record.state);
	return (
		<section className="background-task" aria-label={t("Background task")} data-state={record.state}>
			<div className="background-task-heading">
				<span>{t(labels[record.state])}</span>
				<small>{record.taskId}</small>
				{pending && (
					<button
						disabled={busy}
						onClick={async () => {
							setBusy(true);
							setError(undefined);
							try {
								await api["background.stop"]({ invocationId: record.invocationId });
							} catch (e) {
								setError(errorMessage(e));
							} finally {
								setBusy(false);
							}
						}}
					>
						{t("Stop background task")}
					</button>
				)}
			</div>
			{record.reason && <p className="muted">{t(record.reason)}</p>}
			{record.receipt?.output !== undefined && (
				<details>
					<summary>
						{t("Final command output")}
						{record.receipt.truncated ? ` · ${t("Truncated")}` : ""}
					</summary>
					<pre>{record.receipt.output || t("No output")}</pre>
				</details>
			)}
			{error && <p role="alert">{t(error)}</p>}
		</section>
	);
}
