import { useState } from "react";
import type { AskFirstPredicate, PolicySettings } from "@openbot/protocol";
import { api, report, useStore } from "./store";
import { t } from "./i18n";

type Tool = AskFirstPredicate["tool"];
export function PermissionStatus({
	policy,
	busy,
	reload,
}: {
	policy: PolicySettings | undefined;
	busy: boolean;
	reload: (policy: PolicySettings) => void;
}) {
	const state = policy?.reconciliation?.state;
	return (
		<div role="status" className="muted">
			{t(
				busy
					? "Reconciling permissions…"
					: state === "attention"
						? "Permission changes need attention"
						: state === "pending"
							? "Permission reconciliation pending"
							: state === "complete"
								? "Permission changes applied"
								: "",
			)}
			{!busy && state && state !== "complete" && (
				<button type="button" onClick={() => void api["policy.reconcile"]({}).then(reload).catch(report)}>
					{t("Retry reconciliation")}
				</button>
			)}
		</div>
	);
}
export function AskFirstSettings({
	policy,
	update,
	busy,
}: {
	policy: PolicySettings;
	update: (action: () => Promise<PolicySettings>) => void;
	busy: boolean;
}) {
	const bots = useStore((s) => s.bots),
		[tool, setTool] = useState<Tool>("local_exec"),
		[botId, setBot] = useState(""),
		[program, setProgram] = useState(""),
		[subcommand, setSubcommand] = useState(""),
		[exact, setExact] = useState(""),
		[path, setPath] = useState("");
	const save = () =>
		update(async () => {
			const predicate: AskFirstPredicate =
				tool === "local_exec"
					? {
							tool,
							program: program.trim(),
							...(subcommand.trim() ? { subcommand: subcommand.trim() } : {}),
							...(exact.trim() ? { exact: exact.trim() } : {}),
							...(path.trim() ? { cwd: path.trim() } : {}),
						}
					: { tool, path: path.trim() };
			const saved = await api["policy.ask.create"]({
				requestId: crypto.randomUUID(),
				expectedRevision: policy.revision,
				...(botId ? { botId } : {}),
				predicate,
			});
			setProgram("");
			setSubcommand("");
			setExact("");
			setPath("");
			return saved;
		});
	return (
		<section aria-label={t("Ask first rules")} className="ask-first-settings">
			<h3>{t("Ask first")}</h3>
			<p className="muted">{t("Ask first wins over saved allows. Command rules do not sandbox programs.")}</p>
			<ul className="provider-list">
				{policy.askFirst.map((rule) => {
					const p = rule.predicate;
					return (
						<li key={rule.id}>
							<div>
								<strong>{rule.botId ? (bots.find((bot) => bot.botId === rule.botId)?.name ?? t("Unavailable Bot")) : t("All Bots")}</strong>
								<code>
									{p.tool}:{" "}
									{p.tool === "local_exec"
										? [p.exact ?? [p.program, p.subcommand].filter(Boolean).join(" "), p.cwd].filter(Boolean).join(" · ")
										: p.path}
								</code>
							</div>
							<button
								type="button"
								disabled={busy}
								aria-label={t("Delete Ask first rule {tool}", { tool: p.tool })}
								onClick={() =>
									update(() => api["policy.ask.delete"]({ requestId: crypto.randomUUID(), expectedRevision: policy.revision, id: rule.id }))
								}
							>
								{t("Delete")}
							</button>
						</li>
					);
				})}
			</ul>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					save();
				}}
			>
				<label>
					{t("Bot")}
					<select aria-label={t("Rule Bot")} value={botId} onChange={(event) => setBot(event.target.value)}>
						<option value="">{t("All Bots")}</option>
						{bots.map((bot) => (
							<option key={bot.botId} value={bot.botId}>
								{bot.name}
							</option>
						))}
					</select>
				</label>
				<label>
					{t("Tool")}
					<select
						aria-label={t("Rule tool")}
						value={tool}
						onChange={(event) => {
							setTool(event.target.value as Tool);
							setPath("");
						}}
					>
						{["local_exec", "local_read", "local_list", "local_write", "local_edit", "artifact_publish"].map((name) => (
							<option key={name}>{name}</option>
						))}
					</select>
				</label>
				{tool === "local_exec" && (
					<>
						<label>
							{t("Program")}
							<input
								aria-label={t("Rule program")}
								required
								maxLength={4096}
								value={program}
								onChange={(event) => setProgram(event.target.value)}
							/>
						</label>
						<label>
							{t("Subcommand (optional)")}
							<input
								aria-label={t("Rule subcommand")}
								maxLength={256}
								value={subcommand}
								onChange={(event) => setSubcommand(event.target.value)}
								disabled={!!exact}
							/>
						</label>
						<label>
							{t("Exact command (optional)")}
							<input
								aria-label={t("Rule exact command")}
								maxLength={16384}
								value={exact}
								onChange={(event) => setExact(event.target.value)}
								disabled={!!subcommand}
							/>
						</label>
					</>
				)}
				<label>
					{t(tool === "local_exec" ? "Working directory (optional)" : "Path subtree")}
					<input
						aria-label={t("Rule path")}
						required={tool !== "local_exec"}
						maxLength={4096}
						value={path}
						onChange={(event) => setPath(event.target.value)}
					/>
				</label>
				<button type="submit" disabled={busy}>
					{t("Add Ask first rule")}
				</button>
			</form>
		</section>
	);
}
