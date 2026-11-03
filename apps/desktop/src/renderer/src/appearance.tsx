import { useState } from "react";
import { t } from "./i18n";
import { report } from "./store";
import { AppearanceChoices } from "./ui/appearance-choices";

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
		<AppearanceChoices
			legend={t("Appearance")}
			value={value}
			onChange={choose}
			options={([ ["light", "Light"], ["dark", "Dark"], ["system", "System"] ] as const).map(([mode, label]) => ({ value: mode, label: t(label) }))}
		/>
	);
}
