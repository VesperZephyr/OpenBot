import { t } from "./i18n";
import { MEMORY_LIMIT_BYTES, type MemoryState } from "@openbot/protocol";
import { type FormEvent, useEffect, useState } from "react";
import { api, errorMessage, useStore } from "./store";

const sourceLabel = { legacy: "Original memory", user: "Edited by you", model: "Learned by this Bot", restore: "Restored by you" } as const;

/** Drafts stay intact after a conflict; only an explicit reload replaces them. */
export function ProfileMemory({ botId, onClose }: { readonly botId: string; readonly onClose: () => void }) {
	const language = useStore((state) => state.settings?.language ?? "en");
	const [state, setState] = useState<MemoryState>();
	const [content, setContent] = useState("");
	const [selected, setSelected] = useState<number>();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const accept = (memory: MemoryState): void => {
		setState(memory);
		setContent(memory.content);
		setSelected(undefined);
		setError("");
	};
	useEffect(() => {
		let current = true;
		api["bots.memory.get"]({ botId })
			.then((memory) => {
				if (current) accept(memory);
			})
			.catch((error) => {
				if (current) setError(errorMessage(error));
			});
		return () => {
			current = false;
		};
	}, [botId]);
	const reload = async (): Promise<void> => {
		setBusy(true);
		try {
			accept(await api["bots.memory.get"]({ botId }));
		} catch (error) {
			setError(errorMessage(error));
		} finally {
			setBusy(false);
		}
	};
	const bytes = new TextEncoder().encode(content).length;
	const previous = state?.history.find((item) => item.revision === selected);
	const save = async (event: FormEvent): Promise<void> => {
		event.preventDefault();
		if (!state || busy) return;
		setBusy(true);
		try {
			await api["bots.memory.update"]({ botId, content, expectedRevision: state.revision });
			onClose();
		} catch (error) {
			setError(errorMessage(error));
		} finally {
			setBusy(false);
		}
	};
	const restore = async (): Promise<void> => {
		if (!state || !previous || busy) return;
		setBusy(true);
		try {
			accept(await api["bots.memory.restore"]({ botId, revision: previous.revision, expectedRevision: state.revision }));
		} catch (error) {
			setError(errorMessage(error));
		} finally {
			setBusy(false);
		}
	};
	return (
		<form className="profile-memory" onSubmit={save}>
			<p className="field-hint">
				{t(
					"Memory holds learned preferences. Prompt defines how this Bot works. Both are stored on this Mac and sent to your configured model when needed.",
				)}
			</p>
			{state && (
				<div className="memory-meta">
					{t("Revision")} {state.revision} · {t(sourceLabel[state.source])}
					{state.updatedAt !== null && <> · {new Date(state.updatedAt).toLocaleString(language)}</>}
				</div>
			)}
			<label className="field">
				<span>{t("What this Bot remembers across conversations and new topics")}</span>
				<textarea
					rows={8}
					value={content}
					disabled={!state || busy}
					placeholder={t("Nothing yet. The Bot saves lasting preferences here, and you can edit them.")}
					onChange={(event) => setContent(event.target.value)}
					aria-label={t("Memory")}
				/>
			</label>
			<p className="field-hint">
				{t(
					"Clearing memory does not erase chat history, retained versions, backups or prior model requests. Start a new topic to leave old chat context behind.",
				)}
			</p>
			{error && <p role="alert">{t(error)}</p>}
			<div className="memory-controls">
				<span className={bytes > MEMORY_LIMIT_BYTES ? "memory-size is-over" : "memory-size"}>
					{t("{used} of {limit} bytes", { used: bytes.toLocaleString(language), limit: MEMORY_LIMIT_BYTES.toLocaleString(language) })}
				</span>
				<button type="button" disabled={busy} onClick={() => void reload()}>
					{t("Reload memory")}
				</button>
				<button
					type="button"
					disabled={!state || busy || content === ""}
					onClick={() => {
						setContent("");
						setSelected(undefined);
					}}
				>
					{t("Clear draft")}
				</button>
			</div>
			{state && state.history.length > 0 && (
				<details className="memory-history">
					<summary>{t("Previous versions")}</summary>
					<p className="field-hint">{t("Up to 20 previous versions are kept locally. Restoring creates a new version.")}</p>
					<label className="field">
						<span>{t("Version to preview")}</span>
						<select
							value={selected ?? ""}
							disabled={busy}
							onChange={(event) => setSelected(event.target.value === "" ? undefined : Number(event.target.value))}
						>
							<option value="">{t("Choose a version")}</option>
							{[...state.history].reverse().map((item) => (
								<option key={item.revision} value={item.revision}>
									{t("Revision")} {item.revision} · {t(sourceLabel[item.source])}
									{item.updatedAt !== null ? ` · ${new Date(item.updatedAt).toLocaleString(language)}` : ""}
								</option>
							))}
						</select>
					</label>
					{previous && (
						<>
							<pre className="memory-preview">{previous.content || t("Empty memory")}</pre>
							<button type="button" disabled={busy} onClick={() => void restore()}>
								{t("Restore this version")}
							</button>
						</>
					)}
				</details>
			)}
			<div className="dialog-actions">
				<button type="button" onClick={onClose}>
					{t("Cancel")}
				</button>
				<button type="submit" className="primary" disabled={!state || busy || bytes > MEMORY_LIMIT_BYTES}>
					{t("Save memory")}
				</button>
			</div>
		</form>
	);
}
