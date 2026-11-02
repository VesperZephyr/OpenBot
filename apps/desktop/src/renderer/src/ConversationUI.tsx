import { useEffect, useRef, useState, type ReactNode } from "react";
import { activeLegacyDialog } from "./dialog-focus";
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

function focusFirst(dialog: HTMLElement) {
	dialog
		.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]')
		?.focus();
}

/** Modal editors are stacked; only the topmost legacy modal handles focus and Escape. */
export function useDialogFocus() {
	useEffect(() => {
		const openers = new Map<HTMLElement, HTMLElement | null>();
		const dialogs = () =>
			[...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')].filter((element) => element.getClientRects().length > 0);
		const active = () =>
			activeLegacyDialog(
				dialogs().map((element) => ({
					element,
					focusOwner: element.getAttribute("data-focus-owner"),
					details: element.classList.contains("conversation-details"),
				})),
			)?.element;
		const scan = () => {
			const current = active();
			for (const [dialog, opener] of openers)
				if (!dialog.isConnected) {
					openers.delete(dialog);
					if (current) continue;
					if (opener?.isConnected) opener.focus();
				}
			if (current && !openers.has(current)) {
				openers.set(current, document.activeElement instanceof HTMLElement ? document.activeElement : null);
				if (!current.contains(document.activeElement)) focusFirst(current);
			}
		};
		let correctFrame = 0;
		const scheduleCorrect = () => {
			cancelAnimationFrame(correctFrame);
			correctFrame = requestAnimationFrame(() => {
				correctFrame = requestAnimationFrame(() => {
					correctFrame = 0;
					const current = active();
					if (current && !current.contains(document.activeElement)) focusFirst(current);
				});
			});
		};
		let tracked: HTMLElement | undefined;
		const observed = () => {
			scan();
			const current = active();
			if (current === tracked) return;
			tracked = current;
			if (current) scheduleCorrect();
		};
		const observer = new MutationObserver(observed);
		observer.observe(document.body, { childList: true, subtree: true });
		scan();
		const key = (event: KeyboardEvent) => {
			const dialog = active();
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
			cancelAnimationFrame(correctFrame);
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
	heading,
}: {
	title: string;
	onClose: () => void;
	children: ReactNode;
	modal?: boolean;
	heading?: ReactNode;
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
					<h2>{heading ?? (modal ? t("Edit profile") : title)}</h2>
					<button type="button" data-dialog-close aria-label={t("Close details")} onClick={onClose}>
						×
					</button>
				</div>
				{children}
			</aside>
		</>
	);
}
