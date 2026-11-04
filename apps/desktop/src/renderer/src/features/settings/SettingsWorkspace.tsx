import { type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useState } from "react";
import type { ConversationSnapshot } from "@openbot/protocol";
import { BackupSettings } from "../../BackupSettings";
import { AppearanceSelect } from "../../appearance";
import { LanguageField } from "../../ui/language-field";
import { InterfaceIcon } from "../../InterfaceIcon";
import { CredentialStorage } from "../../CredentialStorage";
import { ConnectorsPanel } from "../../Connectors";
import { SkillLibrary } from "../../Skills";
import { LifecycleControls } from "../../Lifecycle";
import { RoutinesPanel } from "../../Routines";
import { WebSearchSettings } from "../../WebSearchSettings";
import { CommandSettings, FolderSettings } from "../../PolicySettings";
import { ModelSetup } from "../../ModelSetup";
import { ManagementHistory } from "../../BotManagement";
import { t } from "../../i18n";
import { api, refreshSettings, report, useStore, type View } from "../../store";
import { ModelSelect } from "../../ModelSelect";

const SETTINGS_PAGES = [
	["settings", "General", "settings"],
	["skills", "Skills", "skills"],
	["connectors", "Connect apps", "apps"],
	["routines", "Routines", "routines"],
] as const;

export type SettingsDestination = (typeof SETTINGS_PAGES)[number][0];

export function SettingsWorkspace({
	view,
	onBack,
	onSelect,
	renderTranscript,
}: {
	readonly view: Extract<View, { kind: "settings" | "skills" | "connectors" | "routines" }>;
	readonly onBack: () => void;
	readonly onSelect: (kind: SettingsDestination) => void;
	readonly renderTranscript: (snapshot: ConversationSnapshot, occurrenceId: string) => ReactNode;
}) {
	const movePage = (event: ReactKeyboardEvent<HTMLElement>): void => {
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(.back-to-chat)")];
		const index = items.indexOf(document.activeElement as HTMLButtonElement);
		if (index < 0) return;
		event.preventDefault();
		const next = items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
		next?.focus();
		next?.click();
	};
	return (
		<div className="settings-workspace">
			<nav className="settings-navigation" aria-label={t("Settings navigation")} onKeyDown={movePage}>
				<button className="back-to-chat" aria-label={t("Back to chat")} onClick={onBack}>
					← {t("Back to chat")}
				</button>
				<p className="settings-nav-title">{t("Settings")}</p>
				{SETTINGS_PAGES.map(([kind, label, icon]) => (
					<button key={kind} aria-current={view.kind === kind ? "page" : undefined} onClick={() => onSelect(kind)}>
						<InterfaceIcon name={icon} />{t(label)}
					</button>
				))}
			</nav>
			<div className="settings-content">
				{view.kind === "settings" && <Settings />}
				{view.kind === "skills" && <SkillLibrary />}
				{view.kind === "connectors" && <ConnectorsPanel />}
				{view.kind === "routines" && (
					<RoutinesPanel
						key={view.proposal?.requestId ?? view.routineId ?? view.botId ?? view.groupId ?? "all"}
						renderTranscript={renderTranscript}
					/>
				)}
			</div>
		</div>
	);
}

function Settings() {
	useEffect(() => {
		void refreshSettings().catch(report);
	}, []);
	const settings = useStore((state) => state.settings);
	const [providerId, setProviderId] = useState("openai");
	const [apiKey, setApiKey] = useState("");

	if (settings === undefined) {
		return (
			<section className="settings" aria-label={t("Settings")}>
				<header className="settings-heading">
					<h1>{t("Settings")}</h1>
				</header>
				<div className="settings-group" id="settings-models">
					<h2>{t("Default model")}</h2>
					<ModelSelect value={undefined} emptyLabel="Choose a model" onChange={() => undefined} />
				</div>
				<CredentialStorage />
			</section>
		);
	}
	const configured = settings.providers.filter((provider) => provider.configured);

	const saveKey = async (event: FormEvent): Promise<void> => {
		event.preventDefault();
		const key = apiKey;
		// Clear the field immediately: the key must not linger in renderer state.
		setApiKey("");
		try {
			await api["credentials.set"]({ providerId, apiKey: key });
			await refreshSettings();
		} catch (error) {
			report(error);
		}
	};

	return (
		<section className="settings" aria-label={t("Settings")}>
			<header className="settings-heading">
				<h1>{t("Settings")}</h1>
				<p className="muted">{t("Your models, preferences and permissions. On your Mac.")}</p>
			</header>
			<AppearanceSelect />
            <LifecycleControls />
			<nav className="settings-jump" aria-label={t("Settings sections")}>
				{[
					["models", "Models"],
					["language", "Language"],
					["permissions", "Permissions"],
					["data", "Data"],
				].map(([id, label]) => (
					<button type="button" key={id} onClick={() => document.getElementById(`settings-${id}`)?.scrollIntoView({ block: "start" })}>
						{t(label!)}
					</button>
				))}
			</nav>

			<div className="settings-group" id="settings-models">
				<h2>{t("Default model")}</h2>
				<p className="muted">{t("Bots without a model of their own use this one.")}</p>
				<ModelSelect
					value={settings.defaultModel}
					emptyLabel={configured.length === 0 ? "Add an API key below first" : "Choose a model"}
					onChange={(model) =>
						void api["settings.update"]({ defaultModel: model ?? null })
							.then(refreshSettings)
							.catch(report)
					}
				/>
				<button type="button" onClick={() => useStore.setState({ onboarding: true })}>{t("Open the setup wizard again")}</button>
			</div>

			<div className="settings-group" id="settings-language">
				<LanguageField
					label={t("Language")}
					caption={t("Changes the app interface. Your conversations and Bot instructions stay as written.")}
					value={settings.language ?? "en"}
					onChange={(language) => {
						void api["settings.update"]({ language, languageChosen: true }).then(refreshSettings).catch(report);
					}}
				/>
			</div>
			<div className="settings-group">
				<h2>{t("Connect a model")}</h2>
				<ModelSetup />
			</div>

			<div className="settings-group">
				<h2>{t("Provider credentials")}</h2>
				<p className="muted">{t("Keys are stored in the macOS Keychain and never shown again.")}</p>
				<form className="key-form" onSubmit={saveKey}>
					<select value={providerId} onChange={(event) => setProviderId(event.target.value)} aria-label={t("Provider")}>
						{settings.providers.map((provider) => (
							<option key={provider.providerId} value={provider.providerId}>
								{provider.name}
							</option>
						))}
					</select>
					<input
						type="password"
						autoComplete="off"
						value={apiKey}
						placeholder={t("API key")}
						onChange={(event) => setApiKey(event.target.value)}
						aria-label={t("API key")}
					/>
					<button type="submit" className="primary" disabled={apiKey.trim() === ""}>
						{t("Save key")}
					</button>
				</form>
				<ul className="provider-list">
					{configured.length === 0 && <li className="muted">{t("No provider keys yet.")}</li>}
					{configured.map((provider) => (
						<li key={provider.providerId}>
							<span>{provider.name}</span>
							<span className="muted">
								{t(provider.keyStored ? "Key stored" : "Key from models.json")}
								{provider.source === "config" && " · models.json"}
							</span>
							{provider.keyStored && (
								<button
									type="button"
									onClick={() => void api["credentials.delete"]({ providerId: provider.providerId }).then(refreshSettings).catch(report)}
								>
									{t("Remove")}
								</button>
							)}
						</li>
					))}
				</ul>
			</div>
			<CredentialStorage />
			<BackupSettings />
			<WebSearchSettings />
			<div id="settings-permissions">
				<CommandSettings />
			</div>
			<FolderSettings workspace={settings.workspace} />

			<div className="settings-group">
				<h2>{t("Your own providers")}</h2>
				<p className="muted">
					{t("Add OpenAI- or Anthropic-compatible endpoints in ")}
					<code>{settings.modelConfig.path}</code>
					{t(". Changes apply when you open Settings or choose a model.")}
				</p>
				{settings.providers.some((provider) => provider.source === "config" && !provider.configured) && (
					<p className="muted">
						{t("Without a key:")}{" "}
						{settings.providers
							.filter((provider) => provider.source === "config" && !provider.configured)
							.map((provider) => provider.name)
							.join(", ")}
						{t(". Save one above or fix its ")}
						<code>apiKey</code>.
					</p>
				)}
				{settings.modelConfig.errors.length > 0 && (
					<ul className="config-errors" aria-label={t("Configuration problems")}>
						{settings.modelConfig.errors.map((error) => (
							<li key={error}>{error}</li>
						))}
					</ul>
				)}
				<button type="button" onClick={() => void refreshSettings().catch(report)}>
					{t("Reload")}
				</button>
			</div>

			<ManagementHistory />
			<div className="settings-group" id="settings-data">
				<h2>{t("Data")}</h2>
				<p className="muted">
					{t("Conversations, Bot memory and operation logs are stored on this Mac in ")}
					<code>{settings.dataDirectory}</code>
					{t(
						". No automatic analytics or log uploads. Your selected model and search providers receive task-relevant input when you use them.",
					)}
				</p>
			</div>
		</section>
	);
}
