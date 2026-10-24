import { lazy, Suspense, useEffect, useState } from "react";
import type { ReaderFile } from "@openbot/protocol";
import { api, errorMessage } from "./store";
import { InterfaceIcon } from "./InterfaceIcon";
import { t } from "./i18n";
import { type ReaderTab } from "./reader-store";
import { ReaderLoading } from "./FileWorkspace";
const DocumentContent = lazy(() => import("./readers/DocumentContent"));
const HtmlReader = lazy(() => import("./readers/HtmlReader"));
export function ReaderTabContent({ tab, active }: { tab: ReaderTab; active: boolean }) {
	const selection = tab.selection;
	const [file, setFile] = useState<ReaderFile>(),
		[error, setError] = useState(""),
		[busy, setBusy] = useState(selection.kind !== "web");
	const [zoom, setZoom] = useState(100),
		[source, setSource] = useState(false),
		[revision, setRevision] = useState(0);
	useEffect(() => {
		if (selection.kind === "web") return;
		let active = true;
		setFile(undefined);
		setError("");
		setBusy(true);
		setZoom(100);
		setSource(false);
		const load =
			selection.kind === "picked"
				? Promise.resolve(selection.file)
				: selection.kind === "workspace"
					? api["files.read"]({ path: selection.path })
					: api["artifacts.read"]({
							artifactId: selection.artifact.artifactId,
						}).then((value) => {
							if (value.artifact.availability !== "available") throw Error("This local copy is unavailable");
							if (value.truncated) throw Error("This file exceeds the preview limit");
							return {
								name: value.artifact.name,
								mediaType: value.artifact.mediaType,
								bytes: value.artifact.bytes,
								...(value.text !== undefined ? { text: value.text } : {}),
								...(value.base64 !== undefined ? { base64: value.base64 } : {}),
							};
						});
		void load
			.then((value) => {
				if (value.text && value.bytes > 2 * 1024 * 1024) throw Error("This file exceeds the preview limit");
				if (active) setFile(value);
			})
			.catch((e) => {
				if (active) setError(t(errorMessage(e)));
			})
			.finally(() => {
				if (active) setBusy(false);
			});
		return () => {
			active = false;
		};
	}, [selection, revision]);

	return (
		<section
			className="reader-tab-content"
			role="tabpanel"
			id={`reader-panel-${tab.id}`}
			aria-labelledby={`reader-tab-${tab.id}`}
			hidden={!active}
		>
			<div className="reader-controls reader-document-controls">
				{(file || selection.kind === "web") && (
					<>
						<div className="reader-zoom-controls">
							<button
								aria-label={t("Zoom out")}
								title={t("Zoom out")}
								disabled={zoom <= 60}
								onClick={() => setZoom((z) => Math.max(60, z - 10))}
							>
								<InterfaceIcon name="minus" />
							</button>
							<button className="reader-zoom" aria-label={t("Reset zoom")} title={t("Reset zoom")} onClick={() => setZoom(100)}>
								{zoom}%
							</button>
							<button
								aria-label={t("Zoom in")}
								title={t("Zoom in")}
								disabled={zoom >= 180}
								onClick={() => setZoom((z) => Math.min(180, z + 10))}
							>
								<InterfaceIcon name="plus" />
							</button>
						</div>
						{file?.text !== undefined && (
							<button className="reader-source-toggle" aria-pressed={source} onClick={() => setSource((v) => !v)}>
								{source ? t("Reading") : t("Source")}
							</button>
						)}
					</>
				)}
				{selection?.kind === "artifact" && file && (
					<button
						className="reader-export"
						onClick={() => {
							void window.openbot
								.exportArtifact({
									artifactId: selection.artifact.artifactId,
									requestId: crypto.randomUUID(),
								})
								.catch((e) => setError(t(errorMessage(e))));
						}}
					>
						{t("Export copy")}
					</button>
				)}
			</div>
			<main className="reader-document" aria-label={t("File preview")}>
				{selection.kind === "web" ? (
					<Suspense fallback={<ReaderLoading page />}>
						<HtmlReader url={selection.url} zoom={zoom} active={active} tabId={tab.id} />
					</Suspense>
				) : busy ? (
					<ReaderLoading />
				) : error ? (
					<div className="reader-status reader-error" role="alert">
						<strong>{t("Could not open file")}</strong>
						<p>{error}</p>
						<button
							onClick={() => {
								if (selection) setRevision((n) => n + 1);
							}}
						>
							{t("Try again")}
						</button>
					</div>
				) : file ? (
					<Suspense fallback={<ReaderLoading />}>
						<DocumentContent
							file={file}
							active={active}
							tabId={tab.id}
							source={source}
							zoom={zoom}
							workspacePath={selection?.kind === "workspace" ? selection.path : undefined}
						/>
					</Suspense>
				) : (
					<div className="reader-status reader-empty">
						<h2>{t("A place to read your files")}</h2>
						<p>{t("Open a workspace file, a shared result, or a file on your Mac.")}</p>
						<span>{t("Markdown · HTML · PDF · Images · Text")}</span>
					</div>
				)}
			</main>
		</section>
	);
}
