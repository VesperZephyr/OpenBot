import { useEffect } from "react";
import type { ReactNode } from "react";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { InterfaceIcon } from "../InterfaceIcon";
import { Button } from "./boardui/components/base/buttons/button";

export function OpenBotDialog({
	open,
	title,
	closeLabel,
	onClose,
	children,
}: {
	open: boolean;
	title: string;
	closeLabel: string;
	onClose: () => void;
	children: ReactNode;
}) {
	useEffect(() => {
		if (!open) return;
		const stopComposingEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || !(event.isComposing || event.keyCode === 229)) return;
			event.stopImmediatePropagation();
		};
		document.addEventListener("keydown", stopComposingEscape, true);
		return () => document.removeEventListener("keydown", stopComposingEscape, true);
	}, [open]);
	return (
		<ModalOverlay
			isOpen={open}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
			isDismissable={false}
			data-openbot-ui=""
			className="ob:fixed ob:inset-0 ob:z-30 ob:flex ob:items-start ob:justify-center ob:overflow-y-auto ob:bg-overlay ob:px-6 ob:pb-6 ob:pt-[10vh]"
		>
			<Modal className="ob:w-[380px] ob:max-w-full ob:outline-none">
				<Dialog
					aria-modal="true"
					data-focus-owner="react-aria"
					data-openbot-ui=""
					className="new-conversation ob:flex ob:max-h-[calc(100vh-12vh)] ob:flex-col ob:gap-2 ob:overflow-y-auto ob:rounded-2xl ob:border ob:border-muted ob:bg-surface-raised ob:p-5 ob:shadow-dialog ob:outline-none"
				>
					<div className="ob:flex ob:items-start ob:justify-between ob:gap-3">
						<Heading slot="title" className="ob:font-panel ob:text-[17px] ob:leading-6 ob:font-medium">
							{title}
						</Heading>
						<Button iconOnly icon={<InterfaceIcon name="close" size={18} />} aria-label={closeLabel} autoFocus onClick={onClose} />
					</div>
					{children}
				</Dialog>
			</Modal>
		</ModalOverlay>
	);
}
