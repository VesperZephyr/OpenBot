import { useEffect, useRef, useState } from "react";
import type { ArtifactRef, FileListing } from "@openbot/protocol";
import { api, errorMessage } from "./store";
import { t } from "./i18n";
import { InterfaceIcon } from "./InterfaceIcon";
import { openArtifact, openSelection, openWebPage, useReader } from "./reader-store";
import { ReaderTabs } from "./ReaderTabs";
import { ReaderTabContent } from "./ReaderTabContent";
import "./reader.css";

export function ReaderLoading({ page = false }: { page?: boolean }) {
	return (
		<div className="reader-status" role="status">
			<span className="reader-spinner" aria-hidden />
			{t(page ? "Opening page…" : "Opening file…")}
		</div>
	);
}
export function FileWorkspace() {
	const { open, tabs, activeId, browse, notice } = useReader();
	const selection = tabs.find((tab) => tab.id === activeId)?.selection;
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
	const [error, setError] = useState(""),
		[picking, setPicking] = useState(false),
		[address, setAddress] = useState("");
	const listGeneration = useRef(0);
	const panel = useRef<HTMLElement>(null);
	useEffect(() => {
		const opener = document.activeElement as HTMLElement | null;
		panel.current?.focus();
		return () => {
			if (opener?.isConnected) opener.focus();
		};
	}, []);
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
	if (!open) return null;
	const close = () => useReader.setState({ open: false });
	const pick = async () => {
		setPicking(true);
		try {
			const selected = await window.openbot.openFile();
			if (selected)
				openSelection({
					kind: "picked",
					file: selected,
					selectionId: selected.selectionId,
				});
		} catch (e) {
			setError(t(errorMessage(e)));
		} finally {
			setPicking(false);
		}
	};
	return (
		<aside
			ref={panel}
			tabIndex={-1}
			className={`file-workspace ${expanded ? "reader-expanded" : ""}`}
			aria-label={t("Files")}
			onKeyDown={(event) => {
				if (event.key === "Escape" && !event.nativeEvent.isComposing && !event.defaultPrevented) {
					event.preventDefault();
					event.stopPropagation();
					close();
				}
			}}
		>
			<ReaderTabs />
			{notice && (
				<p className="reader-notice" role="alert">
					{t(notice)}
				</p>
			)}
			<div className="reader-layout">
				{!expanded && (
					<aside className="file-browser" aria-label={t("File browser")}>
						<button className="reader-open-file" disabled={picking} onClick={() => void pick()}>
							<InterfaceIcon name="plus" />
							{t(picking ? "Opening file…" : "Open file")}
						</button>
						<form
							className="reader-page-form"
							onSubmit={(event) => {
								event.preventDefault();
								if (openWebPage(address)) {
									setAddress("");
									setError("");
								} else setError(t("Enter an HTTP or HTTPS page address"));
							}}
						>
							<input
								type="text"
								inputMode="url"
								aria-label={t("Page address")}
								placeholder="https://…"
								value={address}
								maxLength={8192}
								onChange={(event) => setAddress(event.target.value)}
							/>
							<button type="submit">{t("Open page")}</button>
						</form>
						{error && (
							<p role="alert" className="reader-error">
								{error}
							</p>
						)}
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
								<InterfaceIcon name="arrow" />
							</button>
							<span title={path}>{tab === "shared" ? t("Attachments and results") : path || t("Workspace")}</span>
							<button aria-label={t("Refresh files")} onClick={() => setRefresh((n) => n + 1)}>
								<InterfaceIcon name="refresh" />
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
															: openSelection({
																	kind: "workspace",
																	path: entry.path,
																	name: entry.name,
																})
													}
												>
													<InterfaceIcon name={entry.kind === "directory" ? "folder" : "file"} />
													<span>{entry.name}</span>
													{entry.kind === "directory" && <InterfaceIcon name="chevron" />}
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
				{tabs.map((tab) => (
					<ReaderTabContent key={tab.id} tab={tab} active={tab.id === activeId} />
				))}
				{!tabs.length && (
					<div className="reader-status reader-empty">
						<InterfaceIcon name="file" />
						<h2>{t("A place to read your files")}</h2>
						<p>{t("Open a workspace file, a shared result, or a file on your Mac.")}</p>
					</div>
				)}
			</div>
		</aside>
	);
}
