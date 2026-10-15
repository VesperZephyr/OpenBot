/**
 * First-launch setup: choose a provider, store its key in the Keychain, test a real request, set the default model,
 * then meet a first Bot. Custom (OpenAI-compatible) endpoints are written to the model configuration file through the
 * Host; their key goes to the Keychain under the provider ID, never into the file.
 */
import { type FormEvent, useMemo, useState } from "react";
import { api, openBot, refreshBots, refreshSettings, report, useStore } from "./store";

type Preset = {
	readonly id: string;
	readonly name: string;
	readonly hint: string;
	/** Models offered first, in order; the first one that exists is preselected. */
	readonly suggested: readonly string[];
};

const PRESETS: readonly Preset[] = [
	{ id: "anthropic", name: "Anthropic", hint: "Claude models, with a key from console.anthropic.com", suggested: ["claude-sonnet-4-6", "claude-sonnet-4-5"] },
	{ id: "openai", name: "OpenAI", hint: "GPT models, with a key from platform.openai.com", suggested: ["gpt-5-mini", "gpt-5"] },
	{ id: "openrouter", name: "OpenRouter", hint: "Many providers behind one key from openrouter.ai", suggested: ["anthropic/claude-sonnet-4.6", "openai/gpt-5-mini"] },
];

const OTHER = "other";

type Role = { readonly name: string; readonly role: string; readonly instructions: string; readonly blurb: string };

const ROLES: readonly Role[] = [
	{
		name: "Atlas",
		role: "Research",
		blurb: "Searches the web, reads sources, and writes cited reports.",
		instructions:
			"Research questions thoroughly. Prefer primary sources, cite every page you used, and say what you could not verify. Save longer reports in the workspace.",
	},
	{
		name: "Forge",
		role: "Coding",
		blurb: "Reads and edits code in your projects and runs their tests.",
		instructions:
			"Work on code in the workspace. Read before you edit, keep changes small, run the tests after every change, and report what you changed and how you checked it.",
	},
	{
		name: "Quill",
		role: "Writing",
		blurb: "Drafts and edits documents in your voice.",
		instructions:
			"Draft and edit writing. Ask about audience and length when unclear, keep the user's voice, and save drafts as Markdown files in the workspace.",
	},
];

type Step = { readonly kind: "provider" } | { readonly kind: "bot" };

export function Onboarding() {
	const [step, setStep] = useState<Step>({ kind: "provider" });
	return (
		<div className="onboarding">
			<div className="onboarding-card">
				{step.kind === "provider" ? <ProviderStep onDone={() => setStep({ kind: "bot" })} /> : <FirstBotStep />}
			</div>
		</div>
	);
}

function ProviderStep({ onDone }: { readonly onDone: () => void }) {
	const models = useStore((state) => state.models);
	const [choice, setChoice] = useState<string>(PRESETS[0]!.id);
	const [apiKey, setApiKey] = useState("");
	const [modelId, setModelId] = useState<string | undefined>(undefined);
	const [custom, setCustom] = useState({ name: "", baseUrl: "", modelId: "" });
	const [status, setStatus] = useState<{ readonly kind: "idle" | "testing" } | { readonly kind: "failed"; readonly error: string }>({
		kind: "idle",
	});

	const preset = PRESETS.find((candidate) => candidate.id === choice);
	const presetModels = useMemo(() => models.filter((model) => model.provider === choice), [models, choice]);
	const selectedModel =
		modelId ?? preset?.suggested.find((id) => presetModels.some((model) => model.modelId === id)) ?? presetModels[0]?.modelId;
	const customId = providerIdFor(custom.name);
	// pi-ai's OpenAI-compatible client sends every request with a key; local servers accept any placeholder.
	const ready =
		apiKey.trim() !== "" &&
		(preset !== undefined
			? selectedModel !== undefined
			: custom.name.trim() !== "" && custom.baseUrl.trim() !== "" && custom.modelId.trim() !== "" && customId !== undefined);

	const submit = async (event: FormEvent): Promise<void> => {
		event.preventDefault();
		if (!ready || status.kind === "testing") return;
		const key = apiKey.trim();
		// The key must not linger in renderer state once it was handed to the Host.
		setApiKey("");
		setStatus({ kind: "testing" });
		try {
			let model: { provider: string; modelId: string };
			if (preset !== undefined && selectedModel !== undefined) {
				await api["credentials.set"]({ providerId: preset.id, apiKey: key });
				model = { provider: preset.id, modelId: selectedModel };
			} else if (customId !== undefined) {
				await api["models.addProvider"]({
					id: customId,
					name: custom.name.trim(),
					baseUrl: custom.baseUrl.trim(),
					api: "openai-completions",
					modelIds: [custom.modelId.trim()],
				});
				await api["credentials.set"]({ providerId: customId, apiKey: key });
				model = { provider: customId, modelId: custom.modelId.trim() };
			} else {
				return;
			}
			const result = await api["models.test"](model);
			if (!result.ok) {
				setStatus({ kind: "failed", error: result.error ?? "The model did not answer" });
				return;
			}
			await api["settings.update"]({ defaultModel: model });
			await refreshSettings();
			onDone();
		} catch (error) {
			setStatus({ kind: "failed", error: error instanceof Error ? error.message : String(error) });
		}
	};

	return (
		<form className="onboarding-step" onSubmit={submit} aria-label="Choose a model">
			<h1>Welcome to OpenBot</h1>
			<p className="muted">Bots think with a model you choose. Pick a provider and paste its API key; it is stored in the macOS Keychain.</p>
			<div className="provider-choices" role="radiogroup" aria-label="Provider">
				{[...PRESETS.map((candidate) => ({ id: candidate.id, name: candidate.name, hint: candidate.hint })), { id: OTHER, name: "Other", hint: "Any OpenAI-compatible endpoint" }].map(
					(candidate) => (
						<button
							key={candidate.id}
							type="button"
							role="radio"
							aria-checked={choice === candidate.id}
							className={`provider-choice ${choice === candidate.id ? "is-selected" : ""}`}
							onClick={() => {
								setChoice(candidate.id);
								setModelId(undefined);
								setStatus({ kind: "idle" });
							}}
						>
							<span className="provider-choice-name">{candidate.name}</span>
							<span className="provider-choice-hint">{candidate.hint}</span>
						</button>
					),
				)}
			</div>

			{preset === undefined && (
				<>
					<label className="field">
						<span>Name</span>
						<input value={custom.name} placeholder="My server" onChange={(event) => setCustom({ ...custom, name: event.target.value })} />
					</label>
					<label className="field">
						<span>Base URL</span>
						<input
							value={custom.baseUrl}
							placeholder="http://localhost:11434/v1"
							onChange={(event) => setCustom({ ...custom, baseUrl: event.target.value })}
						/>
					</label>
					<label className="field">
						<span>Model ID</span>
						<input value={custom.modelId} placeholder="llama3.3" onChange={(event) => setCustom({ ...custom, modelId: event.target.value })} />
					</label>
				</>
			)}
			{preset !== undefined && (
				<label className="field">
					<span>Model</span>
					<select value={selectedModel ?? ""} onChange={(event) => setModelId(event.target.value)}>
						{presetModels.map((model) => (
							<option key={model.modelId} value={model.modelId}>
								{model.name}
							</option>
						))}
					</select>
				</label>
			)}
			<label className="field">
				<span>API key</span>
				<input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
			</label>

			{status.kind === "failed" && (
				<div className="onboarding-error" role="alert">
					The test request failed: {status.error}
				</div>
			)}
			<div className="dialog-actions">
				<button type="submit" className="primary" disabled={!ready || status.kind === "testing"}>
					{status.kind === "testing" ? "Testing…" : "Test and continue"}
				</button>
			</div>
		</form>
	);
}

function FirstBotStep() {
	const [busy, setBusy] = useState(false);
	const create = async (role: Role): Promise<void> => {
		setBusy(true);
		try {
			const bot = await api["bots.create"]({ requestId: crypto.randomUUID(), name: role.name, role: role.role, instructions: role.instructions });
			useStore.setState({ onboarding: false });
			await refreshBots();
			await openBot(bot.botId);
		} catch (error) {
			report(error);
			setBusy(false);
		}
	};
	return (
		<div className="onboarding-step" aria-label="Meet your first Bot">
			<h1>Meet your first Bot</h1>
			<p className="muted">A Bot is a long-lived teammate with one job. Start with one of these; you can rename it and change its job any time.</p>
			<div className="role-choices">
				{ROLES.map((role) => (
					<button key={role.role} type="button" className="role-choice" disabled={busy} onClick={() => void create(role)}>
						<span className="role-choice-name">
							{role.name} · {role.role}
						</span>
						<span className="role-choice-blurb">{role.blurb}</span>
					</button>
				))}
			</div>
			<div className="dialog-actions">
				<button type="button" onClick={() => useStore.setState({ onboarding: false })}>
					Skip for now
				</button>
			</div>
		</div>
	);
}

/** A provider ID from the name the user typed: lower-case letters, digits, dots, dashes; `undefined` when none remain. */
function providerIdFor(name: string): string | undefined {
	const id = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^[-._]+|[-._]+$/g, "")
		.slice(0, 64);
	return id === "" ? undefined : id;
}
