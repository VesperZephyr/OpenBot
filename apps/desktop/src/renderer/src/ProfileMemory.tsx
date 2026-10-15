import { MEMORY_LIMIT_BYTES } from "@openbot/protocol";
import { type FormEvent, useEffect, useState } from "react";
import { api, report } from "./store";

/** The Memory tab of Edit profile: the Bot's memory as Markdown, editable within the size limit. */
export function ProfileMemory({ botId, onClose }: { readonly botId: string; readonly onClose: () => void }) {
	const [content, setContent] = useState<string | undefined>(undefined);
	useEffect(() => {
		let current = true;
		api["bots.memory.get"]({ botId })
			.then((memory) => current && setContent(memory.content))
			.catch(report);
		return () => {
			current = false;
		};
	}, [botId]);

	const bytes = new TextEncoder().encode(content ?? "").length;
	const tooLarge = bytes > MEMORY_LIMIT_BYTES;
	const save = async (event: FormEvent): Promise<void> => {
		event.preventDefault();
		if (content === undefined) return;
		try {
			await api["bots.memory.update"]({ botId, content });
			onClose();
		} catch (error) {
			report(error);
		}
	};
	return (
		<form className="profile-memory" onSubmit={save}>
			<label className="field">
				<span>What this Bot remembers across conversations and new topics</span>
				<textarea
					rows={10}
					value={content ?? ""}
					disabled={content === undefined}
					placeholder="Nothing yet. The Bot saves lasting preferences here, and you can edit them."
					onChange={(event) => setContent(event.target.value)}
					aria-label="Memory"
				/>
			</label>
			<div className="dialog-actions">
				<span className={tooLarge ? "memory-size is-over" : "memory-size"}>
					{bytes.toLocaleString()} of {MEMORY_LIMIT_BYTES.toLocaleString()} bytes
				</span>
				<button type="button" onClick={onClose}>
					Cancel
				</button>
				<button type="submit" className="primary" disabled={content === undefined || tooLarge}>
					Save memory
				</button>
			</div>
		</form>
	);
}
