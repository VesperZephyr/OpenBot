/** Local UI state only. Host snapshots remain the sole source of accepted messages. */
export type ConversationKey = `bot:${string}` | `group:${string}`;
export type ComposerDraft = { version: 1; text: string; recipientIds: readonly string[]; revision: number; updatedAt: number };
export type SendAttempt = {
	requestId: string;
	conversationKey: ConversationKey;
	text: string;
	recipientIds: readonly string[];
	draftRevision: number;
	state: "pending" | "uncertain";
};
export type ComposerRecord = { draft: ComposerDraft; attempt?: SendAttempt };
export const COMPOSER_STORAGE_KEY = "openbot.composers.v1";
const empty: ComposerRecord = { draft: { version: 1, text: "", recipientIds: [], revision: 0, updatedAt: 0 } };
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const keyValid = (v: string): v is ConversationKey => /^(bot|group):.+$/.test(v);
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
export class ComposerStore {
	private records: Readonly<Record<string, ComposerRecord>> = {};
	private listeners = new Set<() => void>();
	warning: string | undefined;
	private storage: Pick<Storage, "getItem" | "setItem"> | undefined;
	constructor(storage?: Pick<Storage, "getItem" | "setItem">) {
		this.storage = storage;
		try {
			const raw = storage?.getItem(COMPOSER_STORAGE_KEY);
			if (!raw) return;
			const saved = JSON.parse(raw);
			if (saved.version !== 1 || !saved.records || typeof saved.records !== "object" || Array.isArray(saved.records)) throw Error();
			const records: Record<string, ComposerRecord> = {};
			for (const [key, value] of Object.entries(saved.records)) {
				const r = value as ComposerRecord;
				if (
					!keyValid(key) ||
					!r?.draft ||
					r.draft.version !== 1 ||
					typeof r.draft.text !== "string" ||
					!strings(r.draft.recipientIds) ||
					!integer(r.draft.revision) ||
					!integer(r.draft.updatedAt)
				)
					throw Error();
				const a = r.attempt;
				if (
					a &&
					(a.conversationKey !== key ||
						typeof a.requestId !== "string" ||
						!a.requestId ||
						typeof a.text !== "string" ||
						!strings(a.recipientIds) ||
						!integer(a.draftRevision) ||
						!["pending", "uncertain"].includes(a.state))
				)
					throw Error();
				records[key] = { draft: r.draft, ...(a ? { attempt: { ...a, state: "uncertain" } } : {}) };
			}
			this.records = records;
		} catch {
			this.warning = "Saved drafts could not be loaded. The original local record has been kept.";
		}
	}
	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};
	snapshot = () => this.records;
	get = (key: ConversationKey): ComposerRecord => this.records[key] ?? empty;
	private save(): boolean {
		try {
			if (!this.storage) throw Error();
			this.storage.setItem(COMPOSER_STORAGE_KEY, JSON.stringify({ version: 1, records: this.records }));
			this.warning = undefined;
			return true;
		} catch {
			this.warning = "Drafts could not be saved on this Mac. Keep this window open and copy your text.";
			return false;
		}
	}
	private publish() {
		for (const fn of this.listeners) fn();
	}
	edit(key: ConversationKey, change: Partial<Pick<ComposerDraft, "text" | "recipientIds">>) {
		const old = this.get(key);
		this.records = {
			...this.records,
			[key]: { ...old, draft: { ...old.draft, ...change, revision: old.draft.revision + 1, updatedAt: Date.now() } },
		};
		this.save();
		this.publish();
	}
	remove(key: ConversationKey) {
		if (!this.records[key]) return;
		const next = { ...this.records };
		delete next[key];
		this.records = next;
		this.save();
		this.publish();
	}
	dismiss(key: ConversationKey) {
		this.records = { ...this.records, [key]: { draft: this.get(key).draft } };
		this.save();
		this.publish();
	}
	async send(key: ConversationKey, dispatch: (attempt: SendAttempt) => Promise<unknown>, retry = false): Promise<boolean> {
		const old = this.get(key);
		if (old.attempt?.state === "pending" || (old.attempt && !retry) || (!old.attempt && !old.draft.text.trim())) return false;
		const attempt: SendAttempt = old.attempt
			? { ...old.attempt, state: "pending" }
			: {
					requestId: crypto.randomUUID(),
					conversationKey: key,
					text: old.draft.text.trim(),
					recipientIds: [...old.draft.recipientIds],
					draftRevision: old.draft.revision,
					state: "pending",
				};
		this.records = { ...this.records, [key]: { ...old, attempt } };
		if (!this.save()) {
			this.records = { ...this.records, [key]: { ...old } };
			this.publish();
			return false;
		}
		this.publish();
		try {
			await dispatch(attempt);
			const current = this.records[key];
			if (current?.attempt?.requestId !== attempt.requestId) return true;
			this.records = {
				...this.records,
				[key]: {
					draft:
						current.draft.revision === attempt.draftRevision
							? { ...empty.draft, revision: current.draft.revision + 1, updatedAt: Date.now() }
							: current.draft,
				},
			};
			this.save();
			this.publish();
			return true;
		} catch {
			const current = this.records[key];
			if (current?.attempt?.requestId === attempt.requestId) {
				this.records = { ...this.records, [key]: { ...current, attempt: { ...attempt, state: "uncertain" } } };
				this.save();
				this.publish();
			}
			return false;
		}
	}
}
