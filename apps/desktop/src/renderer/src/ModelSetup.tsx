import { t } from "./i18n";
import { MODEL_APIS, type ModelApi, type ModelRef } from "@openbot/protocol";
import { type FormEvent, useState } from "react";
import { api, refreshSettings, useStore } from "./store";

/** Shared setup path: catalog metadata never implies credentials or a successful connection. */
export function ModelSetup({ onDone }: { readonly onDone?: () => void }) {
	const settings = useStore((state) => state.settings);
	const models = useStore((state) => state.models);
	const [source, setSource] = useState<"builtin" | "custom">("builtin");
	const [provider, setProvider] = useState("openai");
	const [modelId, setModelId] = useState("");
	const [key, setKey] = useState("");
	const [custom, setCustom] = useState({ name: "", baseUrl: "", modelId: "", api: "openai-completions" as ModelApi });
	const [installed, setInstalled] = useState("");
	const [busy, setBusy] = useState(false);
	const [result, setResult] = useState<{ ok: boolean; message: string }>();
	const providers = settings?.providers.filter((p) => p.source === "builtin" || p.overlay) ?? [];
	const providerId = providers.some((p) => p.providerId === provider) ? provider : providers[0]?.providerId ?? "";
	const available = models.filter((m) => m.provider === providerId);
	const selectedId = available.some((m) => m.modelId === modelId) ? modelId : available[0]?.modelId ?? "";
	const selected = available.find((m) => m.modelId === selectedId);
	const configured = settings?.providers.find((p) => p.providerId === providerId)?.configured === true;
	const customId = custom.name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-._]+|[-._]+$/g, "").slice(0, 64);
	const signature = JSON.stringify(custom);
	const ready = source === "builtin" ? selectedId !== "" && (configured || key.trim() !== "") : customId !== "" && custom.baseUrl.trim() !== "" && custom.modelId.trim() !== "" && (key.trim() !== "" || installed === signature);
	const clearResult = () => setResult(undefined);
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (!ready || busy) return;
		setBusy(true);
		clearResult();
		const secret = key.trim();
		setKey("");
		try {
			let ref: ModelRef;
			if (source === "custom") {
				ref = { provider: customId, modelId: custom.modelId.trim() };
				if (installed !== signature) {
					await api["models.addProvider"]({ id: customId, name: custom.name.trim(), baseUrl: custom.baseUrl.trim(), api: custom.api, modelIds: [ref.modelId] });
					setInstalled(signature);
				}
			} else ref = { provider: providerId, modelId: selectedId };
			if (secret !== "") await api["credentials.set"]({ providerId: ref.provider, apiKey: secret });
			await refreshSettings();
			const tested = await api["models.test"](ref);
			if (!tested.ok) { setResult({ ok: false, message: tested.error ?? "Connection failed. Check your model settings." }); return; }
			await api["settings.update"]({ defaultModel: ref });
			await refreshSettings();
			setResult({ ok: true, message: "Connection tested. This is now your default model." });
			onDone?.();
		} catch (error) {
			setResult({ ok: false, message: error instanceof Error ? error.message : "Could not save model settings." });
		} finally { setBusy(false); }
	};
	return <form className="model-setup" aria-label={t("Model setup")} onSubmit={submit}>
		<div className="model-source-switch" role="radiogroup" aria-label={t("Model source")}>
			<button type="button" role="radio" aria-checked={source === "builtin"} disabled={busy} onClick={() => { setSource("builtin"); clearResult(); }}><strong>{t("Built-in models")}</strong><span>{t("Choose from the Pi catalog")}</span></button>
			<button type="button" role="radio" aria-checked={source === "custom"} disabled={busy} onClick={() => { setSource("custom"); clearResult(); }}><strong>{t("Custom provider")}</strong><span>{t("Your gateway or local model")}</span></button>
		</div>
		<fieldset disabled={busy}>
		{source === "builtin" ? <>
			<label className="field"><span>{t("Provider")}</span><select value={providerId} onChange={(e) => { setProvider(e.target.value); setModelId(""); setKey(""); clearResult(); }}>{providers.map((p) => <option key={p.providerId} value={p.providerId}>{p.name}{p.overlay ? t(" · Local override") : ""}</option>)}</select></label>
			<label className="field"><span>{t("Model")}</span><select value={selectedId} onChange={(e) => { setModelId(e.target.value); clearResult(); }}>{available.map((m) => <option key={m.modelId} value={m.modelId}>{m.name}</option>)}</select></label>
			<p className="model-caption">{t(configured ? "Credential available · Connection not tested here" : "Credential needed")}{selected?.endpoint ? ` · ${selected.endpoint}` : ""}{selected?.overridden ? t(" · Local override") : ""}</p>
			<p className="model-caption">{t("API key setup. Subscription and OAuth sign-in are not available here.")}</p>
		</> : <>
			<div className="model-form-grid">
				<label className="field"><span>{t("Name")}</span><input value={custom.name} placeholder={t("My provider")} onChange={(e) => { setCustom({ ...custom, name: e.target.value }); clearResult(); }} /></label>
				<label className="field"><span>{t("Protocol")}</span><select value={custom.api} onChange={(e) => { setCustom({ ...custom, api: e.target.value as ModelApi }); clearResult(); }}>{MODEL_APIS.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
			</div>
			<label className="field"><span>{t("Base URL")}</span><input value={custom.baseUrl} placeholder="http://localhost:11434/v1" onChange={(e) => { setCustom({ ...custom, baseUrl: e.target.value }); clearResult(); }} /></label>
			<label className="field"><span>{t("Model ID")}</span><input value={custom.modelId} placeholder={t("Model identifier from your provider")} onChange={(e) => { setCustom({ ...custom, modelId: e.target.value }); clearResult(); }} /></label>
		</>}
		<label className="field"><span>{t("API key")}</span><input type="password" autoComplete="off" value={key} placeholder={t(source === "builtin" && configured ? "Keep stored credential" : "Stored in macOS Keychain")} onChange={(e) => { setKey(e.target.value); clearResult(); }} /></label>
		{source === "custom" && <p className="model-caption">{t("For a local server without authentication, enter a placeholder such as local. Existing providers can be edited in your local configuration file.")}</p>}
		</fieldset>
		{result && <p className={result.ok ? "model-result" : "onboarding-error"} role={result.ok ? "status" : "alert"}>{t(result.message)}</p>}
		<div className="dialog-actions"><button className="primary" type="submit" disabled={!ready || busy}>{t(busy ? "Testing connection…" : onDone ? "Test and continue" : "Test and use model")}</button></div>
		<p className="model-caption">{t("Testing sends a short test message to this provider. A successful text response does not test every tool or image capability.")}</p>
	</form>;
}
