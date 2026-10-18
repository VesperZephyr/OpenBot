import { t } from "./i18n";
import { type FormEvent, useState } from "react";
import { api, refreshSettings, report, useStore } from "./store";

/** Must match the Host's `TAVILY_PROVIDER_ID`; the renderer cannot import server code. */
const TAVILY_PROVIDER_ID = "search:tavily";

/** Settings → Web search: store or remove the Tavily key that `web_search` uses. */
export function WebSearchSettings() {
	const configured = useStore((state) => state.settings?.webSearch.configured ?? false);
	const [apiKey, setApiKey] = useState("");

	const save = async (event: FormEvent): Promise<void> => {
		event.preventDefault();
		const key = apiKey;
		// Clear the field immediately: the key must not linger in renderer state.
		setApiKey("");
		try {
			await api["credentials.set"]({ providerId: TAVILY_PROVIDER_ID, apiKey: key });
			await refreshSettings();
		} catch (error) {
			report(error);
		}
	};

	return (
		<div className="settings-group">
			<h2>{t("Web search")}</h2>
			<p className="muted">{t("Bots search the web through Tavily. Get a key at tavily.com; it is stored in the macOS Keychain.")}</p>
			<form className="key-form" onSubmit={save}>
				<input
					type="password"
					autoComplete="off"
					value={apiKey}
					placeholder={t(configured ? "Replace Tavily API key" : "Tavily API key")}
					onChange={(event) => setApiKey(event.target.value)}
					aria-label={t("Tavily API key")}
				/>
				<button type="submit" className="primary" disabled={apiKey.trim() === ""}>{t("Save key")}</button>
			</form>
			<ul className="provider-list">
				{configured ? (
					<li>
						<span>Tavily</span>
						<span className="muted">{t("Key stored")}</span>
						<button
							type="button"
							onClick={() =>
								void api["credentials.delete"]({ providerId: TAVILY_PROVIDER_ID }).then(refreshSettings).catch(report)
							}
						>{t("Remove")}</button>
					</li>
				) : (
					<li className="muted">{t("Not set up: Bots cannot search the web.")}</li>
				)}
			</ul>
		</div>
	);
}
