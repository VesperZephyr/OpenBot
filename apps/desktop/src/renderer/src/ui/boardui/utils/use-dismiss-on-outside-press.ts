import { useEffect, useRef } from "react";
import type { RefObject } from "react";

// React Aria 1.17 couples `isNonModal` to `isDismissable: false` (usePopover).
// Non-modal avoids the scroll lock that yanks the Settings scroller. These two
// hooks put outside-press dismissal and trigger toggle back.
// Remove when a non-modal Popover dismisses on outside press and toggles from
// its trigger without a follow-up open, verified against the pinned React Aria.
export function useDismissOnOutsidePress(
	isOpen: boolean,
	onDismiss: () => void,
	refs: RefObject<HTMLElement | null>[],
) {
	useEffect(() => {
		if (!isOpen) return;
		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target as Node;
			if (refs.some((ref) => ref.current?.contains(target))) return;
			onDismiss();
		};
		document.addEventListener("pointerdown", handlePointerDown, true);
		return () => document.removeEventListener("pointerdown", handlePointerDown, true);
	}, [isOpen, onDismiss, refs]);
}

export function useTriggerToggle(isOpen: boolean, triggerRef: RefObject<HTMLElement | null>) {
	const suppressReopenRef = useRef(false);
	useEffect(() => {
		if (!isOpen) return;
		const handlePointerDown = (event: PointerEvent) => {
			if (!triggerRef.current?.contains(event.target as Node)) return;
			suppressReopenRef.current = true;
			setTimeout(() => {
				suppressReopenRef.current = false;
			}, 400);
		};
		document.addEventListener("pointerdown", handlePointerDown, true);
		return () => document.removeEventListener("pointerdown", handlePointerDown, true);
	}, [isOpen, triggerRef]);
	return (next: boolean) => {
		if (next && suppressReopenRef.current) {
			suppressReopenRef.current = false;
			return false;
		}
		return true;
	};
}
