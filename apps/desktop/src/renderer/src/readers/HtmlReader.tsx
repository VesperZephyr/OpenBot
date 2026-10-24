import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReaderBrowserState } from "../../../shared/api";
import { t } from "../i18n";
import { errorMessage } from "../store";
import { useReader } from "../reader-store";
import { ReaderLoading } from "../FileWorkspace";
export default function HtmlReader({ html, zoom }: { html: string; zoom: number }) {
	const resizing = useReader((state) => state.resizing);
	const viewport = useRef<HTMLDivElement>(null),
		current = useRef<string | undefined>(undefined),
		local = useRef<string | undefined>(undefined);
	const [state, setState] = useState<ReaderBrowserState>(),
		[error, setError] = useState(""),
		[starting, setStarting] = useState(html !== undefined);
	useEffect(() => {
		let active = true,
			id: string | undefined,
			url: string | undefined;
		const off = window.openbot.onReaderState((next) => {
			if (active && next.id === current.current) {
				if (next.closed) {
					useReader.setState({ open: false });
					return;
				}
				setState(next);
			}
		});
		if (html !== undefined)
			void window.openbot
				.previewHtml(html)
				.then(async (value) => {
					url = value;
					local.current = value;
					if (!active) {
						void window.openbot.closeHtmlPreview(value);
						return;
					}
					const opened = await window.openbot.readerOpen(value);
					id = opened.id;
					if (active) {
						current.current = id;
						setState(opened);
						setStarting(false);
					} else await window.openbot.readerClose(id);
				})
				.catch((e) => {
					if (active) {
						setError(t(errorMessage(e)));
						setStarting(false);
					}
				});
		return () => {
			active = false;
			off();
			const owned = id ?? current.current;
			if (owned) void window.openbot.readerClose(owned);
			if (url) void window.openbot.closeHtmlPreview(url);
			current.current = undefined;
			local.current = undefined;
		};
	}, [html]);
	useLayoutEffect(() => {
		const node = viewport.current,
			id = state?.id;
		if (!node || !id) return;
		const modalOpen = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], .dialog-backdrop')].some((el) => el.offsetParent !== null);
		let covered = modalOpen();
		const update = () => {
			const rect = node.getBoundingClientRect();
			void window.openbot
				.readerBounds(id, { x: rect.x, y: rect.y, width: resizing || covered ? 0 : rect.width, height: resizing || covered ? 0 : rect.height, zoom: zoom / 100 })
				.catch(() => {});
		};
		const observer = new ResizeObserver(update);
		observer.observe(node);
		for (const group of document.querySelectorAll(".workspace-split, .conversation-split")) observer.observe(group);
		// Native views sit above the renderer, so hide them while an app modal owns interaction.
		const modals = new MutationObserver(() => {
			const next = modalOpen();
			if (next !== covered) { covered = next; update(); }
		});
		modals.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "role", "hidden"] });
		window.addEventListener("resize", update);
		update();
		return () => {
			observer.disconnect();
			modals.disconnect();
			window.removeEventListener("resize", update);
		};
	}, [state?.id, zoom, resizing]);
	const act = async (action: "navigate" | "back" | "forward" | "reload", url?: string) => {
		setError("");
		try {
			if (current.current) setState(await window.openbot.readerAction(current.current, action, url));
		} catch (e) {
			setError(t(errorMessage(e)));
		} finally {
			setStarting(false);
		}
	};
	return (
		<div className="html-reader">
			<div className="reader-web-toolbar">
				<button type="button" aria-label={t("Back")} disabled={!state?.canGoBack} onClick={() => void act("back")}>
					←
				</button>
				<button type="button" aria-label={t("Forward")} disabled={!state?.canGoForward} onClick={() => void act("forward")}>
					→
				</button>
				<button type="button" aria-label={t("Reload page")} disabled={!state} onClick={() => void act("reload")}>
					↻
				</button>
				<span className="reader-web-address" title={state?.url.startsWith("http") ? state.url : undefined}>
					{state?.url.startsWith("http") ? state.url : t("HTML preview")}
				</span>
				{state?.url.startsWith("http") && (
					<button
						type="button"
						onClick={() => {
							if (local.current) void act("navigate", local.current);
						}}
					>
						{t("Local file")}
					</button>
				)}
			</div>
			<div className="reader-web-viewport" ref={viewport}>
				{starting || state?.loading ? (
					<ReaderLoading />
				) : error || state?.error ? (
					<div role="alert" className="reader-status">
						<strong>{t("Could not open page")}</strong>
						<p>{t(error || state?.error || "Could not open page")}</p>
						<button onClick={() => void act("reload")}>{t("Reload page")}</button>
					</div>
				) : null}
			</div>
		</div>
	);
}
