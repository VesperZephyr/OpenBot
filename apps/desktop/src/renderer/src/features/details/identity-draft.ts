import type { AvatarChange, BotAvatar, BotSummary, GeneratedAvatar } from "@openbot/protocol";

type IdentityBot = Pick<BotSummary, "botId" | "name" | "role" | "instructions" | "revision" | "avatar">;

export type IdentityPending = { readonly kind: "bot"; readonly botId: string } | { readonly kind: "close" };

export type IdentityBaseline = {
	readonly botId: string;
	readonly name: string;
	readonly role: string;
	readonly instructions: string;
	readonly revision: number;
	readonly avatar: BotAvatar | undefined;
};

export type IdentityDraft = {
	readonly baseline: IdentityBaseline;
	readonly name: string;
	readonly role: string;
	readonly instructions: string;
	readonly avatar: AvatarChange | undefined;
	readonly confirming: boolean;
	readonly pending?: IdentityPending;
	readonly conflictRevision?: number;
};

let draft: IdentityDraft | undefined;
const listeners = new Set<() => void>();

function publish(next: IdentityDraft | undefined): void {
	draft = next;
	for (const listener of listeners) listener();
}

export function identityDraftSnapshot(): IdentityDraft | undefined {
	return draft;
}

export function subscribeIdentityDraft(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function resetIdentityDraft(): void {
	publish(undefined);
}

export function sameGenerated(change: AvatarChange | undefined, current: BotAvatar | undefined): boolean {
	if (!change) return true;
	if (change.kind !== "generated" || current?.kind !== "generated") return false;
	return current.seed === change.seed && current.motif === change.motif && current.version === change.version;
}

export function identityDirty(value: IdentityDraft | undefined): boolean {
	if (!value) return false;
	return (
		value.name !== value.baseline.name ||
		value.role !== value.baseline.role ||
		value.instructions !== value.baseline.instructions ||
		!sameGenerated(value.avatar, value.baseline.avatar)
	);
}

function baselineOf(bot: IdentityBot): IdentityBaseline {
	return {
		botId: bot.botId,
		name: bot.name,
		role: bot.role,
		instructions: bot.instructions,
		revision: bot.revision,
		avatar: bot.avatar,
	};
}

/** Keep an existing draft for this Bot, including one restored after the inspector unmounts. */
export function beginIdentityDraft(bot: IdentityBot): IdentityDraft {
	if (draft?.baseline.botId === bot.botId) return draft;
	const baseline = baselineOf(bot);
	const next: IdentityDraft = {
		baseline,
		name: baseline.name,
		role: baseline.role,
		instructions: baseline.instructions,
		avatar: undefined,
		confirming: false,
	};
	publish(next);
	return next;
}

export function patchIdentityDraft(patch: Partial<Pick<IdentityDraft, "name" | "role" | "instructions" | "avatar" | "confirming" | "conflictRevision" | "pending">>): void {
	if (!draft) return;
	publish({ ...draft, ...patch });
}

export function requestIdentityClose(pending?: IdentityPending): boolean {
	if (!draft || !identityDirty(draft)) {
		if (draft) publish(undefined);
		return true;
	}
	const { pending: _previous, ...rest } = draft;
	publish(pending ? { ...rest, confirming: true, pending } : { ...rest, confirming: true });
	return false;
}

export function keepIdentityDraft(): void {
	if (!draft) return;
	const { pending: _pending, ...rest } = draft;
	publish({ ...rest, confirming: false });
}

export function discardIdentityDraft(): IdentityPending | undefined {
	const pending = draft?.pending;
	publish(undefined);
	return pending;
}

export function replaceIdentityDraft(bot: IdentityBot): void {
	const baseline = baselineOf(bot);
	publish({
		baseline,
		name: baseline.name,
		role: baseline.role,
		instructions: baseline.instructions,
		avatar: undefined,
		confirming: false,
	});
}

export function keepConflictRevision(revision: number): void {
	if (!draft) return;
	const { conflictRevision: _revision, ...rest } = draft;
	publish({ ...rest, baseline: { ...draft.baseline, revision } });
}

export function motifChange(seed: number, motif: GeneratedAvatar["motif"]): AvatarChange {
	return { kind: "generated", version: 1, seed, motif };
}
