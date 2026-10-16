/**
 * Bot menu actions from B7: Duplicate (same profile and memory, no history) and Delete (after confirmation; the
 * conversation stays on disk, the Bot disappears everywhere).
 */
import type { BotSummary } from "@openbot/protocol";
import { useState } from "react";
import { api, openBot, refreshBots, report, useStore } from "./store";

export function DuplicateBotItem({ bot, onDone }: { readonly bot: BotSummary; readonly onDone: () => void }) {
	const duplicate = async (): Promise<void> => {
		onDone();
		try {
			const copy = await api["bots.duplicate"]({ botId: bot.botId, requestId: crypto.randomUUID() });
			await refreshBots();
			await openBot(copy.botId);
		} catch (error) {
			report(error);
		}
	};
	return (
		<button type="button" role="menuitem" onClick={() => void duplicate()}>
			Duplicate
		</button>
	);
}

export function DeleteBotItem({ onChoose }: { readonly onChoose: () => void }) {
	return (
		<button type="button" role="menuitem" className="is-destructive" onClick={onChoose}>
			Delete…
		</button>
	);
}

export function ConfirmDeleteBot({ bot, onClose }: { readonly bot: BotSummary; readonly onClose: () => void }) {
	const [busy, setBusy] = useState(false);
	const confirm = async (): Promise<void> => {
		setBusy(true);
		try {
			await api["bots.delete"]({ botId: bot.botId });
			useStore.setState({ view: { kind: "home" } });
			await refreshBots();
			onClose();
		} catch (error) {
			report(error);
			setBusy(false);
		}
	};
	return (
		<div className="dialog-backdrop" onMouseDown={onClose}>
			<div
				className="dialog"
				role="alertdialog"
				aria-labelledby="delete-bot-title"
				onMouseDown={(event) => event.stopPropagation()}
				onKeyDown={(event) => event.key === "Escape" && onClose()}
			>
				<h2 id="delete-bot-title">Delete {bot.name}?</h2>
				<p className="muted">
					{bot.name} stops any work in progress and disappears from OpenBot. Files it saved in the workspace stay where they
					are.
				</p>
				<div className="dialog-actions">
					<button type="button" onClick={onClose} autoFocus>
						Cancel
					</button>
					<button type="button" className="danger" disabled={busy} onClick={() => void confirm()}>
						Delete Bot
					</button>
				</div>
			</div>
		</div>
	);
}
