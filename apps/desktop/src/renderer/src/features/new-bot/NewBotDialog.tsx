import { type FormEvent, useEffect, useRef, useState } from "react";
import { t } from "../../i18n";
import { createBot, report } from "../../store";

function focusNewButton(): void {
	requestAnimationFrame(() => document.querySelector<HTMLElement>(".new-button")?.focus());
}

export function NewBotDialog({ onClose }: { onClose: () => void }) {
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const nameInput = useRef<HTMLInputElement>(null);
	useEffect(() => {
		nameInput.current?.focus();
	}, []);
	const cancel = (): void => {
		onClose();
		focusNewButton();
	};
	const submit = async (event: FormEvent): Promise<void> => {
		event.preventDefault();
		if (name.trim() === "" || busy) return;
		setBusy(true);
		try {
			await createBot(name.trim());
			onClose();
		} catch (error) {
			report(error);
			setBusy(false);
		}
	};
	return (
		<div className="dialog-backdrop" onMouseDown={cancel}>
			<form className="dialog" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
				<h2>{t("Create a Bot")}</h2>
				<label className="field">
					<span>{t("Bot name")}</span>
					<input
						ref={nameInput}
						autoFocus
						value={name}
						placeholder="Piper"
						onChange={(event) => setName(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Escape") cancel();
						}}
					/>
				</label>
				<div className="dialog-actions">
					<button type="button" data-dialog-close onClick={cancel}>
						{t("Cancel")}
					</button>
					<button type="submit" className="primary" disabled={name.trim() === "" || busy}>
						{name.trim() === "" ? t("Create new Bot") : t("Create “{name}” Bot", { name: name.trim() })}
					</button>
				</div>
			</form>
		</div>
	);
}
