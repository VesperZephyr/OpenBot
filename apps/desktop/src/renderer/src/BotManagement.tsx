import { useEffect, useState } from "react";
import type { BotManagementActivity } from "@openbot/protocol";
import { t } from "./i18n";
import { actions } from "./previews/management-preview";

export function ManagementHistory() {
	const [records, setRecords] = useState<readonly BotManagementActivity[]>([]);
	const [error, setError] = useState(false);
	const load = async () => {
		try {
			setRecords(await window.openbot.methods["bots.management.history"]({}));
			setError(false);
		} catch {
			setError(true);
		}
	};
	useEffect(() => {
		void load();
	}, []);
	return (
		<div className="settings-group management-history">
			<h2>{t("Bot management activity")}</h2>
			<p className="muted">{t("Recent changes requested by the Core. Stored only on this Mac; prompts and messages are excluded.")}</p>
			<button type="button" onClick={() => void load()}>
				{t("Refresh activity")}
			</button>
			{error && <p role="alert">{t("Could not load activity")}</p>}
			{!error && records.length === 0 && <p className="muted">{t("No Bot management requests yet.")}</p>}
			<ul>
				{records.map((record) => (
					<li key={record.invocationId}>
						<strong>
							{t(actions[record.action]!)} · {t(record.outcome[0]!.toUpperCase() + record.outcome.slice(1))}
						</strong>
						<div className="muted">
							{new Date(record.completedAt ?? record.createdAt).toLocaleString()} · {t("Revision")} {record.expectedRevision} →{" "}
							{record.resultRevision ?? "—"}
						</div>
						<details>
							<summary>{t("Operation details")}</summary>
							<dl>
								{[
									["Actor", record.actorId],
									["Bot", record.botId],
									["Target", record.targetId],
									["Run", record.runId],
									["Invocation", record.invocationId],
									["Origin", "User request"],
								].map(([key, value]) => (
									<div key={key}>
										<dt>{t(key!)}</dt>
										<dd>{key === "Origin" ? t(value!) : value}</dd>
									</div>
								))}
							</dl>
						</details>
					</li>
				))}
			</ul>
		</div>
	);
}
