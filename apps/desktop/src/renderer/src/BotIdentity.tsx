import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { defaultAvatar, type AvatarChange, type BotAvatar, type BotSummary, type GeneratedAvatar } from "@openbot/protocol";
import { Avatar, AvatarStack } from "./Avatar";
import { AvatarEditor } from "./AvatarEditor";
import { t } from "./i18n";
import { api, errorMessage, refreshBots, report, useStore } from "./store";

const MOTIFS = ["leaf", "glasses", "cap"] as const;
const MOTIF_LABEL: Record<(typeof MOTIFS)[number], string> = { leaf: "Leaf", glasses: "Glasses", cap: "Cap" };

/** Wide-layout Bot card. The intro is read-only until Edit opens the form. */
export function BotIdentity({ botId, profileOpen }: { readonly botId: string; readonly profileOpen: boolean }) {
	const bot = useStore((state) => state.bots.find((candidate) => candidate.botId === botId));
	const [form, setForm] = useState(false);
	const [expanded, setExpanded] = useState(false);
	useEffect(() => {
		if (profileOpen) setForm(false);
	}, [profileOpen]);
	if (!bot) return null;
	return (
		<aside className="bot-identity" aria-label={t("Bot details")}>
			{form && !profileOpen ? (
				<IdentityForm bot={bot} onClose={() => setForm(false)} />
			) : (
				<>
					<div className="identity-avatar">
						<Avatar bot={bot} size={132} />
					</div>
					<p className="identity-name">{bot.name}</p>
					{bot.role ? <p className="identity-label">{bot.role}</p> : null}
					{bot.instructions ? (
						<div className="identity-prompt">
							<p className="identity-kicker">{t("Prompt")}</p>
							<p className={`identity-bio${expanded ? " is-open" : ""}`}>{bot.instructions}</p>
							<button type="button" className="identity-expand" onClick={() => setExpanded((open) => !open)}>
								{t(expanded ? "Show less" : "Show more")}
							</button>
						</div>
					) : null}
					<button type="button" onClick={() => setForm(true)}>
						{t("Edit")}
					</button>
				</>
			)}
		</aside>
	);
}

function sameGenerated(change: AvatarChange | undefined, current: BotAvatar | undefined): boolean {
	if (!change) return true;
	if (change.kind !== "generated" || current?.kind !== "generated") return false;
	return current.seed === change.seed && current.motif === change.motif && current.version === change.version;
}

function IdentityForm({ bot, onClose }: { readonly bot: BotSummary; readonly onClose: () => void }) {
	const [baseline] = useState({
		name: bot.name,
		role: bot.role,
		instructions: bot.instructions,
		revision: bot.revision,
		avatar: bot.avatar,
	});
	const [name, setName] = useState(baseline.name);
	const [role, setRole] = useState(baseline.role);
	const [instructions, setInstructions] = useState(baseline.instructions);
	const [avatar, setAvatar] = useState<AvatarChange>();
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");
	const generated =
		avatar?.kind === "generated"
			? avatar
			: avatar
				? undefined
				: baseline.avatar?.kind === "generated"
					? baseline.avatar
					: baseline.avatar
						? undefined
						: defaultAvatar(bot.botId);
	const seed =
		avatar?.kind === "generated"
			? avatar.seed
			: baseline.avatar?.kind === "generated"
				? baseline.avatar.seed
				: defaultAvatar(bot.botId).seed;
	const dirty = name !== baseline.name || role !== baseline.role || instructions !== baseline.instructions || !sameGenerated(avatar, baseline.avatar);
	const close = (): void => {
		if (dirty && !window.confirm(t("Discard these edits?"))) return;
		onClose();
	};
	const onKeyDown = (event: KeyboardEvent): void => {
		if (event.key !== "Escape") return;
		event.preventDefault();
		event.stopPropagation();
		close();
	};
	const chooseMotif = (motif: GeneratedAvatar["motif"]): void => {
		setAvatar({ kind: "generated", version: 1, seed, motif });
	};
	const save = async (event: FormEvent): Promise<void> => {
		event.preventDefault();
		if (saving || !name.trim()) return;
		setSaving(true);
		setError("");
		try {
			await api["bots.update"]({
				botId: bot.botId,
				expectedRevision: baseline.revision,
				name: name.trim(),
				role,
				instructions,
				...(avatar ? { avatar } : {}),
			});
			await refreshBots();
			onClose();
		} catch (caught) {
			const message = errorMessage(caught);
			const conflict = message.includes("Profile changed");
			setError(conflict ? `${t(message)} ${t("Close this editor and open it again.")}` : t(message));
			report(caught);
			setSaving(false);
		}
	};
	return (
		<form className="identity-form" onSubmit={(event) => void save(event)} onKeyDown={onKeyDown}>
			<AvatarEditor bot={bot} role={role} value={avatar} onChange={setAvatar} disabled={saving} />
			<div className="identity-motifs" role="group" aria-label={t("Avatar motif")}>
				{MOTIFS.map((motif) => (
					<button key={motif} type="button" aria-pressed={generated?.motif === motif} disabled={saving} onClick={() => chooseMotif(motif)}>
						{t(MOTIF_LABEL[motif])}
					</button>
				))}
			</div>
			<label className="identity-field">
				<span>{t("Name")}</span>
				<input required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} />
			</label>
			<label className="identity-field">
				<span>{t("Label")}</span>
				<input maxLength={200} value={role} onChange={(event) => setRole(event.target.value)} />
			</label>
			<label className="identity-field">
				<span>{t("Prompt")}</span>
				<textarea rows={4} value={instructions} onChange={(event) => setInstructions(event.target.value)} />
			</label>
			{error ? (
				<p className="identity-alert" role="alert">
					{error}
				</p>
			) : null}
			<div className="identity-actions">
				<button type="button" onClick={close}>
					{t("Cancel")}
				</button>
				<button type="submit" className="primary" disabled={saving || !name.trim()}>
					{t("Save")}
				</button>
			</div>
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
