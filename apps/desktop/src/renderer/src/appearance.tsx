import { useState } from "react";
import { t } from "./i18n";
import { report } from "./store";

type Appearance = "light" | "dark" | "system";
const key = "openbot.appearance";
function read(): Appearance {
	try {
		const value = localStorage.getItem(key);
		return value === "dark" || value === "system" ? value : "light";
	} catch { return "light"; }
}
let preference = read();
const system = matchMedia("(prefers-color-scheme: dark)");
function apply() {
	document.documentElement.dataset.theme = preference === "system" ? (system.matches ? "dark" : "light") : preference;
}
apply();
system.addEventListener("change", apply);

export function AppearanceSelect() {
	const [value, setValue] = useState(preference);
	const choose = (next: Appearance) => {
		try { localStorage.setItem(key, next); } catch (error) { report(error); return; }
		preference = next;
		setValue(next);
		apply();
	};
	return (
		<fieldset className="appearance-setting">
			<legend>{t("Appearance")}</legend>
			<div className="appearance-choices">
				{([ ["light", "Light"], ["dark", "Dark"], ["system", "System"] ] as const).map(([mode, label]) => (
					<label className="appearance-choice" key={mode}>
						<input type="radio" name="appearance" value={mode} checked={value === mode} onChange={() => choose(mode)} />
						<span className={`appearance-preview preview-${mode}`} aria-hidden="true"><i /><span><b /><b /><em /></span></span>
						<span className="appearance-label">{t(label)}<span className="appearance-check" aria-hidden="true">✓</span></span>
					</label>
				))}
			</div>
		</fieldset>
	);
}
