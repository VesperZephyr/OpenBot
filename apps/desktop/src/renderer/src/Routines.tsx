import { ReportInputsEditor, ReportInputsSummary, ReportInputResult } from "./RoutineInputs";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ConversationSnapshot, Routine, RoutineChange, RoutineDetail, RoutineFields, RoutineSchedule } from "@openbot/protocol";
import { api, errorMessage, refreshRoutines, refreshSkills, useStore } from "./store";
import { t } from "./i18n";
import { ArtifactCard } from "./ArtifactCard";
import { Markdown } from "./markdown";
import "./routines.css";
const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const empty = (): RoutineFields => ({
	name: "",
	instructions: "",
	schedule: { kind: "daily", time: "09:00", timezone: zone },
	catchUpHours: 24,
	skills: [],
});
export function routineScheduleLabel(schedule: RoutineSchedule): string {
	if (schedule.kind === "interval") return t("Every {minutes} minutes", { minutes: schedule.minutes });
	return `${schedule.kind === "daily" ? t("Daily") : `${t("Weekly")} · ${t(weekdays[schedule.weekday - 1]!)}`} · ${schedule.time} · ${schedule.timezone}`;
}
export function RoutinesPanel({ renderTranscript }: { renderTranscript: (snapshot: ConversationSnapshot,occurrenceId:string) => ReactNode }) {
	const language = useStore((s) => s.settings?.language ?? "en");
	const view = useStore((s) => s.view);
	const groups = useStore((s) => s.groups);
	const scopedBotId = view.kind === "routines" ? view.botId : undefined;
	const proposal = view.kind === "routines" ? view.proposal : undefined;
	const initialGroup = view.kind === "routines" ? groups.find((g) => g.groupId === view.groupId && g.status === "active") : undefined;
	const list = useStore((s) => s.routines),
		bots = useStore((s) => s.bots),
		skills = useStore((s) => s.skills),
		host = useStore((s) => s.host.status);
	const [selected, setSelected] = useState<string | undefined>(view.kind === "routines" ? view.routineId : undefined),
		[occurrence, setOccurrence] = useState<string | undefined>(view.kind === "routines" ? view.occurrenceId : undefined),
		[detail, setDetail] = useState<RoutineDetail>();
	const [draft, setDraft] = useState<RoutineFields | undefined>(() => proposal ? proposal.fields : initialGroup ? { ...empty(), reportTo: { groupId: initialGroup.groupId, groupRevision: initialGroup.deliveryRevision ?? initialGroup.revision } } : undefined),
		[botId, setBotId] = useState(() => scopedBotId ?? (initialGroup ? bots.find((b) => b.status === "active" && initialGroup.memberIds.includes(b.botId))?.botId ?? "" : "")),
		[revision, setRevision] = useState(0);
	const [review, setReview] = useState<RoutineChange | undefined>(() => proposal ? { action: "create", ...proposal } : undefined),
		[confirmTest, setConfirmTest] = useState(false),
		[busy, setBusy] = useState(false),
		[error, setError] = useState<string>();
	const [absence, setAbsence] = useState(7),
		[reload, setReload] = useState(0);
	const resultElement = useRef<HTMLElement | null>(null);
	const generation = useRef(0),
		testRequest = useRef<string | undefined>(undefined);
	useEffect(() => {
		void Promise.all([refreshRoutines(), refreshSkills()]).catch((e) => setError(errorMessage(e)));
	}, []);
	useEffect(() => {
		if (list) setAbsence(list.absenceDays);
	}, [list?.absenceDays]);
	useEffect(() => {
		const token = ++generation.current;
		let reading = false;
		if (!selected) {
			setDetail(undefined);
			return;
		}
		const read = async () => {
			if (reading) return;
			reading = true;
			try {
				const value = await api["routines.get"]({ routineId: selected, ...(occurrence ? { occurrenceId: occurrence } : {}) });
				if (token === generation.current) setDetail(value);
			} catch (e) {
				if (token === generation.current) setError(errorMessage(e));
			} finally {
				reading = false;
			}
		};
		void read();
		const timer = setInterval(() => void read(), 1000);
		return () => {
			generation.current++;
			clearInterval(timer);
		};
	}, [selected, occurrence, host, reload]);
	const work = async (fn: () => Promise<unknown>) => {
		if (busy) return;
		setBusy(true);
		setError(undefined);
		try {
			await fn();
			await refreshRoutines();
			setReload((n) => n + 1);
		} catch (e) {
			setError(errorMessage(e));
		} finally {
			setBusy(false);
		}
	};
	const choose = (id?: string) => {
		setSelected(id);
		setOccurrence(undefined);
		if (id !== selected || occurrence !== undefined) setDetail(undefined);
		setDraft(undefined);
		setReview(undefined);
		setConfirmTest(false);
		testRequest.current = undefined;
		setError(undefined);
	};
	const edit = (r?: Routine) => {
		setDraft(
			r ? { name: r.name, instructions: r.instructions, schedule: r.schedule, catchUpHours: r.catchUpHours, skills: r.skills,
				...(r.reportInputs ? { reportInputs: { ...r.reportInputs, sources: r.reportInputs.sources.map((ref) => ({ ...ref, revision: (() => { const source = list?.routines.find((s) => s.routineId === ref.routineId); return source ? source.executionRevision ?? source.revision : ref.revision; })() })) } } : {}),
				...(r.reportTo ? { reportTo: { ...r.reportTo, groupRevision: (() => { const group = groups.find((g) => g.groupId === r.reportTo?.groupId); return group ? group.deliveryRevision ?? group.revision : r.reportTo.groupRevision; })() } } : {}) } : empty(),
		);
		setBotId(r?.botId ?? scopedBotId ?? bots.find((b) => b.status === "active")?.botId ?? "");
		setRevision(r?.revision ?? 0);
		setReview(undefined);
	};
	const field = <K extends keyof RoutineFields>(key: K, value: RoutineFields[K]) =>
		setDraft((previous) => (previous ? { ...previous, [key]: value } : previous));
	const confirm = () =>
		void work(async () => {
			if (!review) return;
			const r = await api["routines.change"](review);
			choose(r.deleted ? undefined : r.routineId);
		});
	const change = (action: "pause" | "resume" | "delete") => {
		if (detail)
			setReview({ action, requestId: crypto.randomUUID(), routineId: detail.routine.routineId, expectedRevision: detail.routine.revision });
	};
	const selectedOccurrence =
		detail?.history.find((o) => o.occurrenceId === occurrence) ??
		detail?.history.find((o) => o.state === "running" || o.state === "pending");
	const destinationName = (fields: RoutineFields) => fields.reportTo ? groups.find((g) => g.groupId === fields.reportTo?.groupId)?.name ?? t("Unavailable group") : t("Bot's private chat");
	const destinationValid = !draft?.reportTo || groups.some((g) => g.groupId === draft.reportTo?.groupId && g.status === "active" && (g.deliveryRevision ?? g.revision) === draft.reportTo.groupRevision && g.memberIds.includes(botId));
	useEffect(() => {
		if (selectedOccurrence) resultElement.current?.scrollIntoView({ block: "nearest" });
	}, [selectedOccurrence?.occurrenceId]);
	const visibleRoutines = (list?.routines ?? []).filter((r) => !scopedBotId || r.botId === scopedBotId);
	const sourceRoutines = (list?.routines ?? []).filter((r) => r.routineId !== selected && r.enabled && !r.deleted && !r.destinationBlocked && !r.inputsBlocked && !r.reportInputs && r.reportTo?.groupId === draft?.reportTo?.groupId && r.reportTo?.groupRevision === draft?.reportTo?.groupRevision);
	const inputsValid = !draft?.reportInputs || (!!draft.reportTo && draft.reportInputs.sources.length > 0 && draft.reportInputs.sources.every((ref) => sourceRoutines.some((r) => r.routineId === ref.routineId && (r.executionRevision ?? r.revision) === ref.revision)));

	return (
		<section className="routine-panel" aria-label={t("Routines")}>
			<header className="routine-heading">
				<div>
					<p className="routine-eyebrow">{t("ON YOUR MAC")}</p>
					<h1>{t("Routines")}</h1>
					<p>{t("Set a rhythm. Your Bot brings back the result.")}</p>
				</div>
				{!scopedBotId && <button
					disabled={busy}
					onClick={() => {
						choose();
						edit();
					}}
				>
					{t("New routine")}
				</button>}
			</header>
			<p className="muted">{t("Runs while OpenBot is open and your Mac is awake. Every tool keeps its existing permissions.")}</p>
			<details className="routine-presence">
				<summary>{t("Inactivity protection")}</summary>
				<label>
					{t("Pause schedules after days away")}
					<input
						aria-label={t("Pause schedules after days away")}
						type="number"
						min="1"
						max="30"
						value={absence}
						onChange={(e) => setAbsence(Number(e.target.value))}
					/>
				</label>
				<button disabled={busy} onClick={() => void work(() => api["routines.presence"]({ absenceDays: absence, resume: false }))}>
					{t("Save")}
				</button>
			</details>
			{list?.absencePaused && (
				<div role="status" className="routine-notice">
					<p>{t("Routines paused after inactivity")}</p>
					<button disabled={busy} onClick={() => void work(() => api["routines.presence"]({ absenceDays: absence, resume: true }))}>
						{t("Resume schedules from now")}
					</button>
				</div>
			)}
			{!!list?.scheduler?.faults.length && (
				<div role="alert" className="message-error">
					<p>{t("Scheduled work needs attention. Other tasks continue; failed tasks retry automatically.")}</p>
					{list.scheduler.faults.map((fault) => <p key={fault.key}>{list.routines.find((r) => r.routineId === fault.routineId)?.name ?? t("Scheduler")} · {t("Next retry")}: {new Date(fault.retryAt).toLocaleTimeString()}</p>)}
				</div>
			)}
			{error && (
				<p role="alert" className="message-error">
					{t(error)}
				</p>
			)}
			<div className="routine-layout">
				<nav aria-label={t("Saved routines")}>
					{!visibleRoutines.length && <p className="muted">{t("No routines yet. Start with a report you already trust.")}</p>}
					{visibleRoutines.map((r) => (
						<button
							key={r.routineId}
							disabled={busy}
							aria-current={selected === r.routineId ? "true" : undefined}
							onClick={() => choose(r.routineId)}
						>
							<strong>{r.name}</strong>
							<span>
								{bots.find((b) => b.botId === r.botId)?.name} · {t(r.enabled ? "Scheduled" : "Paused")}
							</span>
							<small>{routineScheduleLabel(r.schedule)}</small>
						</button>
					))}
				</nav>
				<div className="routine-workspace">
					{review ? (
						<section className="routine-review" aria-label={t("Review routine")}>
							<h2>{t("Review routine")}</h2>
							{"fields" in review ? (
								<>
									<h3>{review.fields.name}</h3>
									<p>
										{t("Bot")}: {bots.find((b) => b.botId === botId)?.name}
									</p>
									<p>{routineScheduleLabel(review.fields.schedule)}</p>
									<p>{t("Send reports to")}: {destinationName(review.fields)}</p>
									{review.fields.reportTo && <p className="muted">{t("The report and its files will be visible to every group member. Reports do not wake other Bots.")}</p>}
									{review.fields.reportTo && <p>{t("Members")}: {groups.find((g) => g.groupId === review.fields.reportTo?.groupId)?.memberIds.map((id) => bots.find((b) => b.botId === id)?.name ?? id).join(", ")}</p>}
									{review.fields.reportInputs && <ReportInputsSummary inputs={review.fields.reportInputs} routines={list?.routines ?? []} />}
									<p className="routine-workflow">{review.fields.instructions}</p>
									<p>{t("Catch up within {hours} hours", { hours: review.fields.catchUpHours })}</p>
									{review.fields.skills.map((s) => (
										<p key={s.name}>
											/{s.name} · v{s.revision}
										</p>
									))}
								</>
							) : (
								<p>
									{t(
										review.action === "delete"
											? "Delete this routine? Pending work will stop. Completed actions are not undone."
											: review.action === "pause"
												? "Pause this routine and stop pending work?"
												: "Resume from the next scheduled time? Paused times will be skipped.",
									)}
								</p>
							)}
							<p className="muted">{t("Confirmation saves the schedule. Future writes may still need approval.")}</p>
							<div className="routine-actions">
								<button disabled={busy} onClick={() => setReview(undefined)}>
									{t("Back")}
								</button>
								<button disabled={busy} onClick={confirm}>
									{t("Confirm routine change")}
								</button>
							</div>
						</section>
					) : draft ? (
						<form
							onSubmit={(e) => {
								e.preventDefault();
								setReview(
									revision && selected
										? { action: "update", requestId: crypto.randomUUID(), routineId: selected, expectedRevision: revision, fields: draft }
										: { action: "create", requestId: proposal && JSON.stringify(draft) === JSON.stringify(proposal.fields) ? proposal.requestId : crypto.randomUUID(), botId, fields: draft },
								);
							}}
						>
							<h2>{t(revision ? "Edit routine" : "New routine")}</h2>
							<label>
								{t("Routine name")}
								<input required maxLength={80} value={draft.name} onChange={(e) => field("name", e.target.value)} />
							</label>
							<label>
								{t("Send reports to")}
								<select aria-label={t("Send reports to")} value={draft.reportTo?.groupId ?? ""} onChange={(e) => {
									const group = groups.find((g) => g.groupId === e.target.value);
									setDraft((previous) => {
										if (!previous) return previous;
										const { reportTo: _reportTo, reportInputs: _inputs, ...fields } = previous;
										return group ? { ...fields, reportTo: { groupId: group.groupId, groupRevision: group.deliveryRevision ?? group.revision } } : fields;
									});
								}}>
									<option value="">{t("Bot's private chat")}</option>
									{draft.reportTo && !groups.some((g) => g.status === "active" && g.groupId === draft.reportTo?.groupId && g.memberIds.includes(botId)) && <option value={draft.reportTo.groupId} disabled>{t("Unavailable group")}</option>}
									{groups.filter((g) => g.status === "active" && g.memberIds.includes(botId)).map((g) => <option key={g.groupId} value={g.groupId}>{g.name}</option>)}
								</select>
							</label>
							{!destinationValid && <p role="alert">{t("Report destination changed. Edit the routine to confirm its group again.")}</p>}
							<label>
								{t("Bot")}
								<select aria-label={t("Bot")} value={botId} disabled={!!revision || !!scopedBotId} onChange={(e) => setBotId(e.target.value)}>
									{bots
										.filter((b) => b.status === "active")
										.map((b) => (
											<option key={b.botId} value={b.botId}>
												{b.name}
											</option>
										))}
								</select>
							</label>
							{draft.reportTo && <ReportInputsEditor value={draft.reportInputs} sources={sourceRoutines} onChange={(value) => setDraft((previous) => {
								if (!previous) return previous;
								const { reportInputs: _inputs, ...rest } = previous;
								return value ? { ...rest, reportInputs: value } : rest;
							})} />}
							{!inputsValid && <p role="alert">{t("Select available source routines before reviewing.")}</p>}
							<label>
								{t("Workflow")}
								<textarea
									required
									maxLength={16384}
									rows={6}
									placeholder={t("Describe the sources, steps, expected result and what to do when data is missing.")}
									value={draft.instructions}
									onChange={(e) => field("instructions", e.target.value)}
								/>
							</label>
							<div className="routine-form-row">
								<label>
									{t("Frequency")}
									<select
										aria-label={t("Frequency")}
										value={draft.schedule.kind}
										onChange={(e) =>
											field(
												"schedule",
												e.target.value === "interval"
													? { kind: "interval", minutes: 60 }
													: e.target.value === "weekly"
														? { kind: "weekly", time: "09:00", timezone: zone, weekday: 1 }
														: { kind: "daily", time: "09:00", timezone: zone },
											)
										}
									>
										<option value="daily">{t("Daily")}</option>
										<option value="weekly">{t("Weekly")}</option>
										<option value="interval">{t("Interval")}</option>
									</select>
								</label>
								{draft.schedule.kind === "interval" ? (
									<label>
										{t("Minutes between runs")}
										<input
											type="number"
											required
											min={5}
											max={10080}
											value={draft.schedule.minutes}
											onChange={(e) => field("schedule", { kind: "interval", minutes: Number(e.target.value) })}
										/>
									</label>
								) : (
									<>
										<label>
											{t("Local time")}
											<input
												required
												type="time"
												value={draft.schedule.time}
												onChange={(e) => {
													if (draft.schedule.kind !== "interval") field("schedule", { ...draft.schedule, time: e.target.value });
												}}
											/>
										</label>
										{draft.schedule.kind === "weekly" && (
											<label>
												{t("Weekday")}
												<select
													aria-label={t("Weekday")}
													value={draft.schedule.weekday}
													onChange={(e) => {
														if (draft.schedule.kind === "weekly") field("schedule", { ...draft.schedule, weekday: Number(e.target.value) });
													}}
												>
													{["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d, i) => (
														<option key={d} value={i + 1}>
															{t(d)}
														</option>
													))}
												</select>
											</label>
										)}
									</>
								)}
							</div>
							{draft.schedule.kind !== "interval" && (
								<label>
									{t("Time zone")}
									<input
										required
										value={draft.schedule.timezone}
										onChange={(e) => {
											if (draft.schedule.kind !== "interval") field("schedule", { ...draft.schedule, timezone: e.target.value });
										}}
									/>
								</label>
							)}
							<label>
								{t("Catch-up window in hours")}
								<input
									type="number"
									min={0}
									max={72}
									required
									aria-label={t("Catch-up window in hours")}
									value={draft.catchUpHours}
									onChange={(e) => field("catchUpHours", Number(e.target.value))}
								/>
								<small>
									{t("After sleep or restart, run only the latest missed occurrence within this window. Zero disables catch-up.")}
								</small>
							</label>
							<fieldset>
								<legend>{t("Pinned skills · up to two")}</legend>
								{skills
									?.filter((s) => s.available && !s.deleted)
									.map((s) => (
										<label className="routine-check" key={s.name}>
											<input
												type="checkbox"
												checked={draft.skills.some((r) => r.name === s.name)}
												disabled={!draft.skills.some((r) => r.name === s.name) && draft.skills.length >= 2}
												onChange={(e) =>
													field(
														"skills",
														e.target.checked
															? [...draft.skills, { name: s.name, revision: s.revision, sha256: s.sha256 }]
															: draft.skills.filter((r) => r.name !== s.name),
													)
												}
											/>
											/{s.name} · v{s.revision}
										</label>
									))}
								{!skills?.length && <span className="muted">{t("No saved skills")}</span>}
							</fieldset>
							<div className="routine-actions">
								<button type="button" onClick={() => setDraft(undefined)}>
									{t("Cancel")}
								</button>
								<button disabled={busy || !botId || !destinationValid || !inputsValid}>{t("Review routine")}</button>
							</div>
						</form>
					) : detail ? (
						<>
							<header className="routine-detail-heading">
								<div>
									<h2>{detail.routine.name}</h2>
									<p>{routineScheduleLabel(detail.routine.schedule)}</p>
								</div>
								<span className="routine-status">
									{t(detail.routine.deleted ? "Deleted" : detail.routine.enabled ? "Scheduled" : "Paused")}
								</span>
							</header>
							<p className="routine-workflow">{detail.routine.instructions}</p>
							{detail.routine.reportInputs && <ReportInputsSummary inputs={detail.routine.reportInputs} routines={list?.routines ?? []} />}
							{detail.routine.inputsBlocked && <p role="status">{t("Source routines changed. Edit this routine to confirm its report inputs again.")}</p>}
							<p>{t("Send reports to")}: {destinationName(detail.routine)}</p>
							{detail.routine.reportTo && <button onClick={() => useStore.setState({ view: { kind: "group", groupId: detail.routine.reportTo!.groupId }, searchTarget: undefined })}>{t("Open group")}</button>}
							{detail.routine.destinationBlocked && <p role="status">{t("Report destination changed. Edit the routine to confirm its group again.")}</p>}
							<p className="muted">{t("Catch up within {hours} hours", { hours: detail.routine.catchUpHours })}</p>
							{detail.routine.skills.map((s) => (
								<span className="skill-chip" key={s.name}>
									/{s.name} · v{s.revision}
								</span>
							))}
							{detail.routine.enabled && (
								<p className="muted">
									{t("Next run")}: {new Date(detail.routine.nextAt).toLocaleString(language)}
								</p>
							)}
							<div className="routine-actions" hidden={detail.routine.deleted}>
								<button disabled={busy} onClick={() => edit(detail.routine)}>
									{t("Edit routine")}
								</button>
								<button
									disabled={busy || detail.routine.destinationBlocked || detail.routine.inputsBlocked || !!detail.history.find((o) => o.state === "running" || o.state === "pending")}
									onClick={() => {
										testRequest.current = crypto.randomUUID();
										setConfirmTest(true);
									}}
								>
									{t("Test run")}
								</button>
								<button disabled={busy || detail.routine.destinationBlocked || detail.routine.inputsBlocked} onClick={() => change(detail.routine.enabled ? "pause" : "resume")}>
									{t(detail.routine.enabled ? "Pause routine" : "Resume routine")}
								</button>
								<button disabled={busy} onClick={() => change("delete")}>
									{t("Delete routine")}
								</button>
							</div>
							{confirmTest && (
								<section className="routine-notice" aria-label={t("Confirm test run")}>
									<p>{t("This test performs real work now, with the same tool permissions and approval expiry as a scheduled run.")}</p>
									<button disabled={busy} onClick={() => setConfirmTest(false)}>
										{t("Cancel")}
									</button>
									<button
										disabled={busy}
										onClick={() =>
											void work(async () => {
												const o = await api["routines.test"]({
													routineId: detail.routine.routineId,
													expectedRevision: detail.routine.revision,
													requestId: testRequest.current!,
												});
												setOccurrence(o.occurrenceId);
												setConfirmTest(false);
											})
										}
									>
										{t("Run now")}
									</button>
								</section>
							)}
							<section className="routine-history" aria-label={t("Run history")}>
								<h3>{t("Run history")}</h3>
								<p className="muted">{t("Latest 20 finished runs. One pending run per routine.")}</p>
								{!detail.history.length && <p>{t("No runs yet")}</p>}
								{detail.history.map((o) => (
									<button
										key={o.occurrenceId}
										aria-current={selectedOccurrence?.occurrenceId === o.occurrenceId ? "true" : undefined}
										onClick={() => setOccurrence(o.occurrenceId)}
									>
										<span>
											{new Date(o.scheduledAt).toLocaleString(language)} {o.test ? `· ${t("Test")}` : ""}
										</span>
										<strong>{t(o.state === "needs_attention" ? "Needs attention" : o.state[0]!.toUpperCase() + o.state.slice(1))}{(o.destinationBlocked || o.inputsBlocked) ? ` · ${t("Report not delivered")}` : ""}</strong>
									</button>
								))}
							</section>
							{selectedOccurrence && (
								<section ref={resultElement} className="routine-result" aria-label={t("Routine result")}>
									<h3>{t("Routine result")}</h3>
									{["pending", "running"].includes(selectedOccurrence.state) && (
										<button
											disabled={busy}
											onClick={() => void work(() => api["routines.stop"]({ occurrenceId: selectedOccurrence.occurrenceId }))}
										>
											{t("Stop routine run")}
										</button>
									)}
									<ReportInputResult occurrence={selectedOccurrence} />
									{selectedOccurrence.reason && <p>{t(selectedOccurrence.reason)}</p>}
									{selectedOccurrence.report && <Markdown text={selectedOccurrence.report} />}{" "}
									{selectedOccurrence.artifacts?.map((a) => (
										<ArtifactCard key={a.artifactId} artifact={a} />
									))}
									{detail.snapshot && (
										<details open={["pending", "running"].includes(selectedOccurrence.state)}>
											<summary>{t("Execution details")}</summary>
											{renderTranscript(detail.snapshot,selectedOccurrence.occurrenceId)}
										</details>
									)}
								</section>
							)}
						</>
					) : (
						<div className="routine-empty">
							<h2>{t("A useful task, on a schedule.")}</h2>
							<p>{t("Choose a Bot, describe the work, then choose when and where its reports arrive.")}</p>
						</div>
					)}
				</div>
			</div>
		</section>
	);
}
