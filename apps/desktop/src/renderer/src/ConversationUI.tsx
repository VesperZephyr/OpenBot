import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "./store";
import { useReadReceipt } from "./useReadReceipt";
import type { ConversationKey } from "@openbot/protocol";
import { t } from "./i18n";

export function ConversationShell({
	children,
	details,
	className = "",
	label,
}: {
	children: ReactNode;
	details?: ReactNode;
	className?: string;
	label?: string;
}) {
	return (
		<section className={`conversation-shell ${className}`} aria-label={label}>
			<div className="conversation-main">{children}</div>
			{details}
		</section>
	);
}

/** Modal editors are stacked; only the last visible modal handles focus and Escape. */
export function useDialogFocus() {
	useEffect(() => {
		const openers = new Map<HTMLElement, HTMLElement | null>();
		const dialogs = () =>
			[...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')].filter((e) => e.offsetParent !== null);
		const scan = () => {
			for (const [dialog, opener] of openers)
				if (!dialog.isConnected) {
					if (opener?.isConnected) opener.focus();
					openers.delete(dialog);
				}
			for (const dialog of dialogs())
				if (!openers.has(dialog)) {
					openers.set(dialog, document.activeElement as HTMLElement);
					if (!dialog.contains(document.activeElement))
						dialog
							.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]')
							?.focus();
				}
		};
		const observer = new MutationObserver(scan);
		observer.observe(document.body, { childList: true, subtree: true });
		scan();
		const key = (event: KeyboardEvent) => {
			const visible = dialogs();
			const dialog = visible.filter((el) => !el.classList.contains("conversation-details")).at(-1) ?? visible.at(-1);
			if (!dialog) return;
			if (event.key === "Tab") {
				const items = [
					...dialog.querySelectorAll<HTMLElement>(
						'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"], summary',
					),
				].filter((e) => e.offsetParent !== null);
				const first = items[0],
					last = items.at(-1);
				if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
					event.preventDefault();
					last?.focus();
				} else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
					event.preventDefault();
					first?.focus();
				}
			}
			if (event.key === "Escape" && !event.isComposing) {
				const closer = dialog.querySelector<HTMLElement>("[data-dialog-close]");
				if (closer) {
					event.preventDefault();
					event.stopPropagation();
					closer.click();
				}
			}
		};
		document.addEventListener("keydown", key, true);
		return () => {
			observer.disconnect();
			document.removeEventListener("keydown", key, true);
		};
	}, []);
}

export function DetailsPanel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
	const [overlay, setOverlay] = useState(() => window.innerWidth < 1200);
	const ref = useRef<HTMLElement>(null);
	useEffect(() => {
		const opener = document.activeElement as HTMLElement;
		const fallback = ref.current?.closest(".conversation-shell")?.querySelector<HTMLElement>(".details-toggle");
		const resize = () => setOverlay(window.innerWidth < 1200);
		window.addEventListener("resize", resize);
		ref.current?.querySelector<HTMLElement>("button")?.focus();
		return () => {
			window.removeEventListener("resize", resize);
			if (opener?.isConnected && opener !== document.body) opener.focus();
			else fallback?.focus();
		};
	}, []);
	return (
		<>
			{overlay && <div className="details-scrim" aria-hidden onClick={onClose} />}
			<aside
				ref={ref}
				className={`conversation-details ${overlay ? "is-overlay" : ""}`}
				role={overlay ? "dialog" : "complementary"}
				aria-modal={overlay || undefined}
				aria-label={title}
				onKeyDown={(e) => {
					if (e.key === "Escape") onClose();
				}}
			>
				<div className="details-heading">
					<h2>{title}</h2>
					<button type="button" data-dialog-close aria-label={t("Close details")} onClick={onClose}>
						×
					</button>
				</div>
				{children}
			</aside>
		</>
	);
}

type Position = { top: number; following: boolean; id?: string; offset?: number };
const positions = new Map<string, Position>();
export function Timeline({
	readCursor,
	conversationKey,
	activity,
	children,
	className = "",
}: {
	readCursor?: number | undefined;
	conversationKey: ConversationKey;
	activity: string;
	children: ReactNode;
	className?: string;
}) {
	const ref = useRef<HTMLDivElement>(null),
		inner = useRef<HTMLDivElement>(null);
	const target = useStore((s) => s.searchTarget?.conversationKey === conversationKey ? s.searchTarget : undefined);
	const state = useRef<Position>(target ? { top: 0, following: false } : positions.get(conversationKey) ?? { top: 0, following: true });
	const [missing, setMissing] = useState(false);
	const located = useRef<string | undefined>(undefined);
	const [unseen, setUnseen] = useState(false);
	useReadReceipt(conversationKey, readCursor, ref, () => state.current.following);
	const capture = () => {
		const el = ref.current;
		if (!el) return;
		const y = el.getBoundingClientRect().top;
		const row = [...el.querySelectorAll<HTMLElement>("[data-message-id]")].find((n) => n.getBoundingClientRect().bottom > y);
		state.current = {
			top: el.scrollTop,
			following: el.scrollHeight - el.clientHeight - el.scrollTop <= 80,
			...(row ? { id: row.dataset.messageId!, offset: row.getBoundingClientRect().top - y } : {}),
		};
		positions.set(conversationKey, state.current);
		if (state.current.following) setUnseen(false);
	};
	const restore = () => {
		const el = ref.current;
		if (!el) return;
		if (state.current.following) el.scrollTop = el.scrollHeight;
		else {
			const anchor = [...el.querySelectorAll<HTMLElement>("[data-message-id]")].find((n) => n.dataset.messageId === state.current.id);
			if (anchor) el.scrollTop += anchor.getBoundingClientRect().top - el.getBoundingClientRect().top - (state.current.offset ?? 0);
			else el.scrollTop = state.current.top;
		}
	};
	useLayoutEffect(() => {
		if (!target) { located.current = undefined; return; }
		const el = ref.current;
		const row = [...(el?.querySelectorAll<HTMLElement>("[data-message-id]") ?? [])].find((n) => n.dataset.messageId === target.messageId);
		state.current.following = false;
		if (!el || !row) { setMissing(true); return; }
		setMissing(false);
        // Evidence links may target a tool inside a folded step group.
        for (let parent = row.parentElement; parent && parent !== el; parent = parent.parentElement)
            if (parent instanceof HTMLDetailsElement) parent.open = true;
        const detail = row.classList.contains("tool-card") ? row.querySelector("details") : undefined;
        if (detail) detail.open = true;
		row.classList.add("search-target");
		if (located.current === target.nonce) return () => { row.classList.remove("search-target"); };
		el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top - el.clientHeight / 3;
		state.current = { top: el.scrollTop, following: false, id: target.messageId, offset: row.getBoundingClientRect().top - el.getBoundingClientRect().top };
		positions.set(conversationKey, state.current);
		located.current = target.nonce;
		return () => { row.classList.remove("search-target"); };
	}, [target, activity]);
	useLayoutEffect(() => {
		restore();
		if (!state.current.following) setUnseen(true);
	}, [activity]);
	useLayoutEffect(() => {
		restore();
		const observer = new ResizeObserver(restore);
		if (ref.current) observer.observe(ref.current);
		if (inner.current) observer.observe(inner.current);
		const sent = (e: Event) => {
			if ((e as CustomEvent).detail === conversationKey) {
				state.current.following = true;
				restore();
				setUnseen(false);
			}
		};
		window.addEventListener("openbot:sent", sent);
		return () => {
			observer.disconnect();
			window.removeEventListener("openbot:sent", sent);
		};
	}, [conversationKey]);
	return (
		<div className="timeline-frame">
			{target && <div className="search-location" role="status">{t(missing ? "Search result is no longer available" : "Viewing a search result")}</div>}
			<div ref={ref} className={`transcript timeline-scroll ${className}`} onScroll={capture}>
				<div ref={inner} className="timeline-content">
					{children}
				</div>
			</div>
			{(unseen || target) && (
				<button
					type="button"
					className="jump-latest"
					onClick={() => {
						useStore.setState({ searchTarget: undefined });
						state.current.following = true;
						restore();
						capture();
					}}
				>
					{t(target ? "Jump to latest" : "New activity · Jump to latest")} ↓
				</button>
			)}
		</div>
	);
}
