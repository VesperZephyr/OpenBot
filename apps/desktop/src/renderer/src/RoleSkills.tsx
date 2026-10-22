import { useEffect, useState } from "react";
import type { SkillRef, SkillSummary, SkillVersion } from "@openbot/protocol";
import { api, errorMessage } from "./store";
import { t } from "./i18n";

/** Selection changes only after the owner inspects an exact revision. Saving belongs to Profile's CAS. */
export function RoleSkills({ value, onChange, disabled }: {
	value: readonly SkillRef[]; onChange: (refs: readonly SkillRef[]) => void; disabled: boolean;
}) {
	const [library, setLibrary] = useState<readonly SkillSummary[]>([]);
	const [preview, setPreview] = useState<SkillVersion>();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	useEffect(() => {
		let current = true;
		api["skills.list"]({}).then(items => { if (current) setLibrary(items); }).catch(error => { if (current) setError(errorMessage(error)); });
		return () => { current = false; };
	}, []);
	const inspect = async (ref: SkillRef): Promise<void> => {
		setBusy(true); setError(""); setPreview(undefined);
		try {
			const detail = await api["skills.get"]({ name: ref.name, revision: ref.revision });
			if (detail.current.sha256 !== ref.sha256) throw new Error("Selected skill is unavailable; review your selection");
			setPreview(detail.current);
		} catch (error) { setError(errorMessage(error)); }
		finally { setBusy(false); }
	};
	return <section className="role-skills" aria-label={t("Role skills")}>
		<strong>{t("Role skills")}</strong>
		<p className="field-hint">{t("Choose up to two reviewed methods for direct chats. Exact versions stay pinned; groups and routines keep their own selections. Skills do not grant tool access.")}</p>
		{value.length === 0 && <p className="field-hint">{t("No role defaults. Attach a skill to individual messages when needed.")}</p>}
		{value.map(ref => {
			const latest = library.find(item => item.name === ref.name);
			return <div className="role-skill-row" key={ref.name}>
				<span>/{ref.name} · v{ref.revision}</span>
				<button type="button" disabled={disabled || busy} onClick={() => void inspect(ref)} aria-label={t("Inspect pinned {name}", { name: ref.name })}>{t("Inspect pinned version")}</button>
				<button type="button" disabled={disabled || busy} onClick={() => { onChange(value.filter(item => item.name !== ref.name)); setPreview(undefined); }} aria-label={t("Remove role skill {name}", { name: ref.name })}>{t("Remove")}</button>
				{(!latest || latest.deleted || !latest.available) && <span className="field-hint">{t("Unavailable. Remove this default before sending new messages.")}</span>}
				{latest && latest.revision !== ref.revision && latest.available && !latest.deleted && <span className="field-hint">{t("A newer version is available. Preview it below to adopt it.")}</span>}
			</div>;
		})}
		<label className="field"><span>{t("Preview a skill version")}</span>
			<select aria-label={t("Preview a skill version")} value="" disabled={disabled || busy} onChange={event => { const skill = library.find(item => item.name === event.target.value); if (skill) void inspect(skill); }}>
				<option value="">{t("Choose a method to inspect")}</option>
				{library.filter(item => item.available && !item.deleted).map(item => <option key={item.name} value={item.name}>/{item.name} · v{item.revision} — {item.description}</option>)}
			</select>
		</label>
		{preview && <div className="role-skill-preview" role="region" aria-label={t("Role skill preview")}>
			<strong>/{preview.name} · v{preview.revision}</strong>
			<pre>{preview.markdown}</pre>
			<p className="field-hint">SHA-256: {preview.sha256}</p>
			<button type="button" disabled={disabled || !preview.available || preview.deleted || (value.length >= 2 && !value.some(ref => ref.name === preview.name))} onClick={() => {
				onChange([...value.filter(ref => ref.name !== preview.name), { name: preview.name, revision: preview.revision, sha256: preview.sha256 }]);
				setPreview(undefined);
			}}>{t("Use this revision")}</button>
		</div>}
		<p className="field-hint">{t("Save profile to apply these defaults to future messages. Accepted tasks keep their methods. Start a new topic to leave old methods out of chat context.")}</p>
		{error && <p role="alert">{t(error)}</p>}
	</section>;
}
