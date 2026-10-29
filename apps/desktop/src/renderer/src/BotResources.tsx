import { useEffect, useRef, useState } from "react";
import type { ArtifactRef, Routine, RoutineChange, RoutineProposal } from "@openbot/protocol";
import { api, errorMessage, refreshRoutines, useStore } from "./store";
import { t } from "./i18n";
import { routineScheduleLabel } from "./Routines";
import { ArtifactCard } from "./ArtifactCard";
import "./bot-resources.css";

export function RoutineProposalCard({ proposal }: { proposal: RoutineProposal }) {
	return <section className="routine-proposal" aria-label={t("Proposed routine")}>
		<p className="muted">{t("Proposed routine")}</p>
		<h3>{proposal.fields.name}</h3>
		<p>{routineScheduleLabel(proposal.fields.schedule)}</p>
		<p>{t("Review and confirm to start this schedule.")}</p>
		<button onClick={() => useStore.setState({ view: { kind: "routines", botId: proposal.botId, proposal } })}>{t("Review routine")}</button>
	</section>;
}

export function BotRoutines({ botId, onClose }: { botId: string; onClose: () => void }) {
	const list = useStore(s => s.routines);
	const language = useStore(s => s.settings?.language ?? "en");
	const [error, setError] = useState("");
	const [review, setReview] = useState<{ routine: Routine; change: RoutineChange }>();
	const [busy, setBusy] = useState(false);
	useEffect(() => { void refreshRoutines().catch(e => setError(errorMessage(e))); }, []);
	const routines = list?.routines.filter(r => r.botId === botId) ?? [];
	const confirm = async () => {
		if (!review || busy) return;
		setBusy(true); setError("");
		try {
			await api["routines.change"](review.change);
			await refreshRoutines();
			setReview(undefined);
		} catch (e) { setError(errorMessage(e)); }
		finally { setBusy(false); }
	};
	return <section className="bot-resources" aria-label={t("Bot routines")}>
		<h2>{t("Routines")}</h2>
		<p className="muted">{t("Ask this Bot in chat to create a routine. Manage its schedules here.")}</p>
		<p className="muted">{t("Runs while OpenBot is open and your Mac is awake. Every tool keeps its existing permissions.")}</p>
		{error && <p role="alert">{t(error)}</p>}
		{list?.absencePaused && <p role="status">{t("Routines paused after inactivity")}</p>}
		{!list && !error && <p role="status">{t("Loading…")}</p>}
		{list && !routines.length && <div className="bot-resource-empty"><p>{t("No routines yet")}</p><button onClick={onClose}>{t("Back to chat")}</button></div>}
		{routines.map(r => <div className="bot-routine-row" key={r.routineId}>
			<button className="bot-routine-open" onClick={() => { onClose(); useStore.setState({ view: { kind: "routines", botId, routineId: r.routineId } }); }}>
				<strong>{r.name}</strong><span>{routineScheduleLabel(r.schedule)}</span>
				<small>{t(r.enabled ? "Scheduled" : "Paused")}{r.enabled && !list?.absencePaused ? ` · ${t("Next run")}: ${new Date(r.nextAt).toLocaleString(language, r.schedule.kind === "interval" ? undefined : { timeZone: r.schedule.timezone })}` : ""}</small>
				{(r.destinationBlocked || r.inputsBlocked) && <small>{t("Needs attention")}</small>}
			</button>
			<button className="routine-switch" role="switch" aria-checked={r.enabled} aria-label={t("Enable {name}", { name: r.name })} disabled={busy} onClick={() => setReview({ routine: r, change: { action: r.enabled ? "pause" : "resume", requestId: crypto.randomUUID(), routineId: r.routineId, expectedRevision: r.revision } })}><span /></button>
		</div>)}
		{review && <section className="routine-toggle-review" role="alertdialog" aria-label={t("Review routine")}>
			<h3>{review.routine.name}</h3>
			<p>{t(review.change.action === "pause" ? "Pause this routine and stop pending work?" : "Resume from the next scheduled time? Paused times will be skipped.")}</p>
			<button disabled={busy} onClick={() => setReview(undefined)}>{t("Cancel")}</button>
			<button disabled={busy} onClick={() => void confirm()}>{t("Confirm routine change")}</button>
		</section>}
	</section>;
}

export function BotLibrary({ botId, onClose }: { botId: string; onClose: () => void }) {
	const [query, setQuery] = useState("");
	const [items, setItems] = useState<readonly ArtifactRef[]>([]);
	const [next, setNext] = useState<number>();
	const [busy, setBusy] = useState(true), [error, setError] = useState("");
	const [refresh, setRefresh] = useState(0);
	const generation = useRef(0);
	useEffect(() => {
		const token = ++generation.current;
		setItems([]); setNext(undefined); setBusy(true); setError("");
		void api["artifacts.list"]({ offset: 0, query, botId, source: "result" })
			.then(result => { if (generation.current === token) { setItems(result.items); setNext(result.nextOffset); } })
			.catch(e => { if (generation.current === token) setError(errorMessage(e)); })
			.finally(() => { if (generation.current === token) setBusy(false); });
		return () => { generation.current++; };
	}, [botId, query, refresh]);
	const more = async () => {
		if (busy || next === undefined) return;
		const token = generation.current;
		setBusy(true); setError("");
		try {
			const result = await api["artifacts.list"]({ offset: next, query, botId, source: "result" });
			if (generation.current === token) { setItems(old => [...old, ...result.items.filter(a => !old.some(b => b.artifactId === a.artifactId))]); setNext(result.nextOffset); }
		} catch (e) { if (generation.current === token) setError(errorMessage(e)); }
		finally { if (generation.current === token) setBusy(false); }
	};
	return <section className="bot-resources" aria-label={t("Bot library")}>
		<h2>{t("Library")}</h2>
		<p className="muted">{t("Files this Bot has created and shared with you, including routine results.")}</p>
		<div className="bot-library-filter"><input type="search" value={query} maxLength={200} aria-label={t("Search generated files")} placeholder={t("Search generated files")} onChange={e => setQuery(e.target.value)} /><button disabled={busy} onClick={() => setRefresh(n => n + 1)}>{t("Refresh files")}</button></div>
		{error && <p role="alert">{t(error)}</p>}
		{!busy && !error && !items.length && <p className="bot-resource-empty">{t(query ? "No matching files" : "No generated files yet. Ask this Bot to create a file or report.")}</p>}
		{items.map(artifact => <ArtifactCard key={artifact.artifactId} artifact={artifact} onOpen={onClose} />)}
		{busy && <p role="status">{t("Loading files…")}</p>}
		{next !== undefined && <button disabled={busy} onClick={() => void more()}>{t("Load more")}</button>}
	</section>;
}
