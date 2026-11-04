import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ArtifactRef, AvatarChange, BotTemplateV1 } from "@openbot/protocol";
import { AvatarEditor } from "../../AvatarEditor";
import { beginTemplateReview } from "../../BotTemplates";
import { composers } from "../../useComposer";
import { t } from "../../i18n";
import { ModelSetup } from "../../ModelSetup";
import { RadioGroup } from "../../ui/boardui/components/base/radio/radio";
import { RadioCard } from "../../ui/boardui/components/base/radio/radio-card";
import { api, connectModel, errorMessage, openBot, refreshBots, refreshSettings, report, useStore } from "../../store";
import researchTemplate from "./research-bot.json" with { type: "json" };
import { FILE_PROMPT, RECOMMENDED_PROVIDERS, WEEK_PROMPT, recommendedModelId, systemLanguage } from "./recommended";
import { PROVIDER_KEY_URLS } from "./provider-links";
import "./onboarding.css";

const STEPS = 4;
const researchBot = researchTemplate as BotTemplateV1;

/** First use seeds only the Core. Model setup can be completed later without creating a Specialist. */
export function Onboarding() {
	const settings = useStore((state) => state.settings);
	const models = useStore((state) => state.models);
	const bots = useStore((state) => state.bots);
	const core = bots.find((bot) => bot.kind === "core");
	const [step, setStep] = useState(0);
	const [languageError, setLanguageError] = useState(false);
	const [providerId, setProviderId] = useState("");
	const [modelId, setModelId] = useState("");
	const [showModels, setShowModels] = useState(false);
	const [key, setKey] = useState("");
	const [busy, setBusy] = useState(false);
	const [connectError, setConnectError] = useState("");
	const [connected, setConnected] = useState("");
	const [advanced, setAdvanced] = useState(false);
	const [modelFormMounted, setModelFormMounted] = useState(false);
	const [setupSource, setSetupSource] = useState<"builtin" | "custom">("builtin");
	const [setupKey, setSetupKey] = useState(0);
	const [name, setName] = useState(core?.name ?? "");
	const [personality, setPersonality] = useState("");
	const [avatar, setAvatar] = useState<AvatarChange>();
	const [botError, setBotError] = useState("");
	const [welcomeError, setWelcomeError] = useState("");
	const heading = useRef<HTMLHeadingElement>(null);
	const keyInput = useRef<HTMLInputElement>(null);
	const modelSelect = useRef<HTMLSelectElement>(null);
	const named = useRef(false);
	const languageApplied = useRef(false);
	const alive = useRef(true);
	const advanceTimer = useRef(0);

	useEffect(() => () => {
		alive.current = false;
		window.clearTimeout(advanceTimer.current);
	}, []);
	useEffect(() => {
		heading.current?.focus();
	}, [step]);
	useLayoutEffect(() => {
		if (showModels) modelSelect.current?.focus();
	}, [showModels]);
	useEffect(() => {
		if (named.current || !core) return;
		named.current = true;
		setName(core.name);
	}, [core]);
	const recommended = RECOMMENDED_PROVIDERS.filter((provider) => models.some((model) => model.provider === provider.id));
	const selectedId = recommended.some((provider) => provider.id === providerId) ? providerId : recommended[0]?.id ?? "";
	const available = models.filter((model) => model.provider === selectedId);
	const selectedModel = available.some((model) => model.modelId === modelId) ? modelId : recommendedModelId(selectedId, available.map((model) => model.modelId));
	const selected = available.find((model) => model.modelId === selectedModel);
	const configured = settings?.providers.find((provider) => provider.providerId === selectedId)?.configured === true;
	const hasModel = settings?.defaultModel !== undefined;
	const catalogEmpty = settings !== undefined && models.length === 0;

	const finish = async (botId?: string) => {
		try {
			await api["settings.update"]({ setupComplete: true });
			await refreshSettings();
			useStore.setState({ onboarding: false });
			const id = botId ?? useStore.getState().bots.find((bot) => bot.kind === "core")?.botId;
			if (id) await openBot(id);
		} catch (error) { report(error); }
	};
	const persistLanguage = async (language: "en" | "zh-CN", chosen: boolean) => {
		const current = useStore.getState().settings;
		if (current) useStore.setState({ settings: { ...current, language, ...(chosen ? { languageChosen: true } : {}) } });
		setLanguageError(false);
		try {
			await api["settings.update"](chosen ? { language, languageChosen: true } : { language });
			await refreshSettings();
		} catch {
			if (alive.current) setLanguageError(true);
		}
	};
	useEffect(() => {
		if (languageApplied.current || !settings) return;
		languageApplied.current = true;
		const system = systemLanguage();
		if (settings.languageChosen !== true && settings.language !== system) void persistLanguage(system, false);
	}, [settings]);
	const chooseLanguage = (language: string) => {
		if (language !== "en" && language !== "zh-CN") return;
		void persistLanguage(language, true);
	};
	const connect = async () => {
		if (busy || selectedId === "" || selectedModel === "" || (!configured && key.trim() === "")) return;
		const secret = key.trim();
		setBusy(true);
		setConnectError("");
		try {
			await connectModel({ provider: selectedId, modelId: selectedModel }, secret);
			setKey("");
			const label = selected?.name ?? selectedModel;
			setConnected(label);
			advanceTimer.current = window.setTimeout(() => {
				if (alive.current) setStep(2);
			}, 800);
		} catch (error) {
			setConnectError(errorMessage(error) || "Could not save model settings.");
		} finally {
			if (alive.current) setBusy(false);
		}
	};
	const saveProfile = async () => {
		if (!core || busy) return;
		const nextName = name.trim();
		if (nextName === "") {
			setBotError("Give this Bot a name.");
			return;
		}
		const line = personality.trim();
		const change: { name?: string; instructions?: string; avatar?: AvatarChange } = {};
		if (nextName !== core.name) change.name = nextName;
		if (line !== "") change.instructions = `${core.instructions}\n\n${line}`;
		if (avatar) change.avatar = avatar;
		if (change.name === undefined && change.instructions === undefined && change.avatar === undefined) {
			setStep(3);
			return;
		}
		setBusy(true);
		setBotError("");
		try {
			await api["bots.update"]({ botId: core.botId, expectedRevision: core.revision, ...change });
			await refreshBots();
			setStep(3);
		} catch (error) {
			const message = errorMessage(error);
			if (/Profile changed|Reload before saving/.test(message)) {
				await refreshBots();
				const fresh = useStore.getState().bots.find((bot) => bot.botId === core.botId);
				if (fresh) setName(fresh.name);
				setBotError("This Bot was just changed elsewhere. Refreshed, please try again.");
			} else setBotError(message || "Could not save Bot settings.");
		} finally {
			if (alive.current) setBusy(false);
		}
	};
	const prefill = async (text: string, attachments?: readonly ArtifactRef[]) => {
		const current = useStore.getState().bots.find((bot) => bot.kind === "core");
		if (!current) return;
		composers.edit(`bot:${current.botId}`, attachments ? { text, attachments } : { text });
		await finish();
	};
	const titles = [
		t("Welcome to OpenBot"),
		t("Connect one model"),
		t("Meet your first Bot"),
		t("Hello, I'm {name}", { name: core?.name || name || "OpenBot" }),
	];
	const title = titles[step] ?? titles[0];

	return <div className="onboarding"><div className="onboarding-card onboarding-wizard">
		<div className="onboarding-top">
			<div className="onboarding-progress" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS} aria-valuenow={step + 1} aria-label={t("Setup progress")}>
				{titles.map((_, index) => <span key={index} data-done={index <= step ? "true" : "false"} />)}
			</div>
			{step === 0 || step === 2 ? <button type="button" className="onboarding-text-button" onClick={() => void finish()}>{t("Set up later")}</button> : <span />}
		</div>
		<h1 ref={heading} tabIndex={-1}>{title}</h1>
		{step === 0 && <>
			<p className="muted">{t("Your personal Bots, running on your Mac.")}</p>
			<div className="onboarding-languages" data-openbot-ui="">
				<RadioGroup aria-label={t("Language")} value={settings?.language ?? "en"} onChange={chooseLanguage}>
					<RadioCard value="en" title="English" />
					<RadioCard value="zh-CN" title="简体中文" />
				</RadioGroup>
			</div>
			{languageError && <p className="onboarding-failure" role="alert">{t("Couldn't save language. Try again.")}</p>}
		</>}
		{step === 1 && <>
			<p className="muted">{t("Choose a provider and paste an API key. The key stays in the macOS Keychain.")}</p>
			{catalogEmpty ? <p className="onboarding-failure" role="alert">{t("Couldn't load the model catalog.")} <button type="button" onClick={() => void refreshSettings().catch(report)}>{t("Retry")}</button></p> : !advanced && <>
				<div className="onboarding-providers" role="list" aria-label={t("Recommended providers")}>
					{recommended.map((provider) => {
						const href = PROVIDER_KEY_URLS[provider.id];
						return <div key={provider.id} className="onboarding-provider-card" data-selected={provider.id === selectedId ? "true" : "false"} role="listitem">
							<button type="button" className="onboarding-provider" aria-pressed={provider.id === selectedId} disabled={busy} onClick={() => { setProviderId(provider.id); setModelId(""); setKey(""); setConnectError(""); setShowModels(false); }}>
								<strong>{provider.name}</strong>
								<span>{t(provider.blurb)}</span>
							</button>
							{href && <a href={href} target="_blank" rel="noreferrer">{t("Get API key")}</a>}
						</div>;
					})}
				</div>
				{selectedId !== "" && <div className="onboarding-key">
					<div className="onboarding-model-row">
						{configured ? <span>{t("Key saved · not tested")}</span> : null}
						<span>{t("Model")}: {selected?.name ?? selectedModel}</span>
						<button type="button" onClick={() => setShowModels(true)}>{t("Change model")}</button>
					</div>
					{showModels && <label className="field"><span>{t("Model")}</span>
						<select ref={modelSelect} aria-label={t("Model")} value={selectedModel} disabled={busy} onChange={(event) => { setModelId(event.target.value); setConnectError(""); }}>
							{available.map((model) => <option key={model.modelId} value={model.modelId}>{model.name}</option>)}
						</select>
					</label>}
					<label className="field"><span>{t("API key")}</span>
						<input ref={keyInput} type="password" autoComplete="off" value={key} disabled={busy} placeholder={t(configured ? "Keep stored credential" : "Paste your key · stored in the macOS Keychain")} onChange={(event) => { setKey(event.target.value); setConnectError(""); }} />
					</label>
				</div>}
				{connectError && <div className="onboarding-failure" role="alert">
					<p>{t(connectError)}</p>
					<div className="onboarding-recovery">
						<button type="button" onClick={() => { setKey(""); setConnectError(""); keyInput.current?.focus(); }}>{t("Check key")}</button>
						<button type="button" onClick={() => { setShowModels(true); setConnectError(""); }}>{t("Try another model")}</button>
						<button type="button" onClick={() => { setModelFormMounted(true); setSetupSource("custom"); setSetupKey((value) => value + 1); setAdvanced(true); setConnectError(""); }}>{t("Use custom or local")}</button>
					</div>
				</div>}
				{connected && <p className="onboarding-status" role="status">{t("Connected · {model} is your default", { model: connected })}</p>}
				<p className="onboarding-note">{t("Billed by the provider per use. A short test sends one very short message.")}</p>
			</>}
			<button type="button" className="onboarding-text-button" onClick={() => { setModelFormMounted(true); setAdvanced((value) => !value); setSetupSource("builtin"); }}>{t("More providers or a custom or local model")}</button>
		</>}
		{modelFormMounted && step < 2 && <div hidden={step !== 1 || !advanced}><ModelSetup key={setupKey} initialSource={setupSource} onDone={() => setStep(2)} /></div>}
		{step === 2 && core && <>
			<p className="muted">{t("This Bot helps with everyday tasks. You can add specialists later.")}</p>
			{!hasModel && <p className="onboarding-banner">{t("No model yet. Your Bot can't reply until you connect one.")} <button type="button" onClick={() => setStep(1)}>{t("Connect")}</button></p>}
			<div className="onboarding-bot">
				<AvatarEditor bot={core} role={core.role} value={avatar} onChange={setAvatar} disabled={busy} autoGenerate />
				<div className="onboarding-fields">
					<label className="field"><span>{t("Name")}</span>
						<input value={name} disabled={busy} onChange={(event) => { setName(event.target.value); setBotError(""); }} />
					</label>
					<label className="field"><span>{t("Personality in one sentence (optional)")}</span>
						<input value={personality} disabled={busy} onChange={(event) => { setPersonality(event.target.value); setBotError(""); }} />
					</label>
				</div>
			</div>
			{botError && <div className="onboarding-failure" role="alert">
				<p>{t(botError)}</p>
				<button type="button" onClick={() => setStep(3)}>{t("Skip, keep defaults")}</button>
			</div>}
		</>}
		{step === 3 && <>
			<p className="muted">{t("Opens in the composer. Nothing runs until you send it.")}</p>
			{hasModel && <p className="onboarding-status" role="status">{t("Connected · {model} is your default", { model: settings?.defaultModel ? models.find((model) => model.provider === settings.defaultModel?.provider && model.modelId === settings.defaultModel?.modelId)?.name ?? settings.defaultModel.modelId : connected })}</p>}
			<div className="onboarding-examples">
				<button type="button" className="onboarding-example" disabled={busy} onClick={() => void (hasModel ? prefill(t(WEEK_PROMPT)) : Promise.resolve(setStep(1)))}>
					<h2>{t("Plan my week")}</h2>
					<p>{t("Turn this week's to-dos into a short plan.")}</p>
					{!hasModel && <p>{t("Available after you connect a model · Connect")}</p>}
				</button>
				<button type="button" className="onboarding-example" disabled={busy} onClick={() => void (hasModel ? (async () => {
					setBusy(true);
					setWelcomeError("");
					try {
						const result = await window.openbot.attachFiles();
						if (result.errors[0]) setWelcomeError(result.errors[0]);
						if (result.attachments.length === 0) return;
						await prefill(t(FILE_PROMPT), result.attachments);
					} catch (error) {
						setWelcomeError(errorMessage(error));
					} finally {
						if (alive.current) setBusy(false);
					}
				})() : Promise.resolve(setStep(1)))}>
					<h2>{t("Summarize a file")}</h2>
					<p>{t("Choose a file and put it in the composer with the prompt. Summarizing starts when you send.")}</p>
					{!hasModel && <p>{t("Available after you connect a model · Connect")}</p>}
				</button>
				<button type="button" className="onboarding-example" disabled={busy} onClick={() => beginTemplateReview(researchBot, heading.current, (outcome, botId) => { if (outcome === "imported" && botId) void finish(botId); })}>
					<h2>{t("Create a research Bot")}</h2>
					<p>{t("Built-in template. You review permissions before import.")}</p>
				</button>
			</div>
			{welcomeError && <p className="onboarding-failure" role="alert">{t(welcomeError)}</p>}
		</>}
		<div className="onboarding-actions">
			{step > 0 ? <button type="button" className="onboarding-text-button" onClick={() => setStep((value) => value - 1)}>{t("Go back")}</button> : <span />}
			<div className="onboarding-actions-end">
				{step === 1 && !connected && <button type="button" className="onboarding-text-button" onClick={() => setStep(2)}>{t("Continue without a model")}</button>}
				{step === 0 && <button type="button" className="primary" onClick={() => setStep(1)}>{t("Continue")}</button>}
				{step === 1 && !advanced && <button type="button" className="primary" disabled={busy || selectedId === "" || selectedModel === "" || (!connected && !configured && key.trim() === "")} onClick={() => connected ? setStep(2) : void connect()}>{t(busy ? "Testing connection…" : connected ? "Continue" : "Connect")}</button>}
				{step === 2 && <button type="button" className="primary" disabled={busy} onClick={() => void saveProfile()}>{t("Looks good")}</button>}
				{step === 3 && <button type="button" className="primary" onClick={() => void finish()}>{t("Start chatting")}</button>}
			</div>
		</div>
	</div></div>;
}
