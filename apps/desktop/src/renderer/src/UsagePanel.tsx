import { useEffect, useState } from "react";
import type { BotUsage, RunEvidence, UsageSummary } from "@openbot/protocol";
import { api, openBot, report, useStore } from "./store";
import { t } from "./i18n";
import "./usage.css";

export function UsagePanel({ botId, onNavigate }: { botId: string; onNavigate: () => void }) {
	const [open, setOpen] = useState(false),
		[refresh, setRefresh] = useState(0);
	const [result, setResult] = useState<BotUsage>(),
		[pending, setPending] = useState(false),
		[failed, setFailed] = useState(false);
	const language = useStore((s) => s.settings?.language ?? "en");
	useEffect(() => {
		let current = true;
		setResult(undefined);
		setFailed(false);
		if (!open) return;
		setPending(true);
		void api["usage.get"]({ botId })
			.then((data) => {
				if (current) setResult(data);
			})
			.catch(() => {
				if (current) setFailed(true);
			})
			.finally(() => {
				if (current) setPending(false);
			});
		return () => {
			current = false;
		};
	}, [botId, open, refresh]);
	const navigate = async (run: RunEvidence, messageId?: string) => {
		const id = run.conversationKey.slice(run.conversationKey.indexOf(":") + 1);
		const target = messageId ? { conversationKey: run.conversationKey, messageId, nonce: crypto.randomUUID() } : undefined;
		if (run.conversationKey.startsWith("bot:")) await openBot(id, target);
		else if (useStore.getState().groups.some((g) => g.groupId === id))
			useStore.setState({ view: { kind: "group", groupId: id }, searchTarget: target });
		else throw new Error(t("Unavailable conversation"));
		onNavigate();
	};
	return (
		<details className="usage-panel" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
			<summary>{t("Usage and tasks")}</summary>
			<p className="muted">{t("Recorded model usage on this Mac. Estimates are not invoices; unreported requests may be missing.")}</p>
			<button type="button" disabled={pending} onClick={() => setRefresh((n) => n + 1)}>
				{t("Refresh usage")}
			</button>
			{pending && <p role="status">{t("Loading…")}</p>}
			{failed && <p role="alert">{t("Could not load usage")}</p>}
			{result && (
				<>
					<h3>{t("Bot total")}</h3>
					<UsageNumbers usage={result.total} />
					<h3>{t("Recent tasks")}</h3>
					{!result.runs.length && <p>{t("No recorded tasks yet")}</p>}
					{result.runs.map((run) => (
						<details className="usage-run" key={run.runId}>
							<summary>
								<span>
									{t(
										run.state === "completed"
											? "Completed"
											: run.state === "failed"
												? "Failed"
												: run.state === "cancelled"
													? "Stopped"
													: run.state === "queued"
														? "Queued"
														: run.state === "needs_attention"
															? "Needs attention"
															: "Working",
									)}
								</span>
								<time>{new Date(run.createdAt).toLocaleString(language)}</time>
							</summary>
							<small className="usage-id">{run.runId}</small>
							<UsageNumbers usage={run.usage} />
							{run.usage.models.map((model) => (
								<div className="usage-model" key={model.modelKey}>
									<strong>{model.modelKey}</strong>
									<span>
										{t(
											model.source === "configured"
												? "Local configuration"
												: model.source === "builtin"
													? "Pi catalog"
													: "Source unavailable",
										)}
									</span>
									<span>{t("{count} recorded tokens", { count: model.totalTokens })}</span>
									<span>
										{t("Input {input} · Output {output} · Cache read {read} · Cache write {write}", {
											input: model.input,
											output: model.output,
											read: model.cacheRead,
											write: model.cacheWrite,
										})}
									</span>
									{model.reasoning !== undefined && <span>{t("Reasoning {count} (included in output)", { count: model.reasoning })}</span>}
									<span>{cost(model.estimatedUsd)}</span>
								</div>
							))}
							{run.usage.truncated && <p>{t("Only the first 100 models are shown. Totals include all models.")}</p>}
							<div className="usage-links">
								<button type="button" onClick={() => void navigate(run).catch(report)}>
									{t("Open conversation")}
								</button>
								{run.references.map((ref, index) => (
									<button
										type="button"
										key={`${ref.kind}:${ref.messageId}:${index}`}
										title={ref.approvalId}
										onClick={() => void navigate(run, ref.messageId).catch(report)}
									>
										{t(ref.kind === "result" ? "View result" : ref.kind === "tool" ? "View tool activity" : "View approval")}
										{ref.approvalState && ` · ${t(ref.approvalState)}`}
									</button>
								))}
							</div>
							{!run.references.length && <p className="muted">{t("Result details are unavailable")}</p>}
							{run.referencesTruncated && <p>{t("More evidence is available in the conversation")}</p>}
						</details>
					))}
				</>
			)}
		</details>
	);
}
function cost(value: number | undefined) {
	return value === undefined ? t("Cost unavailable") : t("Estimated USD {amount}", { amount: value.toFixed(6) });
}
function UsageNumbers({ usage }: { usage: UsageSummary }) {
	return (
		<div className="usage-numbers">
			<strong>{usage.available ? t("{count} recorded tokens", { count: usage.totalTokens }) : t("Usage unavailable")}</strong>
			<span>{cost(usage.estimatedUsd)}</span>
		</div>
	);
}
