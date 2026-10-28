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
			[...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')].filter((e) => e.getClientRects().length > 0);
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
				].filter((e) => e.getClientRects().length > 0);
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

export function DetailsPanel({
	title,
	onClose,
	children,
	modal = false,
}: {
	title: string;
	onClose: () => void;
	children: ReactNode;
	modal?: boolean;
}) {
	const [overlay, setOverlay] = useState(() => modal || window.innerWidth < 1200);
	const ref = useRef<HTMLElement>(null);
	useEffect(() => {
		const opener = document.activeElement as HTMLElement;
		const fallback = ref.current?.closest(".conversation-shell")?.querySelector<HTMLElement>(".details-toggle");
		const resize = () => setOverlay(modal || window.innerWidth < 1200);
		window.addEventListener("resize", resize);
		ref.current?.querySelector<HTMLElement>("button")?.focus();
		return () => {
			window.removeEventListener("resize", resize);
			queueMicrotask(() => {
				if (opener?.isConnected && opener !== document.body) opener.focus();
				else fallback?.focus();
			});
		};
	}, []);
	useEffect(() => {
		if (!overlay || !modal) return;
		const elements = [
			ref.current?.closest(".conversation-shell")?.querySelector<HTMLElement>(".conversation-main"),
			document.querySelector<HTMLElement>(".sidebar"),
		];
		for (const element of elements) if (element) element.inert = true;
		return () => {
			for (const element of elements) if (element) element.inert = false;
		};
	}, [overlay, modal]);
	return (
		<>
			{overlay && <div className="details-scrim" aria-hidden onClick={onClose} />}
			<aside
				ref={ref}
				className={`conversation-details ${overlay ? "is-overlay" : ""} ${modal ? "profile-details" : ""}`}
				role={overlay ? "dialog" : "complementary"}
				aria-modal={overlay || undefined}
				aria-label={title}
				onKeyDown={(e) => {
					if (e.key === "Escape") onClose();
				}}
			>
				<div className="details-heading">
					<h2>{modal ? t("Edit profile") : title}</h2>
					<button type="button" data-dialog-close aria-label={t("Close details")} onClick={onClose}>
						×
					</button>
				</div>
				{children}
			</aside>
		</>
	);
}
