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

const drafts = new Map<string, IdentityDraft>();
let confirmSurfaceMounted = false;
const listeners = new Set<() => void>();

function publish(botId: string, next: IdentityDraft | undefined): void {
	if (next) drafts.set(botId, next);
	else drafts.delete(botId);
	for (const listener of listeners) listener();
}

export function identityDraftSnapshot(botId: string): IdentityDraft | undefined {
	return drafts.get(botId);
}

export function subscribeIdentityDraft(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function resetIdentityDraft(): void {
	confirmSurfaceMounted = false;
	drafts.clear();
	for (const listener of listeners) listener();
}

/** True while the wide-layout card that can show the discard confirmation is mounted. */
export function identityConfirmSurfaceMounted(): boolean {
	return confirmSurfaceMounted;
}

export function setIdentityConfirmSurfaceMounted(mounted: boolean): void {
	confirmSurfaceMounted = mounted;
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

/** Return this Bot's draft, creating one when this Bot has none. Other Bots' drafts stay stored. */
export function beginIdentityDraft(bot: IdentityBot): IdentityDraft {
	const existing = drafts.get(bot.botId);
	if (existing) return existing;
	const baseline = baselineOf(bot);
	const next: IdentityDraft = {
		baseline,
		name: baseline.name,
		role: baseline.role,
		instructions: baseline.instructions,
		avatar: undefined,
		confirming: false,
	};
	publish(bot.botId, next);
	return next;
}

export function patchIdentityDraft(
	botId: string,
	patch: Partial<Pick<IdentityDraft, "name" | "role" | "instructions" | "avatar" | "confirming" | "conflictRevision" | "pending">>,
): void {
	const current = drafts.get(botId);
	if (!current) return;
	publish(botId, { ...current, ...patch });
}

export function requestIdentityClose(botId: string, pending?: IdentityPending, options?: { readonly confirmVisible?: boolean }): boolean {
	const current = drafts.get(botId);
	if (!current || !identityDirty(current)) {
		if (current) publish(botId, undefined);
		return true;
	}
	if (options?.confirmVisible === false) return true;
	const { pending: _previous, ...rest } = current;
	publish(botId, pending ? { ...rest, confirming: true, pending } : { ...rest, confirming: true });
	return false;
}

export function keepIdentityDraft(botId: string): void {
	const current = drafts.get(botId);
	if (!current) return;
	const { pending: _pending, ...rest } = current;
	publish(botId, { ...rest, confirming: false });
}

export function discardIdentityDraft(botId: string): IdentityPending | undefined {
	const pending = drafts.get(botId)?.pending;
	if (drafts.has(botId)) publish(botId, undefined);
	return pending;
}

export function retainIdentityDrafts(botIds: readonly string[]): void {
	const live = new Set(botIds);
	for (const botId of drafts.keys()) if (!live.has(botId)) discardIdentityDraft(botId);
}

export function replaceIdentityDraft(bot: IdentityBot): void {
	const baseline = baselineOf(bot);
	publish(bot.botId, {
		baseline,
		name: baseline.name,
		role: baseline.role,
		instructions: baseline.instructions,
		avatar: undefined,
		confirming: false,
	});
}

export function keepConflictRevision(botId: string, revision: number): void {
	const current = drafts.get(botId);
	if (!current) return;
	const { conflictRevision: _revision, ...rest } = current;
	publish(botId, { ...rest, baseline: { ...current.baseline, revision } });
}

export function motifChange(seed: number, motif: GeneratedAvatar["motif"]): AvatarChange {
	return { kind: "generated", version: 1, seed, motif };
}
