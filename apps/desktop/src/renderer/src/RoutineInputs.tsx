import type { Routine, RoutineOccurrence, RoutineReportInputs } from "@openbot/protocol";
import { t } from "./i18n";
import { useStore } from "./store";
import { Markdown } from "./markdown";

export function ReportInputsEditor({ value, sources, onChange }: {
	value: RoutineReportInputs | undefined;
	sources: readonly Routine[];
	onChange: (value?: RoutineReportInputs) => void;
}) {
	return <fieldset className="routine-inputs">
		<legend>{t("Report inputs")}</legend>
		<label className="routine-input-option"><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked ? { sources: [], windowHours: 24, waitMinutes: 20 } : undefined)} />{t("Use reports from other routines")}</label>
		{value && <>
			<p className="muted">{t("Choose source tasks in this group. Their reports are provided automatically; no daily message is needed.")}</p>
			{!sources.length && <p>{t("Create an ordinary report routine in this group first.")}</p>}
			{sources.map((r) => <label className="routine-input-option" key={r.routineId}>
				<input type="checkbox" checked={value.sources.some((s) => s.routineId === r.routineId)} disabled={value.sources.length >= 6 && !value.sources.some((s) => s.routineId === r.routineId)} onChange={(e) => onChange({ ...value, sources: e.target.checked ? [...value.sources, { routineId: r.routineId, revision: r.revision }] : value.sources.filter((s) => s.routineId !== r.routineId) })} />{r.name}
			</label>)}
			{value.sources.filter((ref) => !sources.some((s) => s.routineId === ref.routineId)).map((ref) => <label className="routine-input-option" key={ref.routineId}>
				<input type="checkbox" checked onChange={() => onChange({ ...value, sources: value.sources.filter((s) => s.routineId !== ref.routineId) })} />{t("Unavailable source routine")}
			</label>)}
			<label>{t("Report window (hours)")}<input type="number" min={1} max={72} required value={value.windowHours} onChange={(e) => onChange({ ...value, windowHours: Number(e.target.value) })} /></label>
			<label>{t("Wait for late reports (minutes)")}<input type="number" min={0} max={60} required value={value.waitMinutes} onChange={(e) => onChange({ ...value, waitMinutes: Number(e.target.value) })} /></label>
			<p className="muted">{t("After the wait, publish once with missing or failed inputs clearly identified. Source changes require confirmation again.")}</p>
		</>}
	</fieldset>;
}
export function ReportInputsSummary({ inputs, routines }: { inputs: RoutineReportInputs; routines: readonly Routine[] }) {
	const bots = useStore((s) => s.bots);
	return <section aria-label={t("Selected report inputs")}>
		<h3>{t("Report inputs")}</h3>
		<ul>{inputs.sources.map((ref) => {
			const source = routines.find((r) => r.routineId === ref.routineId);
			return <li key={ref.routineId}>{source?.name ?? t("Unavailable source routine")} {source && `· ${bots.find((b) => b.botId === source.botId)?.name ?? t("Unavailable Bot")}`}</li>;
		})}</ul>
		<p>{t("Previous {hours} hours; wait up to {minutes} minutes", { hours: inputs.windowHours, minutes: inputs.waitMinutes })}</p>
	</section>;
}
export function ReportInputResult({ occurrence }: { occurrence: RoutineOccurrence }) {
	const language = useStore((s) => s.settings?.language ?? "en");
	const snapshot = occurrence.inputSnapshot;
	if (!occurrence.reportInputs) return null;
	if (!snapshot) return <p role="status">{t(occurrence.state === "pending" && !occurrence.stopped ? "Waiting for source reports" : "Report inputs were not captured")}</p>;
	const ready = snapshot.entries.filter((e) => e.status === "ready").length;
	return <section aria-label={t("Captured report inputs")}>
		<h3>{t("Captured report inputs")}</h3>
		<p>{t("Inputs ready: {ready}/{total}", { ready, total: snapshot.entries.length })} · {t(ready === snapshot.entries.length ? "Complete inputs" : "Partial inputs")}</p>
		<p className="muted">{new Date(snapshot.windowStart).toLocaleString(language)} → {new Date(snapshot.windowEnd).toLocaleString(language)}</p>
		<ul>{snapshot.entries.map((entry) => <li key={entry.routineId}>
			<strong>{entry.name}</strong> · {t(entry.status === "needs_attention" ? "Needs attention" : entry.status[0]!.toUpperCase() + entry.status.slice(1))}
			{entry.test && <span> · {t("Test")}</span>}
			{entry.scheduledAt && <p className="muted">{new Date(entry.scheduledAt).toLocaleString(language)}</p>}
			{entry.postId && occurrence.reportTo && <button onClick={() => useStore.setState({ view: { kind: "group", groupId: occurrence.reportTo!.groupId }, searchTarget: { conversationKey: `group:${occurrence.reportTo!.groupId}`, messageId: entry.postId!, nonce: crypto.randomUUID() } })}>{t("Open source report")}</button>}
			{entry.truncated && <p>{t("Source text was truncated")}</p>}
			{entry.text && <details><summary>{t("Captured report")}</summary><Markdown text={entry.text} /></details>}
		</li>)}</ul>
	</section>;
}
