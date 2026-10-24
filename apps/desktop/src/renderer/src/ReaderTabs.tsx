import { useEffect, useRef } from "react";
import { closeReaderTab, openFiles, useReader } from "./reader-store";
import type { ReaderTab } from "./reader-store";
import { InterfaceIcon } from "./InterfaceIcon";
import { t } from "./i18n";
function ReaderTabLabel({ tab }: { tab: ReaderTab }) {
	const extension = tab.selection.kind !== "web" ? /\.[a-z0-9]{1,8}$/i.exec(tab.title)?.[0] : undefined;
	return (
		<>
			<span className="reader-tab-title">{extension ? tab.title.slice(0, -extension.length) : tab.title}</span>
			{extension && <span className="reader-tab-extension">{extension}</span>}
		</>
	);
}
export function ReaderTabs() {
	const browse = useReader((state) => state.browse);
	const tabs = useReader((state) => state.tabs),
		activeId = useReader((state) => state.activeId);
	const bar = useRef<HTMLDivElement>(null),
		add = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		bar.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [activeId]);
	const focusTab = (id: string | undefined) => {
		requestAnimationFrame(() => {
			if (id) document.getElementById(`reader-tab-${id}`)?.focus();
			else add.current?.focus();
		});
	};
	const close = (id: string) => {
		closeReaderTab(id);
		focusTab(useReader.getState().activeId);
	};
	return (
		<div className="reader-tabs-header">
			<div className="reader-tabs" role="tablist" aria-label={t("Open files and pages")} ref={bar}>
				{tabs.map((tab, index) => (
					<div className="reader-tab" key={tab.id} data-active={tab.id === activeId}>
						<button
							role="tab"
							id={`reader-tab-${tab.id}`}
							aria-controls={`reader-panel-${tab.id}`}
							aria-selected={tab.id === activeId}
							tabIndex={tab.id === activeId ? 0 : -1}
							title={tab.title}
							aria-label={tab.title}
							onClick={() => useReader.setState({ activeId: tab.id })}
							onKeyDown={(event) => {
								if (event.key === "Delete") {
									event.preventDefault();
									close(tab.id);
									return;
								}
								const next =
									event.key === "ArrowRight"
										? (index + 1) % tabs.length
										: event.key === "ArrowLeft"
											? (index + tabs.length - 1) % tabs.length
											: event.key === "Home"
												? 0
												: event.key === "End"
													? tabs.length - 1
													: undefined;
								if (next !== undefined) {
									event.preventDefault();
									const id = tabs[next]!.id;
									useReader.setState({ activeId: id });
									focusTab(id);
								}
							}}
						>
							<InterfaceIcon name={tab.selection.kind === "web" ? "web" : "file"} />
							<ReaderTabLabel tab={tab} />
						</button>
						<button
							className="reader-tab-close"
							tabIndex={tab.id === activeId ? 0 : -1}
							aria-label={t("Close {name}", { name: tab.title })}
							title={t("Close {name}", { name: tab.title })}
							onClick={() => close(tab.id)}
						>
							<InterfaceIcon name="close" />
						</button>
					</div>
				))}
			</div>
			<button
				ref={add}
				className="reader-add-tab"
				aria-label={t("Open file or page")}
				title={t("Open file or page")}
				onClick={() => {
					openFiles();
					requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".reader-page-form input")?.focus());
				}}
			>
				<InterfaceIcon name="plus" />
			</button>
			<div className="reader-panel-tools">
				<button
					aria-label={t(browse ? "Hide file list" : "Show file list")}
					title={t(browse ? "Hide file list" : "Show file list")}
					onClick={() => useReader.setState({ browse: !browse })}
				>
					<InterfaceIcon name="panel" />
				</button>
				<button aria-label={t("Close preview")} title={t("Close preview")} onClick={() => useReader.setState({ open: false })}>
					<InterfaceIcon name="close" />
				</button>
			</div>
		</div>
	);
}
