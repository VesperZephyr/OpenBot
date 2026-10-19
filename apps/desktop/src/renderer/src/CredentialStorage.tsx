import { useEffect, useState } from "react";
import type { CredentialMigration, CredentialStatus } from "@openbot/protocol";
import { api, refreshSettings, useStore } from "./store";
import { t } from "./i18n";

export function CredentialStorage() {
	const providers = useStore((state) => state.settings?.providers);
	const [status, setStatus] = useState<CredentialStatus>();
	const [result, setResult] = useState<CredentialMigration>();
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		let active = true;
		void api["credentials.status"]({}).then(
			(value) => {
				if (active) {
					setStatus(value);
					setFailed(false);
				}
			},
			() => {
				if (active) setFailed(true);
			},
		);
		return () => {
			active = false;
		};
	}, [providers]);
	const migrate = async () => {
		setBusy(true);
		setFailed(false);
		setResult(undefined);
		try {
			const value = await api["credentials.migrate"]({});
			setResult(value);
			setStatus(value.status);
			await refreshSettings();
		} catch {
			setFailed(true);
		} finally {
			setBusy(false);
		}
	};
	return (
		<div className="settings-group" aria-label={t("Credential storage")}>
			<h2>{t("Credential storage")}</h2>
			<p className="muted">{t("OpenBot stores credentials in your Mac’s Keychain.")}</p>
			<p role="status">
				{failed
					? t("Credential operation is unconfirmed. Refresh and retry.")
					: !status
						? t("Checking credential storage…")
						: status.availability === "metadata_error"
							? t("Credential metadata is missing or damaged. Restore the local indexes before retrying.")
							: status.availability === "unavailable"
								? t("Keychain access is unavailable. Unlock your Keychain or re-enter affected credentials.")
								: t("Credential storage is ready.")}
			</p>
			{status && status.availability !== "metadata_error" ? (
				<p className="muted">
					{t("Saved: {saved}. Legacy entries: {legacy}. Need migration: {pending}.", {
						saved: status.configuredCount,
						legacy: status.legacyCount,
						pending: status.migrationRequired,
					})}
				</p>
			) : null}
			{status && status.legacyCount > 0 ? (
				<>
					<p>
						{t(
							"Migrate saved credentials explicitly. If access is blocked, re-enter the value in its credential form. Legacy entries remain until cleanup is confirmed.",
						)}
					</p>
					<button type="button" disabled={busy} onClick={() => void migrate()}>
						{t(busy ? "Migrating credentials…" : "Migrate saved credentials")}
					</button>
				</>
			) : null}
			<button
				type="button"
				disabled={busy}
				onClick={() => {
					void api["credentials.status"]({}).then(
						(value) => {
							setStatus(value);
							setFailed(false);
						},
						() => setFailed(true),
					);
				}}
			>
				{t("Refresh credential status")}
			</button>
			{result ? (
				<p role="status">
					{t("Migrated: {migrated}. Blocked: {blocked}. Cleanup pending: {cleanup}.", {
						migrated: result.migrated,
						blocked: result.blocked,
						cleanup: result.cleanupPending,
					})}
				</p>
			) : null}
		</div>
	);
}
