import { t } from "../../i18n";
import { useStore } from "../../store";

export function Home({ onNew }: { onNew: () => void }) {
	const bots = useStore((state) => state.bots);
	return (
		<div className="home">
			<h1>{t("Meet your teammates")}</h1>
			<p>
				{t(
					"A Bot is a long-lived teammate with one job. Give it a name and a role, then message it like a colleague. Every Bot works on this Mac.",
				)}
			</p>
			<button type="button" className="primary" onClick={onNew}>
				{t(bots.length === 0 ? "Create your first Bot" : "Create a Bot")}
			</button>
		</div>
	);
}
