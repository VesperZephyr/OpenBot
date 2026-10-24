import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { ArtifactRef, FileListing, ReaderFile } from "@openbot/protocol";
import { api, errorMessage } from "./store";
import { t } from "./i18n";
import { InterfaceIcon } from "./InterfaceIcon";
import { openArtifact, useReader } from "./reader-store";
import "./reader.css";
const DocumentContent = lazy(() => import("./readers/DocumentContent"));
export function ReaderLoading() {
	return (
		<div className="reader-status" role="status">
			<span className="reader-spinner" aria-hidden />
			{t("Opening file…")}
		</div>
	);
}
export function FileWorkspace() {
	const { open, selection, browse } = useReader();
	const expanded = !browse;
	const [tab, setTab] = useState<"workspace" | "shared">("workspace"),
		[path, setPath] = useState(""),
		[query, setQuery] = useState("");
	const [listing, setListing] = useState<FileListing>(),
		[artifacts, setArtifacts] = useState<readonly ArtifactRef[]>([]),
		[next, setNext] = useState<number>();
	const [listBusy, setListBusy] = useState(false),
		[listError, setListError] = useState(""),
		[refresh, setRefresh] = useState(0);
	const [file, setFile] = useState<ReaderFile>(),
		[error, setError] = useState(""),
		[busy, setBusy] = useState(false),
		[picking, setPicking] = useState(false);
	const [zoom, setZoom] = useState(100),
		[source, setSource] = useState(false);
	const listGeneration = useRef(0);
	useEffect(() => {
		if (!open || !browse) return;
		let active = true;
		const generation = ++listGeneration.current;
		setListBusy(true);
		setListError("");
		const load =
			tab === "workspace"
				? api["files.list"]({ path }).then((value) => {
						if (active) setListing(value);
					})
				: api["artifacts.list"]({ offset: 0, query }).then((value) => {
						if (active) {
							setArtifacts(value.items);
							setNext(value.nextOffset);
						}
					});
		void load
			.catch((e) => {
				if (active) setListError(t(errorMessage(e)));
			})
			.finally(() => {
				if (active && generation === listGeneration.current) setListBusy(false);
			});
		return () => {
			active = false;
		};
	}, [open, browse, tab, path, tab === "shared" ? query : "", refresh]);
	useEffect(() => {
		if (!open || !selection) return;
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
					: api["artifacts.read"]({ artifactId: selection.artifact.artifactId }).then((value) => {
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
	}, [open, selection]);
	if (!open) return null;
	const name =
		selection?.kind === "artifact"
			? selection.artifact.name
			: selection?.kind === "workspace"
				? selection.name
				: selection?.kind === "picked"
					? selection.file.name
					: undefined;
	const close = () => useReader.setState({ open: false });
	const pick = async () => {
		setPicking(true);
		try {
			const selected = await window.openbot.openFile();
			if (selected) useReader.setState({ selection: { kind: "picked", file: selected } });
		} catch (e) {
			setError(t(errorMessage(e)));
		} finally {
			setPicking(false);
		}
	};
	return (
		<div className="reader-backdrop">
			<section className={`file-workspace ${expanded ? "reader-expanded" : ""}`} role="dialog" aria-modal="true" aria-label={t("Files")}>
				<header className="reader-topbar">
					<div className="reader-title">
						<InterfaceIcon name="file" />
						<strong>{name ?? t("Files")}</strong>
						{file && (
							<span>
								{Math.max(1, Math.ceil((file?.bytes ?? 0) / 1024))} KB · {t("Read only")}
							</span>
						)}
					</div>
					<div className="reader-controls">
						{file && (
							<>
								<button aria-label={t("Zoom out")} disabled={zoom <= 60} onClick={() => setZoom((z) => Math.max(60, z - 10))}>
									−
								</button>
								<button className="reader-zoom" aria-label={t("Reset zoom")} onClick={() => setZoom(100)}>
									{zoom}%
								</button>
								<button aria-label={t("Zoom in")} disabled={zoom >= 180} onClick={() => setZoom((z) => Math.min(180, z + 10))}>
									+
								</button>
								{file?.text !== undefined && (
									<button aria-pressed={source} onClick={() => setSource((v) => !v)}>
										{source ? t("Reading") : t("Source")}
									</button>
								)}
							</>
						)}
						{selection?.kind === "artifact" && file && (
							<button
								onClick={() => {
									void window.openbot
										.exportArtifact({ artifactId: selection.artifact.artifactId, requestId: crypto.randomUUID() })
										.catch((e) => setError(t(errorMessage(e))));
								}}
							>
								{t("Export copy")}
							</button>
						)}
						<button aria-label={t(expanded ? "Show file list" : "Expand reader")} onClick={() => useReader.setState({ browse: !browse })}>
							{expanded ? "⊟" : "⛶"}
						</button>
						<button data-dialog-close aria-label={t("Close preview")} onClick={close}>
							×
						</button>
					</div>
				</header>
				<div className="reader-layout">
					{!expanded && (
						<aside className="file-browser" aria-label={t("File browser")}>
							<button className="reader-open-file" disabled={picking} onClick={() => void pick()}>
								<InterfaceIcon name="plus" />
								{t(picking ? "Opening file…" : "Open file")}
							</button>
							<div className="file-tabs" role="tablist" aria-label={t("File locations")}>
								<button
									role="tab"
									aria-selected={tab === "workspace"}
									onClick={() => {
										setTab("workspace");
										setQuery("");
									}}
								>
									{t("Workspace")}
								</button>
								<button
									role="tab"
									aria-selected={tab === "shared"}
									onClick={() => {
										setTab("shared");
										setQuery("");
									}}
								>
									{t("Shared files")}
								</button>
							</div>
							<input
								type="search"
								value={query}
								maxLength={200}
								onChange={(e) => setQuery(e.target.value)}
								placeholder={t("Filter files")}
								aria-label={t("Filter files")}
							/>
							<div className="file-breadcrumb">
								<button
									disabled={tab !== "workspace" || !path}
									aria-label={t("Parent folder")}
									onClick={() => setPath(path.split("/").slice(0, -1).join("/"))}
								>
									↑
								</button>
								<span title={path}>{tab === "shared" ? t("Attachments and results") : path || t("Workspace")}</span>
								<button aria-label={t("Refresh files")} onClick={() => setRefresh((n) => n + 1)}>
									↻
								</button>
							</div>
							{listBusy && <p role="status">{t("Loading files…")}</p>}
							{listError && (
								<p role="alert" className="reader-error">
									{listError}
								</p>
							)}
							{!listBusy && !listError && (
								<div className="file-entries">
									{tab === "workspace"
										? listing?.entries
												.filter((entry) => entry.name.toLowerCase().includes(query.toLowerCase()))
												.map((entry) => (
													<button
														key={entry.path}
														disabled={entry.kind === "unsupported"}
														className={selection?.kind === "workspace" && selection.path === entry.path ? "is-selected" : ""}
														title={entry.name}
														onClick={() =>
															entry.kind === "directory"
																? setPath(entry.path)
																: useReader.setState({ selection: { kind: "workspace", path: entry.path, name: entry.name } })
														}
													>
														<span aria-hidden>{entry.kind === "directory" ? "▱" : "▤"}</span>
														<span>{entry.name}</span>
														{entry.kind === "directory" && <span aria-hidden>›</span>}
													</button>
												))
										: artifacts.map((artifact) => (
												<button
													key={artifact.artifactId}
													className={
														selection?.kind === "artifact" && selection.artifact.artifactId === artifact.artifactId ? "is-selected" : ""
													}
													onClick={() => openArtifact(artifact)}
												>
													<InterfaceIcon name="file" />
													<span>
														{artifact.name}
														<small>{t(artifact.source === "input" ? "Attached file" : "Result file")}</small>
													</span>
												</button>
											))}
									{((tab === "workspace" && !listing?.entries.some((entry) => entry.name.toLowerCase().includes(query.toLowerCase()))) ||
										(tab === "shared" && !artifacts.length)) && (
										<p className="reader-muted">{t(query ? "No matching files" : "No files here yet")}</p>
									)}
									{tab === "workspace" && listing?.limited && (
										<p role="status">{t("Showing the first 500 entries. Open a subfolder to narrow the list.")}</p>
									)}
									{tab === "shared" && next !== undefined && (
										<button
											onClick={() => {
												const generation = listGeneration.current;
												setListBusy(true);
												void api["artifacts.list"]({ offset: next, query })
													.then((value) => {
														if (generation === listGeneration.current) {
															setArtifacts((a) => [...a, ...value.items]);
															setNext(value.nextOffset);
														}
													})
													.catch((e) => {
														if (generation === listGeneration.current) setListError(t(errorMessage(e)));
													})
													.finally(() => {
														if (generation === listGeneration.current) setListBusy(false);
													});
											}}
										>
											{t("Load more")}
										</button>
									)}
								</div>
							)}
						</aside>
					)}
					<main className="reader-document" aria-label={t("File preview")}>
						{busy ? (
							<ReaderLoading />
						) : error ? (
							<div className="reader-status reader-error" role="alert">
								<strong>{t("Could not open file")}</strong>
								<p>{error}</p>
								<button
									onClick={() => {
										if (selection) useReader.setState({ selection: { ...selection } });
									}}
								>
									{t("Try again")}
								</button>
							</div>
						) : file ? (
							<Suspense fallback={<ReaderLoading />}>
								<DocumentContent
									file={file}
									source={source}
									zoom={zoom}
									workspacePath={selection?.kind === "workspace" ? selection.path : undefined}
								/>
							</Suspense>
						) : (
							<div className="reader-status reader-empty">
								<InterfaceIcon name="file" />
								<h2>{t("A place to read your files")}</h2>
								<p>{t("Open a workspace file, a shared result, or a file on your Mac.")}</p>
								<span>{t("Markdown · HTML · PDF · Images · Text")}</span>
							</div>
						)}
					</main>
				</div>
			</section>
		</div>
	);
}
