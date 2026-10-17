import { ModelSetup } from "./ModelSetup";
import { api, openBot, refreshSettings, report, useStore } from "./store";

/** First use seeds only the Core. Model setup can be completed later without creating a Specialist. */
export function Onboarding() {
	const finish = async () => {
		try {
			await api["settings.update"]({ setupComplete: true });
			await refreshSettings();
			useStore.setState({ onboarding: false });
			const core = useStore.getState().bots.find((bot) => bot.kind === "core");
			if (core) await openBot(core.botId);
		} catch (error) { report(error); }
	};
	return <div className="onboarding"><div className="onboarding-card">
		<div className="onboarding-step"><span className="eyebrow">YOUR PERSONAL BOT</span><h1>Meet OpenBot</h1>
		<p className="muted">Your Core Bot is ready. Connect a model to start working together. Create other Bots only when you need them.</p>
		<ModelSetup onDone={() => void finish()} />
		<button type="button" className="setup-skip" onClick={() => void finish()}>Set up later</button>
		</div>
	</div></div>;
}
