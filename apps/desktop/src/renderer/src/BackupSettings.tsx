import { useEffect, useState } from "react";
import type { BackupResult } from "@openbot/protocol";
import { t } from "./i18n";
import { errorMessage } from "./store";
export function BackupSettings() {
	const [busy, setBusy] = useState(false),
		[error, setError] = useState<string>(),
		[result, setResult] = useState<BackupResult>();
	async function run(action: "export" | "restore") {
		setBusy(true);
		setError(undefined);
		setResult(undefined);
		try {
			const value = await window.openbot.backup(action);
			if (value) {
				setResult(value);
				if (action === "restore") {
					sessionStorage.setItem("openbot.restore-result", JSON.stringify(value));
					localStorage.removeItem("openbot.pending-template-import.v1");
					await window.openbot.reloadAfterRestore();
				}
			}
		} catch (e) {
			setError(errorMessage(e));
		} finally {
			setBusy(false);
		}
	}
	return (
		<section className="backup-settings" aria-label={t("Backup and restore")}>
			<h2>{t("Backup and restore")}</h2>
			<p className="muted">
				{t("Save conversations, memories, schedules, attachments, skills and execution records. Restore on this Mac and account.")}
			</p>
			<p className="muted">
				{t("Backups contain private data without encryption. Model credentials, browser profiles and workspace originals are excluded.")}
			</p>
			<div className="backup-actions">
				<button disabled={busy} onClick={() => void run("export")}>
					{t("Create backup")}
				</button>
				<button disabled={busy} onClick={() => void run("restore")}>
					{t("Restore backup")}
				</button>
			</div>
			{busy && <p role="status">{t("Preparing backup maintenance… Work will stay paused afterward.")}</p>}
			{error && (
				<p role="alert" className="error">
					{error}
				</p>
			)}
			{result?.action === "export" && (
				<div role="status">
					<p>{t("Backup saved. Work remains paused; resume when ready.")}</p>
					<p className="muted">{result.path}</p>
					<p>
						{result.files} {t("files")}
					</p>
				</div>
			)}
		</section>
	);
}

export function RestoreNotice() {
	const [result, setResult] = useState<BackupResult | undefined>(() => {
		const saved = sessionStorage.getItem("openbot.restore-result");
		try {
			return saved ? JSON.parse(saved) : undefined;
		} catch {
			return undefined;
		}
	});
	useEffect(() => {
		sessionStorage.removeItem("openbot.restore-result");
	}, []);
	return result ? (
		<div role="status" className="banner restore-notice">
			<p>{t("Backup restored. Work remains paused; review before resuming.")}</p>
			{result.rollbackPath && (
				<p>
					{t("Previous data saved to")}: {result.rollbackPath}
				</p>
			)}
			<button onClick={() => setResult(undefined)}>{t("Dismiss")}</button>
		</div>
	) : null;
}
