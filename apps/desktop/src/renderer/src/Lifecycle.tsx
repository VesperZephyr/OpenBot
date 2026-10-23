import type { RunRecord } from "@openbot/protocol";
import { useState } from "react";
import { api, report, useStore, refreshLifecycle, openBot } from "./store";
import { t } from "./i18n";
import "./lifecycle.css";
export function LifecycleControls({ contextual = false }: { contextual?: boolean }) {
	const state = useStore((s) => s.lifecycle),
		[busy, setBusy] = useState(false),
		[resumed, setResumed] = useState(false);
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
	if (contextual && !blocked) return null;
	return (
		<section className="lifecycle-controls" aria-label={t("Work controls")}>
			{resumed && !blocked && <p role="status">{t("Work ready. Use Continue task on interrupted conversations.")}</p>}
			{blocked && (
				<div role="status">
					<strong>{t(label)}</strong>
					<p>{t("Queued messages are retained. Interrupted actions will not restart automatically.")}</p>
					{state?.error && <p>{t(state.error)}</p>}
				</div>
			)}
			{!contextual && <span className="local-target"><span aria-hidden="true" />{t("On this Mac")}</span>}
			<button
				type="button"
				disabled={unavailable}
				onClick={() => {
					setBusy(true);
					setResumed(false);
					void api[blocked ? "lifecycle.resume" : "lifecycle.pause"]({})
						.then(async () => {
							await refreshLifecycle();
							setResumed(blocked);
						})
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
	const lifecycle = useStore((s) => s.lifecycle),
		blocked = lifecycle?.blocked ?? true,
		[busy, setBusy] = useState(false);
	const unavailable =
		!lifecycle || lifecycle.transitioning || !lifecycle.nativeReady || lifecycle.locked || lifecycle.suspended || lifecycle.quitting || !run.interruption?.settledAt;
	const explanation = !run.interruption?.settledAt || lifecycle?.transitioning
		? "Waiting for actions to stop…"
		: !lifecycle?.nativeReady
			? "Checking Mac session"
			: lifecycle.locked
				? "Unlock your Mac to continue."
				: lifecycle.suspended
					? "Wake your Mac to continue."
					: lifecycle.quitting ? "Open the app again to continue." : undefined;
	return (
		<li className="interrupted-run" role="status">
			<strong>{t(run.interruption?.reason==="permission_revoked"?"Permission revoked":"Task interrupted")}</strong>
			<p>{t("Review completed actions before continuing. An interrupted action may have partly run.")}</p>
			{explanation && <p>{t(explanation)}</p>}
			{blocked && !unavailable && <p>{t("This also resumes queued work across your Bots.")}</p>}
			<button
				type="button"
				disabled={unavailable || busy}
				onClick={() => {
					setBusy(true);
					void (async () => {
						if (blocked) await api["lifecycle.resume"]({});
						await refreshLifecycle();
						return api["runs.continue"]({ runId: run.runId, requestId: `continue:${run.runId}` });
					})()
						.then(() => openBot(run.botId))
						.catch(report)
						.finally(() => setBusy(false));
				}}
			>
				{t(busy ? "Continuing…" : blocked ? "Resume and continue" : "Continue task")}
			</button>
		</li>
	);
}
