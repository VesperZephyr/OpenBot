import { t } from "./i18n";
/**
 * Run states in the conversation: messages the Bot has not read yet, the queued-Run notice, the Stop button, and the
 * note a stopped Run leaves in the transcript.
 */
import type { ConversationSnapshot, RunRecord } from "@openbot/protocol";
import { api, report } from "./store";

/** Messages accepted but not in the transcript yet: queued for a free slot, or waiting to join the current turn. */
export function PendingMessages({ snapshot }: { readonly snapshot: ConversationSnapshot }) {
	return (
		<>
			{(snapshot.pending ?? []).map((message) => (
				<li key={message.id} className="message message-user is-pending">
					<div className="message-text">
						{message.parts.map((part, index) => (
							// Parts have no identity of their own; their order is stable within one message.
							<p key={index}>{part.text}</p>
						))}
					</div>
				</li>
			))}
			{snapshot.run?.state === "queued" && (
				<li className="message message-assistant is-live">
					<span className="thinking">{t("Waiting for a free slot")}</span>
				</li>
			)}
		</>
	);
}

export function StoppedNote() {
	return (
		<li className="run-note" role="note">{t("Stopped")}</li>
	);
}

/** Stop for a running or queued Run. */
export function StopButton({ run }: { readonly run: RunRecord | undefined }) {
	if (run?.state !== "running" && run?.state !== "queued") return null;
	return (
		<button type="button" className="stop" onClick={() => void api["runs.cancel"]({ runId: run.runId }).catch(report)}>{t("Stop")}</button>
	);
}
