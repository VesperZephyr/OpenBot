import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import type {
	BotTemplateV1,
	ImportChoices,
	ImportResult,
	ModelChoice,
	ModelSummary,
	SkillChoice,
	SkillVersion,
	TemplateReview,
} from "@openbot/protocol";
import { api, errorMessage, openBot, refreshBots, useStore } from "./store";
import { Avatar } from "./Avatar";
import { t } from "./i18n";
import "./bot-templates.css";
export const PENDING_TEMPLATE = "openbot.pending-template-import.v1";
type Loaded = { review: TemplateReview; filename?: string } | { error: string } | null;
type Action = { mode: "import" | "export"; botId?: string; load: Promise<Loaded>; restoreFocus: HTMLElement | null };
export const useTemplateState = create<{ action: Action | null; profileBotId: string | null }>(() => ({
	action: null,
	profileBotId: null,
}));
async function readSelection(): Promise<Loaded> {
	try {
		const file = await window.openbot.pickBotTemplate();
		return file
			? { review: await api["bots.templates.inspect"]({ template: file.template }), filename: file.name }
			: null;
	} catch (error) {
		return { error: errorMessage(error) };
	}
}
export function beginTemplateImport(): void {
	if (!useTemplateState.getState().action)
		useTemplateState.setState({
			action: {
				mode: "import",
				load: readSelection(),
				restoreFocus: document.querySelector<HTMLElement>(".new-button"),
			},
		});
}
export function ExportTemplateItem({ botId, onDone }: { botId: string; onDone: () => void }) {
	return (
		<button
			role="menuitem"
			onClick={(event) => {
				const restoreFocus = event.currentTarget.closest(".menu")?.querySelector<HTMLElement>("button") ?? null;
				onDone();
				if (useTemplateState.getState().action) return;
				useTemplateState.setState({
					action: {
						mode: "export",
						botId,
						restoreFocus,
						load: (async () => {
							try {
								const bot = (await api["bots.list"]({})).find((b) => b.botId === botId);
								if (!bot) throw Error("Bot is unavailable");
								return { review: await api["bots.templates.export"]({ botId, expectedRevision: bot.revision }) };
							} catch (error) {
								return { error: errorMessage(error) };
							}
						})(),
					},
				});
			}}
		>
			{t("Export template")}
		</button>
	);
}
const pending = () => localStorage.getItem(PENDING_TEMPLATE);
async function availableModels(): Promise<readonly ModelSummary[]> {
	const [models, settings] = await Promise.all([api["models.list"]({}), api["settings.get"]({})]);
	const providers = new Set(settings.providers.filter((p) => p.configured).map((p) => p.providerId));
	return models.filter((m) => providers.has(m.provider));
}

function initialize(review: TemplateReview): {
	model: ModelChoice | undefined;
	skills: (SkillChoice["choice"] | undefined)[];
} {
	return {
		model:
			review.template.profile.model === null
				? { kind: "default" }
				: review.model.state === "available"
					? { kind: "template" }
					: undefined,
		skills: review.skills.map((s) => (s.state === "available" ? { kind: "template" } : undefined)),
	};
}
export function BotTemplateDialog() {
	const action = useTemplateState((s) => s.action);
	return action ? <TemplateDialog key={action.mode + action.botId} action={action} /> : null;
}
function TemplateDialog({ action }: { action: Action }) {
	const defaultModel = useStore((s) => s.settings?.defaultModel);
	const [review, setReview] = useState<TemplateReview>(),
		[filename, setFilename] = useState("");
	const [name, setName] = useState(""),
		[model, setModel] = useState<ModelChoice>(),
		[skills, setSkills] = useState<(SkillChoice["choice"] | undefined)[]>([]);
	const [models, setModels] = useState<readonly ModelSummary[]>([]),
		[versions, setVersions] = useState<SkillVersion[]>([]),
		[preview, setPreview] = useState<{ index: number; version: SkillVersion }>();
	const [busy, setBusy] = useState(true),
		[error, setError] = useState(""),
		[notice, setNotice] = useState("");
	const [uncertain, setUncertain] = useState(!!pending()),
		[submitted, setSubmitted] = useState<Parameters<(typeof api)["bots.templates.import"]>[0]>();
	const root = useRef<HTMLDivElement>(null),
		alive = useRef(true),
		generation = useRef(0),
		polling = useRef(false);
	const exporting = action.mode === "export";
	useEffect(() => {
		if (!busy && !root.current?.contains(document.activeElement)) root.current?.focus();
	}, [busy]);
	const close = () => useTemplateState.setState({ action: null });
	const apply = (loaded: Loaded) => {
		if (!loaded) {
			close();
			return;
		}
		if ("error" in loaded) {
			setError(loaded.error);
			return;
		}
		const initial = initialize(loaded.review);
		setReview(loaded.review);
		setFilename(loaded.filename ?? "");
		setName(loaded.review.template.profile.name);
		setModel(initial.model);
		setSkills(initial.skills);
		setVersions([]);
		setPreview(undefined);
	};
	useEffect(() => {
		alive.current = true;
		void action.load.then((loaded) => {
			if (alive.current) {
				apply(loaded);
				setBusy(false);
			}
		});
		void availableModels()
			.then(setModels)
			.catch(() => {});
		root.current?.focus();
		return () => {
			alive.current = false;
			generation.current++;
			if (action.restoreFocus?.isConnected) action.restoreFocus.focus();
		};
	}, [action]);
	const finish = async (result: ImportResult) => {
		localStorage.removeItem(PENDING_TEMPLATE);
		setUncertain(false);
		setSubmitted(undefined);
		await refreshBots();
		if (result.state === "deleted") {
			setNotice("This imported Bot was deleted. It will not be recreated.");
			return;
		}
		if (result.state === "hidden") {
			setNotice("This imported Bot is hidden. Show it from the sidebar to continue.");
			return;
		}
		await openBot(result.botId);
		useTemplateState.setState({ profileBotId: result.botId });
		close();
	};
	const checkResult = async () => {
		const id = pending();
		if (!id || polling.current) return;
		polling.current = true;
		setBusy(true);
		setNotice("Checking import result");
		const epoch = generation.current;
		try {
			for (let i = 0; i < 10; i++) {
				const result = await api["bots.templates.status"]({ requestId: id });
				if (!alive.current || epoch !== generation.current) return;
				if (result) {
					await finish(result);
					return;
				}
				if (i < 9) await new Promise((resolve) => setTimeout(resolve, 1000));
			}
			setNotice("Import result is unconfirmed. Check again or retry the same reviewed import.");
		} catch (error) {
			if (alive.current) setError(errorMessage(error));
		} finally {
			polling.current = false;
			if (alive.current) setBusy(false);
		}
	};
	const selectFile = async () => {
		setBusy(true);
		setError("");
		try {
			apply(await readSelection());
		} finally {
			if (alive.current) setBusy(false);
		}
	};
	const refresh = async () => {
		if (!action.botId) return;
		setBusy(true);
		setError("");
		try {
			const bot = (await api["bots.list"]({})).find((b) => b.botId === action.botId);
			if (bot)
				apply({ review: await api["bots.templates.export"]({ botId: bot.botId, expectedRevision: bot.revision }) });
		} catch (error) {
			setError(errorMessage(error));
		} finally {
			setBusy(false);
		}
	};
	const save = async () => {
		if (!review) return;
		setBusy(true);
		setError("");
		try {
			const result = await window.openbot.saveBotTemplate({
				requestId: crypto.randomUUID(),
				template: review.template,
				templateDigest: review.templateDigest,
			});
			if (result.outcome === "saved") setNotice("Template saved");
		} catch (error) {
			setError(errorMessage(error));
		} finally {
			setBusy(false);
		}
	};
	const importBot = async () => {
		if (!review || !model || skills.some((s) => !s)) return;
		const choices: ImportChoices = {
			name,
			model,
			skills: skills.map((choice, i) => ({ name: review.skills[i]!.ref.name, choice: choice! })),
		};
		const input = submitted ?? {
			requestId: pending() ?? crypto.randomUUID(),
			template: review.template,
			templateDigest: review.templateDigest,
			choices,
		};
		localStorage.setItem(PENDING_TEMPLATE, input.requestId);
		setSubmitted(input);
		setBusy(true);
		setError("");
		setNotice("");
		try {
			await finish(await api["bots.templates.import"](input));
		} catch (error) {
			const message = errorMessage(error);
			setError(message);
			if (
				/\[(invalid_request|request_conflict|not_found)\]/.test(error instanceof Error ? error.message : "") &&
				!uncertain
			) {
				localStorage.removeItem(PENDING_TEMPLATE);
				setSubmitted(undefined);
				const fresh = await api["bots.templates.inspect"]({ template: review.template }).catch(() => undefined);
				if (fresh) {
					setReview(fresh);
					const checked = await Promise.all(
						skills.map(async (choice, i) => {
							if (choice?.kind === "template") return fresh.skills[i]?.state === "available" ? choice : undefined;
							if (choice?.kind !== "local") return choice;
							const version = await api["skills.get"]({ name: choice.ref.name, revision: choice.ref.revision })
								.then((result) => result.current)
								.catch(() => undefined);
							return version?.available && !version.deleted && version.sha256 === choice.ref.sha256
								? choice
								: undefined;
						}),
					);
					setSkills(checked);
					const currentModels = await availableModels().catch(() => []);
					setModels(currentModels);
					if (
						(model.kind === "template" && fresh.model.state !== "available") ||
						(model.kind === "local" &&
							!currentModels.some((m) => m.provider === model.model.provider && m.modelId === model.model.modelId))
					)
						setModel(undefined);
				}
			} else {
				setUncertain(true);
				await checkResult();
			}
		} finally {
			if (alive.current) setBusy(false);
		}
	};
	const loadVersions = async (index: number) => {
		setBusy(true);
		setError("");
		try {
			const detail = await api["skills.get"]({ name: review!.skills[index]!.ref.name });
			const refs = [detail.current, ...detail.history].filter(
				(item, i, all) => item.available && !item.deleted && all.findIndex((v) => v.revision === item.revision) === i,
			);
			const found = await Promise.all(
				refs.map(async (ref) => (await api["skills.get"]({ name: ref.name, revision: ref.revision })).current),
			);
			setVersions(found);
			setPreview(found[0] ? { index, version: found[0] } : undefined);
		} catch (error) {
			setError(errorMessage(error));
		} finally {
			setBusy(false);
		}
	};
	const p = review?.template.profile,
		locked = busy || !!submitted;
	return (
		<div className="dialog-backdrop bot-template-backdrop">
			<div
				className="dialog bot-template-dialog"
				ref={root}
				tabIndex={-1}
				role="dialog"
				aria-modal="true"
				aria-label={t(exporting ? "Export template" : "Import template")}
				onKeyDown={(event) => {
					if (event.key === "Escape" && (!busy || uncertain)) {
						event.stopPropagation();
						close();
					}
					if (event.key === "Tab") {
						const focusable = [
							...event.currentTarget.querySelectorAll<HTMLElement>(
								'button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]',
							),
						];
						const first = focusable[0],
							last = focusable.at(-1);
						if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) {
							event.preventDefault();
							last?.focus();
						} else if (!event.shiftKey && document.activeElement === last) {
							event.preventDefault();
							first?.focus();
						}
					}
				}}
			>
				<h2>{t(exporting ? "Export template" : "Import template")}</h2>
				<p>
					{t(
						exporting
							? "Memory, chats and permissions are excluded. Review your instructions for information you entered manually."
							: "Creates a new Bot; existing Bots are unchanged.",
					)}
				</p>
				{filename && <p className="field-hint">{filename}</p>}
				{!exporting && uncertain && (
					<div role="status">
						<p>{t("An import is pending. Keep its request identity until the result is known.")}</p>
						<button disabled={busy} onClick={() => void checkResult()}>
							{t("Check again")}
						</button>
					</div>
				)}
				{!review && !busy && (
					<button onClick={() => void (exporting ? refresh() : selectFile())}>
						{t(exporting ? "Refresh preview" : "Choose template file")}
					</button>
				)}
				{p && (
					<>
						<Avatar
							bot={{ botId: "template-preview" }}
							value={p.avatar.kind === "png" ? { kind: "upload", base64: p.avatar.base64 } : p.avatar}
							size={64}
						/>
						<label className="field">
							<span>{t("Name")}</span>
							<input
								aria-label={t("Template Bot name")}
								value={name}
								readOnly={exporting}
								disabled={locked}
								onChange={(e) => setName(e.target.value)}
							/>
						</label>
						<p>
							{t("Role")}: {p.role}
						</p>
						<strong>{t("Instructions")}</strong>
						<pre className="template-instructions" tabIndex={0}>
							{p.instructions}
						</pre>
						<p>
							{t("Thinking")}:{" "}
							{t(({ off: "Off", low: "Low", medium: "Medium", high: "High" } as const)[p.thinkingLevel])}
						</p>
						<p>
							{t("Template model")}:{" "}
							{p.model ? `${p.model.provider} / ${p.model.modelId}` : t("Use application default")} ·{" "}
							{t(review.model.state === "available" ? "Available" : "Unavailable")}
						</p>
						{!exporting && (
							<label className="field">
								<span>{t("Model choice")}</span>
								<select
									aria-label={t("Model choice")}
									disabled={locked}
									value={model?.kind === "local" ? JSON.stringify(model.model) : (model?.kind ?? "")}
									onChange={(e) =>
										setModel(
											e.target.value === "template"
												? { kind: "template" }
												: e.target.value === "default"
													? { kind: "default" }
													: e.target.value
														? { kind: "local", model: JSON.parse(e.target.value) }
														: undefined,
										)
									}
								>
									<option value="">{t("Resolve the missing model")}</option>
									{p.model && review.model.state === "available" && (
										<option value="template">{t("Use template model")}</option>
									)}
									<option value="default">{t("Use application default")}</option>
									{models.map((m) => (
										<option
											key={`${m.provider}/${m.modelId}`}
											value={JSON.stringify({ provider: m.provider, modelId: m.modelId })}
										>
											{m.name} ({m.provider})
										</option>
									))}
								</select>
							</label>
						)}
						{!exporting &&
							model?.kind === "default" &&
							(!defaultModel ||
								!models.some((m) => m.provider === defaultModel.provider && m.modelId === defaultModel.modelId)) && (
								<p>{t("Set up a model before chatting")}</p>
							)}
						<strong>{t("Role skills")}</strong>
						{review.skills.length === 0 && (
							<p>{t("No role defaults. Attach a skill to individual messages when needed.")}</p>
						)}
						{review.skills.map((item, i) => (
							<section className="template-skill" key={item.ref.name}>
								<p>
									/{item.ref.name} · v{item.ref.revision} ·{" "}
									{t(item.state === "available" ? "Available" : "Unavailable")}
								</p>
								<code>{item.ref.sha256}</code>
								{!exporting && (
									<>
										<label className="field">
											<span>{t("Skill choice")}</span>
											<select
												aria-label={`${t("Skill choice")} ${item.ref.name}`}
												disabled={locked}
												value={skills[i]?.kind ?? ""}
												onChange={(e) => {
													const kind = e.target.value;
													if (kind === "local") {
														void loadVersions(i);
														return;
													}
													setSkills((old) =>
														old.map((s, j) =>
															j === i ? (kind ? { kind: kind as "template" | "omit" } : undefined) : s,
														),
													);
												}}
											>
												<option value="">{t("Resolve the missing skill")}</option>
												{item.state === "available" && (
													<option value="template">{t("Keep exact template version")}</option>
												)}
												<option value="omit">{t("Omit this skill")}</option>
												<option value="local">{t("Preview a local version")}</option>
											</select>
										</label>
										{skills[i]?.kind === "local" && (
											<p>
												{t("Selected version")}: v
												{(skills[i] as { kind: "local"; ref: import("@openbot/protocol").SkillRef }).ref.revision} ·{" "}
												{(skills[i] as { kind: "local"; ref: import("@openbot/protocol").SkillRef }).ref.sha256}
											</p>
										)}
									</>
								)}
							</section>
						))}
						{preview && (
							<section role="region" aria-label={t("Role skill preview")}>
								<select
									aria-label={t("Preview a skill version")}
									disabled={locked}
									value={preview.version.revision}
									onChange={(e) => {
										const version = versions.find((v) => v.revision === Number(e.target.value));
										if (version) setPreview({ ...preview, version });
									}}
								>
									{versions.map((v) => (
										<option key={v.revision} value={v.revision}>
											{v.name} · v{v.revision}
										</option>
									))}
								</select>
								<pre>{preview.version.markdown}</pre>
								<code>{preview.version.sha256}</code>
								<button
									disabled={locked}
									onClick={() => {
										const { name, revision, sha256 } = preview.version;
										setSkills((old) =>
											old.map((s, i) => (i === preview.index ? { kind: "local", ref: { name, revision, sha256 } } : s)),
										);
										setPreview(undefined);
									}}
								>
									{t("Use this revision")}
								</button>
							</section>
						)}
					</>
				)}
				{error && <p role="alert">{t(error)}</p>}
				{notice && <p role="status">{t(notice)}</p>}
				{busy && <p role="status">{t("Working…")}</p>}
				<div className="dialog-actions">
					<button disabled={busy && !uncertain} onClick={close}>
						{t("Cancel")}
					</button>
					{exporting ? (
						<>
							<button disabled={busy} onClick={() => void refresh()}>
								{t("Refresh preview")}
							</button>
							<button disabled={busy || !review} onClick={() => void save()}>
								{t("Save template")}
							</button>
						</>
					) : (
						<button
							disabled={busy || !review || !name.trim() || !model || skills.some((s) => !s)}
							onClick={() => void importBot()}
						>
							{t(submitted ? "Retry this request" : "Import Bot")}
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
