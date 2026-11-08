import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from "react";
import { defaultAvatar, type BotSummary, type GeneratedAvatar } from "@openbot/protocol";
import { Avatar, AvatarStack } from "./Avatar";
import { AvatarEditor } from "./AvatarEditor";
import { InterfaceIcon } from "./InterfaceIcon";
import { setDetailsOpen } from "./features/details/details-open";
import {
	beginIdentityDraft,
	discardIdentityDraft,
	identityDirty,
	identityDraftSnapshot,
	keepConflictRevision,
	keepIdentityDraft,
	motifChange,
	patchIdentityDraft,
	replaceIdentityDraft,
	requestIdentityClose,
	subscribeIdentityDraft,
} from "./features/details/identity-draft";
import { ProfileConflictNotice } from "./features/details/profile-conflict";
import { readHostError } from "../../shared/api";
import { t } from "./i18n";
import { api, openBot, refreshBots, report, setIdentityConfirmSurfaceMounted, useStore } from "./store";

const MOTIFS = ["leaf", "glasses", "cap"] as const;
const MOTIF_LABEL: Record<(typeof MOTIFS)[number], string> = { leaf: "Leaf", glasses: "Glasses", cap: "Cap" };

/** Wide-layout Bot card. The intro is read-only until Edit opens the form. */
export function BotIdentity({ botId, profileOpen }: { readonly botId: string; readonly profileOpen: boolean }) {
	const bot = useStore((state) => state.bots.find((candidate) => candidate.botId === botId));
	const draft = useSyncExternalStore(
		subscribeIdentityDraft,
		() => identityDraftSnapshot(botId),
		() => identityDraftSnapshot(botId),
	);
	const [form, setForm] = useState(() => {
		const existing = identityDraftSnapshot(botId);
		return !profileOpen && existing !== undefined && (identityDirty(existing) || existing.confirming);
	});
	const [expanded, setExpanded] = useState(false);
	useEffect(() => {
		if (profileOpen) {
			setForm(false);
			return;
		}
		if (draft?.baseline.botId === botId && (identityDirty(draft) || draft.confirming)) setForm(true);
	}, [profileOpen, botId, draft]);
	const models = useStore((state) => state.models);
	const defaultModel = useStore((state) => state.settings?.defaultModel);
	const skills = useStore((state) => state.skills);
	const closeRef = useRef<HTMLButtonElement>(null);
	const confirmSurface = bot !== undefined;
	useLayoutEffect(() => {
		if (!confirmSurface) return;
		setIdentityConfirmSurfaceMounted(true);
		return () => setIdentityConfirmSurfaceMounted(false);
	}, [confirmSurface]);
	useEffect(() => {
		closeRef.current?.focus();
	}, []);
	if (!bot) return null;
	const effective = bot.model ?? defaultModel;
	const modelName =
		models.find((model) => model.provider === effective?.provider && model.modelId === effective.modelId)?.name ??
		(effective ? `${effective.provider} / ${effective.modelId}` : t("Use the default model"));
	const skillNames = (bot.defaultSkills ?? []).flatMap((ref) => {
		const skill = skills?.find((item) => item.name === ref.name && item.available && !item.deleted);
		return skill ? [skill.name] : [];
	});
	return (
		<aside className="bot-identity" aria-label={t("Bot details")}>
			{form && !profileOpen ? (
				<IdentityForm bot={bot} onClose={() => setForm(false)} />
			) : (
				<>
					<div className="identity-toolbar">
						<button type="button" onClick={() => setForm(true)}>
							{t("Edit")}
						</button>
						<button
							ref={closeRef}
							type="button"
							aria-label={t("Close details")}
							onClick={() => {
								if (requestIdentityClose(botId, { kind: "close" })) setDetailsOpen(false);
							}}
						>
							<InterfaceIcon name="close" />
						</button>
					</div>
					<div className="identity-avatar">
						<Avatar bot={bot} size={96} />
					</div>
					<p className="identity-name">{bot.name}</p>
					{bot.role ? (
						<p className="identity-label">
							<span className="identity-chip">{bot.role}</span>
						</p>
					) : null}
					{bot.instructions ? (
						<div className="identity-prompt">
							<p className="identity-kicker">{t("Prompt")}</p>
							<p className={`identity-bio${expanded ? " is-open" : ""}`}>{bot.instructions}</p>
							<button type="button" className="identity-expand" onClick={() => setExpanded((value) => !value)}>
								{t(expanded ? "Show less" : "Show more")}
							</button>
						</div>
					) : null}
					<p className="identity-kicker">{t("Model")}</p>
					<p className="identity-fact">{modelName}</p>
					{skillNames.length > 0 ? (
						<>
							<p className="identity-kicker">{t("Skills")}</p>
							<p className="identity-fact">{skillNames.join(" · ")}</p>
						</>
					) : null}
				</>
			)}
		</aside>
	);
}

export function IdentityForm({ bot, onClose }: { readonly bot: BotSummary; readonly onClose: () => void }) {
	// The draft, discard, and save stay on the Bot that opened this form, even if `bot` later names another Bot.
	const [openedBot] = useState(bot);
	const botId = openedBot.botId;
	const draft = useSyncExternalStore(
		subscribeIdentityDraft,
		() => identityDraftSnapshot(botId),
		() => identityDraftSnapshot(botId),
	);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");
	useEffect(() => {
		if (identityDraftSnapshot(botId)) return;
		beginIdentityDraft(openedBot);
	}, [botId, openedBot]);
	const finishDiscard = (): void => {
		const pending = discardIdentityDraft(botId);
		onClose();
		if (pending?.kind === "close") setDetailsOpen(false);
		else if (pending?.kind === "bot") void openBot(pending.botId);
	};
	const requestClose = (): void => {
		if (requestIdentityClose(botId)) onClose();
	};
	if (!draft) return null;
	const { baseline, name, role, instructions, avatar, confirming, conflictRevision } = draft;
	const generated =
		avatar?.kind === "generated"
			? avatar
			: avatar
				? undefined
				: baseline.avatar?.kind === "generated"
					? baseline.avatar
					: baseline.avatar
						? undefined
						: defaultAvatar(baseline.botId);
	const seed =
		avatar?.kind === "generated" ? avatar.seed : baseline.avatar?.kind === "generated" ? baseline.avatar.seed : defaultAvatar(baseline.botId).seed;
	let editorBot = bot;
	if (bot.botId !== baseline.botId) {
		const { avatar: _avatar, ...rest } = bot;
		editorBot = {
			...rest,
			botId: baseline.botId,
			name: baseline.name,
			role: baseline.role,
			instructions: baseline.instructions,
			revision: baseline.revision,
			...(baseline.avatar ? { avatar: baseline.avatar } : {}),
		};
	}
	const onKeyDown = (event: KeyboardEvent): void => {
		if (event.key !== "Escape") return;
		event.preventDefault();
		event.stopPropagation();
		if (confirming) finishDiscard();
		else requestClose();
	};
	const chooseMotif = (motif: GeneratedAvatar["motif"]): void => {
		patchIdentityDraft(baseline.botId, { avatar: motifChange(seed, motif) });
	};
	const reload = async (): Promise<void> => {
		const fresh = (await api["bots.list"]({})).find((item) => item.botId === baseline.botId);
		if (fresh && (conflictRevision === undefined || fresh.revision === conflictRevision)) replaceIdentityDraft(fresh);
	};
	const save = async (event: FormEvent): Promise<void> => {
		event.preventDefault();
		if (saving || !name.trim()) return;
		setSaving(true);
		setError("");
		try {
			await api["bots.update"]({
				botId: baseline.botId,
				expectedRevision: baseline.revision,
				name: name.trim(),
				role,
				instructions,
				...(avatar ? { avatar } : {}),
			});
			await refreshBots();
			discardIdentityDraft(baseline.botId);
			onClose();
		} catch (caught) {
			const failure = readHostError(caught);
			const current = identityDraftSnapshot(baseline.botId);
			if (failure.code === "request_conflict" && failure.details?.currentRevision !== undefined) {
				const fresh = (await api["bots.list"]({})).find((item) => item.botId === baseline.botId);
				if (fresh && fresh.revision === failure.details.currentRevision) {
					if (current && identityDirty(current)) patchIdentityDraft(baseline.botId, { conflictRevision: fresh.revision });
					else replaceIdentityDraft(fresh);
					report(caught);
					setSaving(false);
					return;
				}
			}
			setError(t(failure.message));
			report(caught);
			setSaving(false);
		}
	};
	return (
		<form className="identity-form" onSubmit={(event) => void save(event)} onKeyDown={onKeyDown}>
			<AvatarEditor bot={editorBot} role={role} value={avatar} onChange={(value) => patchIdentityDraft(baseline.botId, { avatar: value })} disabled={saving} />
			<div className="identity-motifs" role="group" aria-label={t("Avatar motif")}>
				{MOTIFS.map((motif) => (
					<button key={motif} type="button" aria-pressed={generated?.motif === motif} disabled={saving} onClick={() => chooseMotif(motif)}>
						{t(MOTIF_LABEL[motif])}
					</button>
				))}
			</div>
			<label className="identity-field">
				<span>{t("Name")}</span>
				<input required maxLength={200} value={name} onChange={(event) => patchIdentityDraft(baseline.botId, { name: event.target.value })} />
			</label>
			<label className="identity-field">
				<span>{t("Label")}</span>
				<input maxLength={200} value={role} onChange={(event) => patchIdentityDraft(baseline.botId, { role: event.target.value })} />
			</label>
			<label className="identity-field">
				<span>{t("Prompt")}</span>
				<textarea rows={4} value={instructions} onChange={(event) => patchIdentityDraft(baseline.botId, { instructions: event.target.value })} />
			</label>
			{conflictRevision !== undefined ? (
				<ProfileConflictNotice
					onReload={() => void reload()}
					onKeepEditing={() => keepConflictRevision(baseline.botId, conflictRevision)}
				/>
			) : error ? (
				<p className="identity-alert" role="alert">
					{error}
				</p>
			) : null}
			{confirming ? (
				<div className="identity-confirm" role="alertdialog" aria-label={t("Discard these edits?")}>
					<p>{t("Discard these edits?")}</p>
					<div className="identity-actions">
						<button type="button" onClick={() => keepIdentityDraft(baseline.botId)}>
							{t("Keep editing")}
						</button>
						<button type="button" onClick={finishDiscard}>
							{t("Discard")}
						</button>
					</div>
				</div>
			) : (
				<div className="identity-actions">
					<button type="button" onClick={requestClose}>
						{t("Cancel")}
					</button>
					<button type="submit" className="primary" disabled={saving || !name.trim()}>
						{t("Save")}
					</button>
				</div>
			)}
		</form>
	);
}

/** Group card in the same slot: name, objective, and member avatars. */
export function GroupIdentity({ groupId }: { readonly groupId: string }) {
	const group = useStore((state) => state.groups.find((candidate) => candidate.groupId === groupId));
	const bots = useStore((state) => state.bots);
	if (!group) return null;
	const members = group.memberIds.map((id) => bots.find((bot) => bot.botId === id) ?? { botId: id });
	return (
		<aside className="bot-identity group-identity" aria-label={t("Group details")}>
			<div className="identity-avatar">
				<AvatarStack bots={members} size={64} />
			</div>
			<p className="identity-name">{group.name}</p>
			<p className="identity-label">{t("{count} members", { count: group.memberIds.length })}</p>
			{group.objective ? <p className="identity-bio">{group.objective}</p> : null}
		</aside>
	);
}
