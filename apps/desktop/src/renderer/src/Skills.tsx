import { useEffect, useRef, useState } from "react";
import { validSkillDocument, type SkillDocument, type SkillDetail, type SkillChange } from "@openbot/protocol";
import { api, errorMessage, refreshSkills, useStore } from "./store";
import { t } from "./i18n";
import "./skills.css";
const labels: Record<keyof SkillDocument, string> = {
	name: "Skill name",
	description: "When to use",
	inputs: "Inputs",
	requirements: "Requirements",
	steps: "Steps",
	validation: "Validation",
	output: "Output",
	approvalBoundaries: "Approval boundaries",
};
const blank: SkillDocument = {
	name: "",
	description: "",
	inputs: "",
	requirements: "",
	steps: "",
	validation: "",
	output: "",
	approvalBoundaries: "",
};
export function SkillReview({ change, currentRevision }: { change: SkillChange; currentRevision?: number }) {
	return (
		<section className="skill-review" aria-label={t("Review skill")}>
			<header>
				<strong>/{change.name}</strong>
				<span className="skill-version">
					{currentRevision === undefined ? (
						<>
							{t("Version {revision}", { revision: change.expectedRevision })} → {change.expectedRevision + 1}
						</>
					) : (
						t("Version {revision}", { revision: currentRevision })
					)}
				</span>
			</header>
			{change.action === "delete" ? (
				<p>{t("Delete this shared skill? Accepted messages keep their selected version.")}</p>
			) : (
				Object.entries(labels)
					.filter(([key]) => key !== "name")
					.map(([key, label]) => (
						<div className="skill-section" key={key}>
							<h3>{t(label)}</h3>
							<p>{change.document[key as keyof SkillDocument]}</p>
						</div>
					))
			)}
			<p className="muted">{t("Skills guide every Bot. Tool permissions still apply.")}</p>
		</section>
	);
}
export function SkillLibrary() {
	const skills = useStore((s) => s.skills),
		host = useStore((s) => s.host);
	const [selected, setSelected] = useState<string>(),
		[detail, setDetail] = useState<SkillDetail>(),
		[draft, setDraft] = useState<SkillDocument>(),
		[review, setReview] = useState<SkillChange>(),
		[busy, setBusy] = useState(false),
		[error, setError] = useState<string>();
	const [draftRevision, setDraftRevision] = useState(0);
	const request = useRef<{ id: string; fingerprint: string } | undefined>(undefined),
		generation = useRef(0);
	const reload = () => void refreshSkills().catch((e) => setError(errorMessage(e)));
	useEffect(() => {
		reload();
	}, []);
	useEffect(() => {
		const token = ++generation.current;
		setDetail(undefined);
		if (!selected) return;
		void api["skills.get"]({ name: selected })
			.then((value) => {
				if (token === generation.current) setDetail(value);
			})
			.catch((e) => {
				if (token === generation.current) setError(errorMessage(e));
			});
		return () => {
			generation.current++;
		};
	}, [selected, skills, host.status]);
	const choose = (name?: string) => {
		setError(undefined);
		setSelected(name);
		setDraft(undefined);
		setReview(undefined);
		request.current = undefined;
	};
	const save = async () => {
		if (!review || busy) return;
		const fingerprint = JSON.stringify(review);
		if (request.current?.fingerprint !== fingerprint) request.current = { id: crypto.randomUUID(), fingerprint };
		setBusy(true);
		setError(undefined);
		try {
			const { action, ...change } = review;
			if (action === "save")
				await api["skills.save"]({
					requestId: request.current.id,
					...change,
					document: (review as Extract<SkillChange, { action: "save" }>).document,
				});
			else await api["skills.delete"]({ requestId: request.current.id, name: review.name, expectedRevision: review.expectedRevision });
			const name = review.name;
			setReview(undefined);
			setDraft(undefined);
			request.current = undefined;
			setSelected(name);
			await refreshSkills();
		} catch (e) {
			setError(errorMessage(e));
		} finally {
			setBusy(false);
		}
	};
	return (
		<section className="skill-library" aria-label={t("Skills")}>
			<header className="skill-heading">
				<div>
					<h1>{t("Skills")}</h1>
					<p>{t("Keep a method that works. Reuse it with any Bot.")}</p>
				</div>
				<button
					disabled={busy}
					onClick={() => {
						choose();
						setDraftRevision(0);
						setDraft({ ...blank });
					}}
				>
					{t("New skill")}
				</button>
			</header>
			<div className="skill-layout">
				<nav className="skill-index" aria-label={t("Skill library")}>
					<button onClick={reload}>{t("Refresh")}</button>
					{!skills ? (
						<p role="status">{t("Loading…")}</p>
					) : !skills.length ? (
						<p>{t("No skills yet. Save a useful procedure from a chat or write one here.")}</p>
					) : (
						skills.map((skill) => (
							<button
								key={skill.name}
								aria-current={selected === skill.name ? "true" : undefined}
								disabled={busy}
								onClick={() => choose(skill.name)}
							>
								<strong>/{skill.name}</strong>
								<small>
									{t("Version {revision}", { revision: skill.revision })}
									{skill.deleted ? ` · ${t("Deleted")}` : !skill.available ? ` · ${t("Unavailable")}` : ""}
								</small>
								<span>{skill.description}</span>
							</button>
						))
					)}
				</nav>
				<div className="skill-workspace">
					{error && <p role="alert">{t(error)}</p>}
					{review ? (
						<>
							<SkillReview change={review} />
							<div className="skill-actions">
								<button disabled={busy} onClick={() => setReview(undefined)}>
									{t("Back to editing")}
								</button>
								<button className="primary" disabled={busy} onClick={() => void save()}>
									{t(review.action === "delete" ? "Confirm deletion" : "Save reviewed skill")}
								</button>
							</div>
						</>
					) : draft ? (
						<form
							onSubmit={(e) => {
								e.preventDefault();
								setReview({ action: "save", name: draft.name, expectedRevision: draftRevision, document: draft });
							}}
						>
							{Object.entries(labels).map(([key, label]) => (
								<label className="skill-field" key={key}>
									<span>{t(label)}</span>
									{key === "name" ? (
										<input
											aria-label={t(label)}
											required
											pattern="[a-z0-9]+(-[a-z0-9]+)*"
											maxLength={64}
											disabled={!!selected}
											value={draft.name}
											onChange={(e) => setDraft({ ...draft, name: e.target.value })}
										/>
									) : (
										<textarea
											aria-label={t(label)}
											required
											rows={key === "steps" ? 6 : 2}
											maxLength={key === "description" ? 300 : 32768}
											value={draft[key as keyof SkillDocument]}
											onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
										/>
									)}
								</label>
							))}
							<p className="muted">
								{t("Use a short lowercase name. Write None for requirements that do not apply. Never include secrets or task data.")}
							</p>
							<div className="skill-actions">
								<button type="button" onClick={() => setDraft(undefined)}>
									{t("Cancel")}
								</button>
								<button className="primary" disabled={!validSkillDocument(draft)}>
									{t("Review changes")}
								</button>
							</div>
						</form>
					) : detail ? (
						<>
							<SkillReview
								currentRevision={detail.current.revision}
								change={{
									action: "save",
									name: detail.current.name,
									expectedRevision: Math.max(0, detail.current.revision - 1),
									document: detail.current.document,
								}}
							/>
							{!detail.current.available && !detail.current.deleted && (
								<p role="alert">{t("Skill file is unavailable. Restore the reviewed file before editing.")}</p>
							)}
							<div className="skill-actions">
								<button
									disabled={!detail.current.available && !detail.current.deleted}
									onClick={() => {
										setDraftRevision(detail.current.revision);
										setDraft({ ...detail.current.document });
									}}
								>
									{t(detail.current.deleted ? "Restore as new version" : "Edit skill")}
								</button>
								<button
									disabled={detail.current.deleted || !detail.current.available}
									onClick={() => setReview({ action: "delete", name: detail.current.name, expectedRevision: detail.current.revision })}
								>
									{t("Delete skill")}
								</button>
							</div>
							<details className="skill-history">
								<summary>{t("Version history")}</summary>
								{detail.history.map((v) => (
									<div key={v.revision}>
										{t("Version {revision}", { revision: v.revision })} · {new Date(v.updatedAt).toLocaleString()} ·{" "}
										{v.deleted ? t("Deleted") : v.sha256.slice(0, 12)}
									</div>
								))}
							</details>
						</>
					) : (
						<p className="skill-empty">{t(selected ? "Loading…" : "Select a skill to review its method and versions.")}</p>
					)}
				</div>
			</div>
		</section>
	);
}
