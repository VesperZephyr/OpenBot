import { useEffect, useState } from "react";
import type { ArtifactContent, ArtifactRef } from "@openbot/protocol";
import { api, report } from "./store";
import { t } from "./i18n";
import "./artifacts.css";
// A history can contain many cards. Read metadata serially instead of flooding the executor port.
const changes = new EventTarget();
let metadataLine: Promise<unknown> = Promise.resolve();
function current(id: string): Promise<ArtifactRef> {
	const next = metadataLine.then(() => api["artifacts.get"]({ artifactId: id }));
	metadataLine = next.catch(() => {});
	return next;
}
export function ArtifactCard({ artifact, detach }: { artifact: ArtifactRef; detach?: () => void }) {
	const [ref, setRef] = useState(artifact),
		[preview, setPreview] = useState<ArtifactContent>(),
		[confirm, setConfirm] = useState(false),
		[busy, setBusy] = useState(false);
	useEffect(() => {
		let active = true;
		const refresh = () => {
			void current(artifact.artifactId)
				.then((next) => {
					if (active) {
						setRef(next);
						if (next.availability !== "available") setPreview(undefined);
					}
				})
				.catch(() => {
					if (active) setRef({ ...artifact, availability: "missing" });
				});
		};
		refresh();
		changes.addEventListener(artifact.artifactId, refresh);
		return () => {
			active = false;
			changes.removeEventListener(artifact.artifactId, refresh);
		};
	}, [artifact.artifactId]);
	const available = ref.availability === "available";
	return (
		<div className="artifact-card" data-artifact-id={ref.artifactId}>
			<div className="artifact-heading">
				<span className="artifact-icon" aria-hidden>
					↳
				</span>
				<div>
					<strong>{ref.name}</strong>
					<span className="artifact-meta">
						{Math.ceil(ref.bytes / 1024)} KB · {t(ref.source === "input" ? "Attached file" : "Result file")}
					</span>
				</div>
			</div>
			{!available && <p role="status">{t("This local copy is unavailable")}</p>}
			<div className="artifact-actions">
				<button
					type="button"
					disabled={busy || !available}
					onClick={() => {
						setBusy(true);
						void api["artifacts.preview"]({ artifactId: ref.artifactId })
							.then((value) => {
								setRef(value.artifact);
								setPreview(value);
							})
							.catch(report)
							.finally(() => setBusy(false));
					}}
				>
					{t("Preview")}
				</button>
				{!detach && (
					<button
						type="button"
						disabled={busy || !available}
						onClick={() => {
							setBusy(true);
							void window.openbot
								.exportArtifact({ artifactId: ref.artifactId, requestId: crypto.randomUUID() })
								.catch(report)
								.finally(() => setBusy(false));
						}}
					>
						{t("Export copy")}
					</button>
				)}
				{detach ? (
					<button type="button" aria-label={t("Detach {name}", { name: ref.name })} onClick={detach}>
						{t("Detach")}
					</button>
				) : (
					<button type="button" disabled={busy || ref.availability === "removed"} onClick={() => setConfirm(true)}>
						{t("Remove local copy")}
					</button>
				)}
			</div>
			{confirm && (
				<div className="artifact-confirm" role="alertdialog" aria-label={t("Remove local copy")}>
					<p>{t("This removes this copy from all its cards. Conversation records and previous model requests may retain its content.")}</p>
					<button type="button" onClick={() => setConfirm(false)}>
						{t("Cancel")}
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={() => {
							setBusy(true);
							void api["artifacts.remove"]({ requestId: crypto.randomUUID(), artifactId: ref.artifactId })
								.then(() => {
									setRef({ ...ref, availability: "removed" });
									setPreview(undefined);
									setConfirm(false);
									changes.dispatchEvent(new Event(ref.artifactId));
								})
								.catch(report)
								.finally(() => setBusy(false));
						}}
					>
						{t("Remove local copy")}
					</button>
				</div>
			)}
			{preview && available && (
				<div className="artifact-preview" role="region" aria-label={t("File preview")}>
					<button type="button" onClick={() => setPreview(undefined)}>
						{t("Close preview")}
					</button>
					{preview.base64 && ["image/png", "image/jpeg"].includes(ref.mediaType) ? (
						<img
							src={`data:${ref.mediaType};base64,${preview.base64}`}
							alt={ref.name}
							onError={() => setRef({ ...ref, availability: "corrupt" })}
						/>
					) : (
						<pre>{preview.text}</pre>
					)}
					{preview.truncated && <p>{t("Preview truncated. Export the copy to read the full file.")}</p>}
				</div>
			)}
		</div>
	);
}
