import { useEffect, useRef, type RefObject } from "react";
import type { ConversationKey } from "@openbot/protocol";
import { markRead, report, useStore } from "./store";

/** A receipt acknowledges rendered messages, never a newer sidebar projection. */
export function useReadReceipt(
	key: ConversationKey,
	cursor: number | undefined,
	element: RefObject<HTMLDivElement | null>,
	following: () => boolean,
) {
	const acknowledged = useRef(0);
	const nativeActive = useStore((s) => s.windowActive);
	const persisted = useStore((s) => s.summaries[key]?.readThrough ?? 0);
	useEffect(() => {
		const el = element.current;
		if (!nativeActive || !el || !cursor || cursor <= Math.max(acknowledged.current, persisted)) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let sending = false;
		const readable = () =>
			useStore.getState().windowActive &&
			useStore.getState().searchTarget?.conversationKey !== key &&
			!document.activeElement?.closest(".conversation-search, .search-results, .conversation-filters") &&
			document.visibilityState === "visible" &&
			document.hasFocus() &&
			following() &&
			el.scrollHeight - el.scrollTop - el.clientHeight <= 80 &&
			!document.querySelector('[role="dialog"], [role="alertdialog"], .dialog-backdrop');
		const schedule = () => {
			clearTimeout(timer);
			if (!readable() || sending) return;
			timer = setTimeout(() => {
				if (!readable()) return;
				sending = true;
				void markRead(key, cursor)
					.then(() => {
						acknowledged.current = Math.max(acknowledged.current, cursor);
					})
					.catch(report)
					.finally(() => {
						sending = false;
					});
			}, 400);
		};
		el.addEventListener("scroll", schedule, { passive: true });
		window.addEventListener("focus", schedule);
		window.addEventListener("blur", schedule);
		document.addEventListener("visibilitychange", schedule);
		document.addEventListener("focusin", schedule);
		document.addEventListener("focusout", schedule);
		const modals = new MutationObserver(schedule);
		modals.observe(document.body, { childList: true, subtree: true });
		schedule();
		return () => {
			clearTimeout(timer);
			modals.disconnect();
			el.removeEventListener("scroll", schedule);
			window.removeEventListener("focus", schedule);
			window.removeEventListener("blur", schedule);
			document.removeEventListener("visibilitychange", schedule);
			document.removeEventListener("focusin", schedule);
			document.removeEventListener("focusout", schedule);
		};
	}, [key, cursor, persisted, element, nativeActive]);
}
