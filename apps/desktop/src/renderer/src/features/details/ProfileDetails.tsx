import { type FormEvent, useState } from "react";
import type { AvatarChange, BotSummary, ModelRef, SkillRef, ThinkingLevel } from "@openbot/protocol";
import { AvatarEditor } from "../../AvatarEditor";
import { Avatar, PersonalStar } from "../../Avatar";
import { BotLibrary, BotRoutines } from "../../BotResources";
import { ProfileMemory } from "../../ProfileMemory";
import { RoleSkills } from "../../RoleSkills";
import { UsagePanel } from "../../UsagePanel";
import { DetailsPanel } from "../../ConversationUI";
import { t } from "../../i18n";
import { api, errorMessage, refreshBots, report, useStore } from "../../store";
import { ModelSelect } from "../../ModelSelect";

export function ProfileDetails({ bot, onClose }: { readonly bot: BotSummary; readonly onClose: () => void }) {
	return (
		<DetailsPanel modal heading={<span className="bot-profile-heading"><Avatar bot={bot} size={32} />{bot.name}</span>} title={t("Conversation details")} onClose={onClose}>
			<EditProfile bot={bot} onClose={onClose} />
		</DetailsPanel>
	);
}

export function EditProfile({ bot, onClose }: { readonly bot: BotSummary; readonly onClose: () => void }) {
	const [tab, setTab] = useState<"profile" | "memory" | "routines" | "library">("profile");
	return (
		<div className="profile">
			{bot.kind==="core"&&<button onClick={()=>{onClose();useStore.setState({view:{kind:"tasks",botId:bot.botId}});}}>{t("Tasks")}</button>}
            <div className="profile-tabs" role="tablist">
				<button type="button" role="tab" aria-selected={tab === "profile"} onClick={() => setTab("profile")}>
					{t("Profile")}
				</button>
				<button type="button" role="tab" aria-selected={tab === "memory"} onClick={() => setTab("memory")}>
					{t("Memory")}
				</button>
				<button type="button" role="tab" aria-selected={tab === "routines"} onClick={() => setTab("routines")}>{t("Routines")}</button>
				<button type="button" role="tab" aria-selected={tab === "library"} onClick={() => setTab("library")}>{t("Library")}</button>
			</div>
			{tab === "routines" && <BotRoutines botId={bot.botId} onClose={onClose} />}
			{tab === "library" && <BotLibrary botId={bot.botId} onClose={onClose} />}
			<div hidden={tab !== "profile"}>
				<ProfileForm bot={bot} onClose={onClose} />
				<UsagePanel botId={bot.botId} onNavigate={onClose} />
			</div>
			<div hidden={tab !== "memory"}>
				<ProfileMemory botId={bot.botId} onClose={onClose} />
			</div>
		</div>
	);
}

const THINKING_LABEL: Record<ThinkingLevel, string> = { off: "Off", low: "Low", medium: "Medium", high: "High" };

function ProfileForm({ bot, onClose }: { readonly bot: BotSummary; readonly onClose: () => void }) {
	const [revision, setRevision] = useState(bot.revision);
	const [avatar, setAvatar] = useState<AvatarChange>();
	const [profileBase, setProfileBase] = useState(bot);
	const [defaultSkills, setDefaultSkills] = useState<readonly SkillRef[]>(bot.defaultSkills ?? []);
	const [saveError, setSaveError] = useState("");
	const [saving, setSaving] = useState(false);
	const [name, setName] = useState(bot.name);
	const [role, setRole] = useState(bot.role);
	const [instructions, setInstructions] = useState(bot.instructions);
	const [model, setModel] = useState<ModelRef | undefined>(bot.model);
	const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(bot.thinkingLevel ?? "off");
	const models = useStore((state) => state.models);
	const defaultModel = useStore((state) => state.settings?.defaultModel);
	const effective = model ?? defaultModel;
	const reasoning = models.some(
		(candidate) =>
			candidate.reasoning && candidate.provider === effective?.provider && candidate.modelId === effective.modelId,
	);
	const save = async (event: FormEvent): Promise<void> => {
		event.preventDefault();
		if (saving || !name.trim()) return;
		setSaving(true);
		try {
			await api["bots.update"]({
				botId: bot.botId,
				expectedRevision: revision,
				...(avatar ? { avatar } : {}),
				defaultSkills,
				name: name.trim() || bot.name,
				role,
				instructions,
				model: model ?? null,
				...(reasoning ? { thinkingLevel } : {}),
			});
			await refreshBots();
			onClose();
		} catch (error) {
			setSaveError(errorMessage(error));
		} finally {
			setSaving(false);
		}
	};
	return (
		<form className="profile-form" onSubmit={save}>
			<div className="profile-layout">
				<AvatarEditor bot={profileBase} role={role} value={avatar} onChange={setAvatar} disabled={saving} />
				<div className="profile-fields">
					{saveError && (
						<div role="alert">
							{t(saveError)}{" "}
							<button
								type="button"
								disabled={saving}
								onClick={() =>
									void api["bots.list"]({})
										.then((bots) => {
											const fresh = bots.find((item) => item.botId === bot.botId);
											if (!fresh) return;
											setRevision(fresh.revision);
											setAvatar(undefined);
											setProfileBase(fresh);
											setDefaultSkills(fresh.defaultSkills ?? []);
											setName(fresh.name);
											setRole(fresh.role);
											setInstructions(fresh.instructions);
											setModel(fresh.model);
											setThinkingLevel(fresh.thinkingLevel ?? "off");
											setSaveError("");
										})
										.catch(report)
								}
							>
								{t("Reload profile")}
							</button>
						</div>
					)}
					<div className="profile-grid">
						<label className="field">
							<span>{t("Name")}</span>
							<input required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} />
						</label>
						<label className="field">
							<span>{t("Label")}</span>
							<input
								maxLength={200}
								value={role}
								placeholder={t("Research")}
								onChange={(event) => setRole(event.target.value)}
							/>
						</label>
					</div>
					<label className="field">
						<span>{t("Prompt")}</span>
						<textarea
							rows={4}
							aria-label={t("Prompt")}
							value={instructions}
							placeholder={t("Own the weekly account review. Never send external messages without approval.")}
							onChange={(event) => setInstructions(event.target.value)}
						/>
					</label>
					<details className="profile-advanced">
						<summary>{t("Model and skills")}</summary>
						<p className="field-hint">
							{t(
								"Prompt defines this Bot's role and behavior. Saved changes apply to the next model request; a reply already in progress uses its existing context.",
							)}
						</p>
						<div className="memory-meta">
							{t("Revision")} {revision}
						</div>
						<div className="profile-grid">
							<label className="field">
								<span>{t("Model")}</span>
								<ModelSelect value={model} onChange={setModel} emptyLabel={t("Use the default model")} />
							</label>
							{reasoning && (
								<label className="field">
									<span>{t("Thinking")}</span>
									<select
										value={thinkingLevel}
										onChange={(event) => setThinkingLevel(event.target.value as ThinkingLevel)}
									>
										{(Object.keys(THINKING_LABEL) as ThinkingLevel[]).map((level) => (
											<option key={level} value={level}>
												{t(THINKING_LABEL[level])}
											</option>
										))}
									</select>
								</label>
							)}
						</div>
						<RoleSkills value={defaultSkills} onChange={setDefaultSkills} disabled={saving} />
					</details>
					{bot.kind === "core" && (
						<p className="profile-protection">
							<PersonalStar /> {t("Your personal assistant. Change its name and avatar; it cannot be deleted.")}
						</p>
					)}
				</div>
			</div>
			<div className="dialog-actions">
				<button type="button" onClick={onClose}>
					{t("Cancel")}
				</button>
				<button type="submit" className="primary" disabled={saving || !name.trim()}>
					{t("Save profile")}
				</button>
			</div>
		</form>
	);
}
