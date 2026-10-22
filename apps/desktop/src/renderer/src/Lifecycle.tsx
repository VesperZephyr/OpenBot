import type { RunRecord } from "@openbot/protocol";
import { useState } from "react";
import { api, report, useStore, refreshLifecycle, openBot } from "./store";
import { t } from "./i18n";
import "./lifecycle.css";
export function LifecycleControls() {
	const state = useStore((s) => s.lifecycle),
		[busy, setBusy] = useState(false);
	const blocked = state?.blocked === true;
	const label = state?.transitioning
		? "Stopping work"
		: !state?.nativeReady
			? "Checking Mac session"
			: state.locked
				? "Mac locked"
				: state.suspended
					? "Mac sleeping"
					: blocked
						? "Work paused"
						: "Work ready";
	const unavailable =
		!state || busy || state.transitioning || (blocked && (!state.nativeReady || state.locked || state.suspended || state.quitting));
	return (
		<section className="lifecycle-controls" aria-label={t("Work controls")}>
			{blocked && (
				<div role="status">
					<strong>{t(label)}</strong>
					<p>{t("Queued messages are retained. Interrupted actions will not restart automatically.")}</p>
					{state?.error && <p>{t(state.error)}</p>}
				</div>
			)}
			<span className="local-target"><span aria-hidden="true" />{t("On this Mac")}</span>
			<button
				type="button"
				disabled={unavailable}
				onClick={() => {
					setBusy(true);
					void api[blocked ? "lifecycle.resume" : "lifecycle.pause"]({})
						.then(() => refreshLifecycle())
						.catch(report)
						.finally(() => setBusy(false));
				}}
			>
				{t(blocked ? "Resume work" : "Pause all")}
			</button>
		</section>
	);
}
export function InterruptedRun({ run }: { run: RunRecord }) {
	const blocked = useStore((s) => s.lifecycle?.blocked ?? true),
		[busy, setBusy] = useState(false);
	return (
		<li className="interrupted-run" role="status">
			<strong>{t(run.interruption?.reason==="permission_revoked"?"Permission revoked":"Task interrupted")}</strong>
			<p>{t("Review completed actions before continuing. An interrupted action may have partly run.")}</p>
			<button
				type="button"
				disabled={blocked || busy || !run.interruption?.settledAt}
				onClick={() => {
					setBusy(true);
					void api["runs.continue"]({ runId: run.runId, requestId: `continue:${run.runId}` })
						.then(() => openBot(run.botId))
						.catch(report)
						.finally(() => setBusy(false));
				}}
			>
				{t("Continue task")}
			</button>
		</li>
	);
}
