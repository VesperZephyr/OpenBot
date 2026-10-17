import { ModelSetup } from "./ModelSetup";
/**
 * First-launch setup: choose a provider, store its key in the Keychain, test a real request, set the default model,
 * then meet a first Bot. Custom (OpenAI-compatible) endpoints are written to the model configuration file through the
 * Host; their key goes to the Keychain under the provider ID, never into the file.
 */
import { useState } from "react";
import { api, openBot, refreshBots, report, useStore } from "./store";

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
	return <div className="onboarding-step"><h1>Welcome to OpenBot</h1><p className="muted">Choose how your Bots think. You can change models any time.</p><ModelSetup onDone={onDone} /></div>;
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
