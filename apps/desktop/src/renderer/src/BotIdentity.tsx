import { useEffect, useState, type FormEvent } from "react";
import type { AvatarChange } from "@openbot/protocol";
import { Avatar, AvatarStack } from "./Avatar";
import { AvatarEditor } from "./AvatarEditor";
import { t } from "./i18n";
import { api, refreshBots, report, useStore } from "./store";

/** Wide-layout Bot card. The intro is read-only until Edit opens the form. */
export function BotIdentity({ botId, profileOpen }: { readonly botId: string; readonly profileOpen: boolean }) {
	const bot = useStore((state) => state.bots.find((candidate) => candidate.botId === botId));
	const [form, setForm] = useState(false);
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
					<h2 className="identity-name">{bot.name}</h2>
					<p className="identity-label">{bot.role || t("No label")}</p>
					{bot.instructions ? <p className="identity-bio">{bot.instructions}</p> : null}
					<button type="button" onClick={() => setForm(true)}>
						{t("Edit")}
					</button>
				</>
			)}
		</aside>
	);
}

function IdentityForm({
	bot,
	onClose,
}: {
	readonly bot: NonNullable<ReturnType<typeof useStore.getState>["bots"][number]>;
	readonly onClose: () => void;
}) {
	const [name, setName] = useState(bot.name);
	const [role, setRole] = useState(bot.role);
	const [instructions, setInstructions] = useState(bot.instructions);
	const [avatar, setAvatar] = useState<AvatarChange>();
	const [saving, setSaving] = useState(false);
	const save = async (event: FormEvent): Promise<void> => {
		event.preventDefault();
		if (saving || !name.trim()) return;
		setSaving(true);
		try {
			const current = useStore.getState().bots.find((candidate) => candidate.botId === bot.botId) ?? bot;
			await api["bots.update"]({
				botId: bot.botId,
				expectedRevision: current.revision,
				name: name.trim(),
				role,
				instructions,
				...(avatar ? { avatar } : {}),
			});
			await refreshBots();
			onClose();
		} catch (error) {
			report(error);
			setSaving(false);
		}
	};
	return (
		<form className="identity-form" onSubmit={(event) => void save(event)}>
			<AvatarEditor bot={bot} role={role} value={avatar} onChange={setAvatar} disabled={saving} />
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
			<div className="identity-actions">
				<button type="button" onClick={onClose}>
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
			<h2 className="identity-name">{group.name}</h2>
			<p className="identity-label">{t("{count} members", { count: group.memberIds.length })}</p>
			{group.objective ? <p className="identity-bio">{group.objective}</p> : null}
		</aside>
	);
}
