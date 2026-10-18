import { useStore } from "./store";
import { t } from "./i18n";
export function GroupPreview({ args, action }: { args: Record<string, unknown>; action: string }) {
	const bots = useStore((s) => s.bots);
	const groups = useStore((s) => s.groups);
	const name = (id: unknown) => bots.find((b) => b.botId === id)?.name ?? String(id);
	return (
		<div className="management-preview">
			<strong>{t(action === "create" ? "Create group" : action === "dissolve" ? "Dissolve group" : "Edit group")}</strong>
			<p>{String(args.name ?? groups.find((g) => g.groupId === args.groupId)?.name ?? args.groupId ?? "")}</p>
			{typeof args.objective === "string" && <p>{args.objective}</p>}
			{Array.isArray(args.memberIds) && (
				<p>
					{t("Members")}: {args.memberIds.map(name).join(", ")}
				</p>
			)}
			{args.leadBotId != null && (
				<p>
					{t("Lead")}: {name(args.leadBotId)}
				</p>
			)}
			{args.expectedRevision != null && (
				<p>
					{t("Revision")}: {String(args.expectedRevision)}
				</p>
			)}
			<p className="muted">
				{t(
					action === "dissolve"
						? "Stops all group tasks. History stays on this Mac. Bots are kept."
						: "Removed members stop receiving tasks. Other conversations are unchanged.",
				)}
			</p>
		</div>
	);
}
