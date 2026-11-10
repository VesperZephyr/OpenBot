import { t } from "../i18n";
import { useStore } from "../store";

const labels: Record<string, string> = {
	name: "Name",
	role: "Role",
	instructions: "Instructions",
	model: "Model",
	thinkingLevel: "Thinking level",
};
export const actions: Record<string, string> = { create: "Create Bot", update: "Update Bot", delete: "Delete Bot" };

export function ManagementPreview({ args }: { readonly args: Record<string, unknown> }) {
	const bots = useStore((state) => state.bots);
	const bot = bots.find((b) => b.botId === args.botId);
	return (
		<div className="management-preview">
			<strong>
				{t(actions[String(args.action)] ?? "Manage Bot")}
				{" · "}
				{String(args.name ?? bot?.name ?? args.botId ?? "")}
			</strong>
			{args.botId !== undefined && (
				<p className="muted">
					<code>{String(args.botId)}</code> · {t("Revision")} {String(args.expectedRevision)}
				</p>
			)}
			{Object.entries(labels)
				.filter(([key]) => args[key] != null)
				.map(([key, label]) => (
					<div className="management-field" key={key}>
						<span>{t(label)}</span>
						<pre>{typeof args[key] === "string" ? args[key] : args[key] === null ? t("Use default model") : JSON.stringify(args[key])}</pre>
					</div>
				))}
			{args.useDefaultModel === true && <p>{t("Use default model")}</p>}
			<p className="muted">
				{t(
					args.action === "delete"
						? "This stops the Bot's work and background commands. Local history is retained."
						: args.action === "create"
							? "Creates a Specialist with its own instructions and empty memory."
							: "Only the fields shown above will change.",
				)}
			</p>
		</div>
	);
}
