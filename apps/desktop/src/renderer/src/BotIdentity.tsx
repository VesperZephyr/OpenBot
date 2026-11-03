import { useState } from "react";
import { defaultAvatar, type AvatarChange, type GeneratedAvatar } from "@openbot/protocol";
import { Avatar, AvatarStack } from "./Avatar";
import { AvatarEditor } from "./AvatarEditor";
import { t } from "./i18n";
import { api, refreshBots, report, useStore } from "./store";

const MOTIFS = ["leaf", "glasses", "cap"] as const;

/** Wide-layout Bot card: identity fields plus the existing avatar editor. */
export function BotIdentity({ botId, editing }: { readonly botId: string; readonly editing: boolean }) {
	const bot = useStore((state) => state.bots.find((candidate) => candidate.botId === botId));
	const [pending, setPending] = useState<AvatarChange>();
	const [saving, setSaving] = useState(false);
	if (!bot) return null;
	const generated: GeneratedAvatar =
		pending?.kind === "generated"
			? pending
			: bot.avatar?.kind === "generated"
				? bot.avatar
				: defaultAvatar(bot.botId);
	const save = async (change: AvatarChange): Promise<void> => {
		if (saving) return;
		setPending(change);
		setSaving(true);
		try {
			const current = useStore.getState().bots.find((candidate) => candidate.botId === bot.botId) ?? bot;
			await api["bots.update"]({ botId: bot.botId, expectedRevision: current.revision, avatar: change });
			await refreshBots();
			setPending(undefined);
		} catch (error) {
			report(error);
		} finally {
			setSaving(false);
		}
	};
	return (
		<aside className="bot-identity" aria-label={t("Bot details")}>
			<div className="identity-avatar">
				<Avatar bot={bot} size={132} {...(pending ? { value: pending } : {})} />
			</div>
			<IdentityField label={t("Name")} value={bot.name} />
			<IdentityField label={t("Label")} value={bot.role || t("No label")} />
			{bot.instructions ? <IdentityField label={t("Prompt")} value={bot.instructions} /> : null}
			{!editing && (
				<>
					<div className="identity-motifs" role="group" aria-label={t("Avatar motif")}>
						{MOTIFS.map((motif) => (
							<button
								key={motif}
								type="button"
								aria-pressed={generated.motif === motif && (pending?.kind !== "upload")}
								disabled={saving}
								onClick={() => void save({ kind: "generated", version: 1, seed: generated.seed, motif })}
							>
								{t(motif === "leaf" ? "Leaf" : motif === "glasses" ? "Glasses" : "Cap")}
							</button>
						))}
					</div>
					<AvatarEditor
						bot={pending?.kind === "generated" ? { ...bot, avatar: pending } : bot}
						role={bot.role}
						value={pending}
						onChange={(change) => void save(change)}
						disabled={saving}
					/>
				</>
			)}
		</aside>
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
			<IdentityField label={t("Name")} value={group.name} />
			<IdentityField label={t("Label")} value={t("{count} members", { count: group.memberIds.length })} />
			{group.objective ? <IdentityField label={t("Prompt")} value={group.objective} /> : null}
		</aside>
	);
}

function IdentityField({ label, value }: { readonly label: string; readonly value: string }) {
	return (
		<div className="identity-field">
			<span>{label}</span>
			<p>{value}</p>
		</div>
	);
}
