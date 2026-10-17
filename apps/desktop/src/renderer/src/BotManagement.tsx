import { useEffect, useState } from "react";
import type { BotManagementActivity } from "@openbot/protocol";
import { t } from "./i18n";
import { useStore } from "./store";

const labels: Record<string, string> = {
	name: "Name",
	role: "Role",
	instructions: "Instructions",
	model: "Model",
	thinkingLevel: "Thinking level",
};
const actions: Record<string, string> = { create: "Create Bot", update: "Update Bot", delete: "Delete Bot" };
export function ManagementPreview({ args }: { readonly args: Record<string, unknown> }) {
	const bots = useStore((state) => state.bots);
	const bot = bots.find((b) => b.botId === args.botId);
	return (
		<div className="management-preview">
			<strong>
				{t(actions[String(args.action)] ?? "Manage Bot")}
				{" · "}
				{String(args.name ?? bot?.name ?? args.botId ?? "")}
			</strong>
			{args.botId !== undefined && (
				<p className="muted">
					<code>{String(args.botId)}</code> · {t("Revision")} {String(args.expectedRevision)}
				</p>
			)}
			{Object.entries(labels)
				.filter(([key]) => args[key] != null)
				.map(([key, label]) => (
					<div className="management-field" key={key}>
						<span>{t(label)}</span>
						<pre>{typeof args[key] === "string" ? args[key] : args[key] === null ? t("Use default model") : JSON.stringify(args[key])}</pre>
					</div>
				))}
			{args.useDefaultModel === true && <p>{t("Use default model")}</p>}
			<p className="muted">
				{t(
					args.action === "delete"
						? "This stops the Bot's work and background commands. Local history is retained."
						: args.action === "create"
							? "Creates a Specialist with its own instructions and empty memory."
							: "Only the fields shown above will change.",
				)}
			</p>
		</div>
	);
}
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
