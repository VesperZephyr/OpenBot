import { t } from "../../i18n";

export const profileConflictExplanation = "This Bot was just changed elsewhere.";

export function ProfileConflictNotice({
	onReload,
	onKeepEditing,
}: {
	readonly onReload: () => void;
	readonly onKeepEditing: () => void;
}) {
	return (
		<div className="identity-alert" role="alert">
			<p>{t(profileConflictExplanation)}</p>
			<button type="button" onClick={onReload}>
				{t("Reload profile")}
			</button>
			<button type="button" onClick={onKeepEditing}>
				{t("Keep editing")}
			</button>
		</div>
	);
}
