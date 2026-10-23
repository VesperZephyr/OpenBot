import { useState } from "react";
import { ArtifactCard } from "./ArtifactCard";
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
				<li key={message.id} className={`message ${message.source==="background"?"message-background":"message-user"} is-pending`}>
					{message.skills?.map(skill=><span className="skill-chip" key={skill.name}>/{skill.name} <small>v{skill.revision}</small></span>)}
 {message.attachments?.map((ref) => (
						<ArtifactCard key={ref.artifactId} artifact={ref} />
					))}
					{message.source==="background" ? <span>{t("Background task result")}</span> : <div className="message-text">
						{message.parts.map((part, index) => (
							// Parts have no identity of their own; their order is stable within one message.
							<p key={index}>{part.text}</p>
						))}
					</div>}
				</li>
			))}

		</>
	);
}

export function StoppedNote() {
	return (
		<li className="run-note" role="note">
			{t("Stopped")}
		</li>
	);
}

/** Stop for a running or queued Run. */
export function StopButton({ run }: { readonly run: RunRecord | undefined }) {
	const [busy, setBusy] = useState(false);
	if (run?.state !== "running" && run?.state !== "queued") return null;
	return (
		<button
			type="button"
			className="stop"
			disabled={busy}
			aria-label={t(busy ? "Stopping work" : "Stop")}
			title={t("Stop")}
			onClick={() => {
				setBusy(true);
				void api["runs.cancel"]({ runId: run.runId }).catch(report).finally(() => setBusy(false));
			}}
		>
			<span className="stop-square" aria-hidden="true" />
		</button>
	);
}
