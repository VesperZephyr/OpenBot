import { useRef, useState } from "react";
import type { MemoryNote, MemoryNoteChange, MemoryScope, MemorySourceEvidence, MemoryState } from "@openbot/protocol";
import { api, errorMessage, useStore } from "./store";
import { t } from "./i18n";

type WithoutRequest<T> = T extends unknown ? Omit<T, "requestId"> : never;
type NoteInput = WithoutRequest<MemoryNoteChange>;

type Props = {
	botId: string; scope: MemoryScope; state: MemoryState; other: MemoryState; busy: boolean; disabled: boolean;
	setBusy: (busy: boolean) => void;
	onChange: (states: { local: MemoryState; shared: MemoryState }) => void;
};
const labels = { user: "Edited by you", model: "Learned by this Bot", legacy: "Original memory", restore: "Restored by you" } as const;

export function MemoryNotes({ botId, scope, state, other, busy, disabled, setBusy, onChange }: Props) {
	const bots = useStore(state => state.bots);
	const [editing, setEditing] = useState<string>();
	const [heading, setHeading] = useState("");
	const [draft, setDraft] = useState("");
	const [review, setReview] = useState<MemoryNote>();
	const [source, setSource] = useState<{ noteId: string; original: MemorySourceEvidence; changed: MemorySourceEvidence }>();
	const [error, setError] = useState("");
	const attempt = useRef<{ fingerprint: string; id: string } | undefined>(undefined);
	const run = async (change: NoteInput): Promise<void> => {
		const fingerprint = JSON.stringify(change);
		if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, id: crypto.randomUUID() };
		setBusy(true); setError("");
		try {
			const result = await api["bots.memory.note"]({ ...change, requestId: attempt.current.id } as MemoryNoteChange);
			onChange(result); setEditing(undefined); setReview(undefined); setSource(undefined); attempt.current = undefined;
		} catch (error) { setError(errorMessage(error)); }
		finally { setBusy(false); }
	};
	const showSource = async (noteId: string): Promise<void> => {
		setBusy(true); setError("");
		try {
			const [original, changed] = await Promise.all(["original", "changed"].map(which => api["bots.memory.source"]({ botId, scope, noteId, which: which as "original" | "changed" })));
			setSource({ noteId, original: original!, changed: changed! });
		} catch (error) { setError(errorMessage(error)); }
		finally { setBusy(false); }
	};
	const base = { botId, scope, expectedRevision: state.revision };
	const active = state.notes.filter(note => note.status === "active");
	return <section className="memory-notes" aria-label={t("Memory notes")} onKeyDown={event => { if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault(); }}>
		<div className="memory-note-heading"><strong>{t("Remembered topics")}</strong><button type="button" disabled={busy || disabled} onClick={() => { setEditing("new"); setHeading(""); setDraft(""); setError(""); }}>{t("Add note")}</button></div>
		{disabled && <p className="field-hint">{t("Save or reload your Markdown draft before changing notes.")}</p>}
		{active.length === 0 && <p className="field-hint">{t("No remembered topics in this scope.")}</p>}
		{active.map(note => <article key={note.id} className="memory-note" data-note-id={note.id}>
			<div className="memory-note-heading"><strong>{note.heading || t("Legacy notes")}</strong>{note.protected && <span className="memory-badge">{t("Owner protected")}</span>}</div>
			<p className="memory-note-content">{note.content}</p>
			<p className="field-hint">{t(labels[note.changed.kind])}{note.changed.at !== null ? ` · ${new Date(note.changed.at).toLocaleString()}` : ""}</p>
			{scope === "bot" && other.notes.some(n => n.status !== "shared" && n.key === note.key) && <p className="field-hint">{t("The shared topic takes precedence in private chats and routines.")}</p>}
			<div className="memory-note-actions">
				<button type="button" disabled={busy} onClick={() => void showSource(note.id)}>{t("View source")}</button>
				<button type="button" disabled={busy || disabled} onClick={() => { setEditing(note.id); setDraft(note.content); setError(""); }}>{t("Edit note")}</button>
				<button type="button" disabled={busy || disabled} onClick={() => { setReview(note); setError(""); }}>{t(scope === "bot" ? "Share across Bots" : "Move to this Bot")}</button>
				<button type="button" disabled={busy || disabled} onClick={() => void run({ ...base, action: "forget", noteId: note.id })}>{t("Forget note")}</button>
			</div>
			{source?.noteId === note.id && <div className="memory-source">
				{(["original", "changed"] as const).map(which => <div key={which}>
					<strong>{t(which === "original" ? "Original source" : "Last change")}</strong>
					<p>{t(source[which].source.kind === "model" && source[which].source.botId !== botId ? "Learned by another Bot" : labels[source[which].source.kind])}{source[which].source.at !== null ? ` · ${new Date(source[which].source.at!).toLocaleString()}` : ""}</p>
					{source[which].source.botId && <p className="field-hint">{t("Source Bot")}: {bots.find(bot => bot.botId === source[which].source.botId)?.name ?? source[which].source.botId}</p>}
					{source[which].source.runId && <p className="field-hint">{t("Learning Run")}: {source[which].source.runId}</p>}
					{source[which].available ? source[which].requests.map(request => <div key={request.requestId}><span className="field-hint">{request.requestId}</span><pre>{request.text}</pre></div>) : <p className="field-hint">{t("No retained source request is available for this change.")}</p>}
					{source[which].truncated && <p className="field-hint">{t("Source preview is shortened.")}</p>}
				</div>)}
				<p className="field-hint">{t("This identifies the learning context, not proof that every claim was stated in the source.")}</p>
			</div>}
		</article>)}
		{editing && <div className="memory-note-editor">
			{editing === "new" && <label className="field"><span>{t("Memory topic")}</span><input aria-label={t("Memory topic")} value={heading} maxLength={120} disabled={busy} onChange={e => setHeading(e.target.value)} /></label>}
			<label className="field"><span>{t("Note content")}</span><textarea aria-label={t("Note content")} rows={3} value={draft} disabled={busy} onChange={e => setDraft(e.target.value)} /></label>
			<div className="memory-note-actions"><button type="button" disabled={busy || !draft.trim() || (editing === "new" && !heading.trim())} onClick={() => void run({ ...base, ...(editing === "new" ? { action: "add", heading, content: draft } : { action: "edit", noteId: editing, content: draft }) })}>{t("Save note")}</button><button type="button" disabled={busy} onClick={() => setEditing(undefined)}>{t("Cancel note edit")}</button></div>
		</div>}
		{review && <div className="memory-share-review" role="region" aria-label={t("Review memory scope")}>
			<strong>{t(scope === "bot" ? "Share this note across Bots?" : "Keep this note only with this Bot?")}</strong>
			<p>{t(scope === "bot" ? "All Bots can use this note in private chats and routines. Group chats are excluded." : "Other Bots will stop receiving this shared note. This Bot keeps it across its conversations, including groups.")}</p>
			<pre>{review.heading}{"\n"}{review.content}</pre>
			<div className="memory-note-actions"><button type="button" className="primary" disabled={busy} onClick={() => void run({ ...base, action: scope === "bot" ? "share" : "unshare", noteId: review.id, otherRevision: other.revision })}>{t("Confirm scope change")}</button><button type="button" disabled={busy} onClick={() => setReview(undefined)}>{t("Cancel scope change")}</button></div>
		</div>}
		{state.notes.some(n => n.status !== "active") && <p className="field-hint">{t("Forgotten and moved topics retain protection. Owner edits or an explicit history restore can bring them back.")}</p>}
		{error && <p role="alert">{t(error)}</p>}
	</section>;
}
