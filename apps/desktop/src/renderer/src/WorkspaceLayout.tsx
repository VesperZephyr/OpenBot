import { useEffect, type ReactNode } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { FileWorkspace } from "./FileWorkspace";
import { useReader } from "./reader-store";
import { t } from "./i18n";

export function WorkspaceLayout({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
	const open = useReader((state) => state.open);
	const outer = useDefaultLayout({ id: "openbot.sidebar-layout", onlySaveAfterUserInteractions: true });
	const inner = useDefaultLayout({
		id: "openbot.reader-layout",
		panelIds: open ? ["chat", "reader"] : ["chat"],
		onlySaveAfterUserInteractions: true,
	});
	useEffect(() => {
		const release = () => useReader.setState({ resizing: false });
		window.addEventListener("pointerup", release);
		window.addEventListener("pointercancel", release);
		window.addEventListener("blur", release);
		return () => {
			window.removeEventListener("pointerup", release);
			window.removeEventListener("pointercancel", release);
			window.removeEventListener("blur", release);
		};
	}, []);
	return (
		<Group
			className={`workspace-split ${open ? "has-reader" : ""}`}
			defaultLayout={outer.defaultLayout}
			onLayoutChanged={outer.onLayoutChanged}
			onPointerDownCapture={(event) => {
				if ((event.target as HTMLElement).closest('[role="separator"]')) useReader.setState({ resizing: true });
			}}
		>
			<Panel id="navigation" className="navigation-panel" defaultSize={232} minSize={170} maxSize={360}>
				{sidebar}
			</Panel>
			<Separator className="workspace-divider" aria-label={t("Resize chat list")} />
			<Panel id="workspace" minSize={open ? 636 : 360}>
				<Group className="conversation-split" defaultLayout={inner.defaultLayout} onLayoutChanged={inner.onLayoutChanged}>
					<Panel id="chat" className="chat-panel" minSize={300} defaultSize="50%">
						{children}
					</Panel>
					{open && <Separator className="workspace-divider" aria-label={t("Resize file preview")} />}
					{open && (
						<Panel id="reader" className="reader-panel" minSize={320} defaultSize="50%">
							<FileWorkspace />
						</Panel>
					)}
				</Group>
			</Panel>
		</Group>
	);
}
