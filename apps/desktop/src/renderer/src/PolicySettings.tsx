import { AskFirstSettings, PermissionStatus } from "./AskFirstSettings";
import { t } from "./i18n";
import type { CommandRule, CommandSetting, FolderGrant, PolicySettings as Policy } from "@openbot/protocol";
import { useEffect, useState } from "react";
import { api, report } from "./store";

const SETTING_LABELS: Record<CommandSetting, string> = {
	ask: "Ask every time",
	allow: "Always allow",
	never: "Never",
};

/** Mirrors the Host's `ruleLabel`: the renderer cannot import server code. */
function ruleText(rule: CommandRule): string {
	if (rule.exact !== undefined) return rule.exact;
	return rule.subcommand === undefined ? `${rule.program} *` : `${rule.program} ${rule.subcommand} *`;
}

/** Settings → Commands: the command setting, the read-only default, and saved rules. */
export function CommandSettings() {
	const [policy, setPolicy] = useState<Policy | undefined>(undefined);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		let current = true;
		api["policy.get"]({})
			.then((loaded) => current && setPolicy(loaded))
			.catch(report);
		return () => {
			current = false;
		};
	}, []);
	if (policy === undefined) return null;
	const change = (action: () => Promise<Policy>): void => {
		setBusy(true);
		void action()
			.then(setPolicy)
			.catch((error) => {
				report(error);
				void api["policy.get"]({}).then(setPolicy).catch(report);
			})
			.finally(() => setBusy(false));
	};
	const update = (value: { commandSetting?: CommandSetting; readOnlyDefault?: boolean }) => change(() => api["policy.update"](value));

	return (
		<div className="settings-group" aria-label={t("Commands")}>
			<h2>{t("Commands")}</h2>
			<p className="muted">{t("How Bots may run shell commands on this Mac.")}</p>
			<select
				disabled={busy}
				value={policy.commandSetting}
				onChange={(event) => update({ commandSetting: event.target.value as CommandSetting })}
				aria-label={t("Command setting")}
			>
				{(Object.keys(SETTING_LABELS) as CommandSetting[]).map((setting) => (
					<option key={setting} value={setting}>
						{t(SETTING_LABELS[setting])}
					</option>
				))}
			</select>
			<label className="toggle">
				<input
					type="checkbox"
					disabled={busy}
					checked={policy.readOnlyDefault}
					onChange={(event) => update({ readOnlyDefault: event.target.checked })}
				/>
				<span>
					{t("Run read-only commands inside granted folders without asking (")}
					<code>rg</code>, <code>grep</code>, <code>ls</code>, <code>cat</code>, …)
				</span>
			</label>
			<ul className="provider-list" aria-label={t("Command rules")}>
				{policy.rules.length === 0 && <li className="muted">{t("No rules yet. Choose Always allow on a command to add one.")}</li>}
				{policy.rules.map((rule) => (
					<li key={rule.id}>
						<code>{ruleText(rule)}</code>
						<button
							type="button"
							aria-label={t("Delete rule {rule}", { rule: ruleText(rule) })}
							disabled={busy}
							onClick={() => change(() => api["policy.rules.delete"]({ id: rule.id }))}
						>
							{t("Delete")}
						</button>
					</li>
				))}
			</ul>
			<PermissionStatus policy={policy} busy={busy} reload={setPolicy} />
			<AskFirstSettings policy={policy} update={change} busy={busy} />
		</div>
	);
}

/** Settings → Folders: granted folders with revoke, and Add folder through the native picker. */
export function FolderSettings({ workspace }: { readonly workspace: string }) {
	const [policy, setPolicy] = useState<Policy>();
	const [busy, setBusy] = useState(false);
	const [grants, setGrants] = useState<readonly FolderGrant[] | undefined>(undefined);
	useEffect(() => {
		let current = true;
		api["grants.list"]({})
			.then((loaded) => current && setGrants(loaded))
			.catch(report);
		return () => {
			current = false;
		};
	}, []);

	const revoke = (id: string) => {
		setBusy(true);
		void api["grants.revoke"]({ id })
			.then(setGrants)
			.catch(report)
			.finally(async () => {
				await Promise.all([api["policy.get"]({}).then(setPolicy), api["grants.list"]({}).then(setGrants)]).catch(report);
				setBusy(false);
			});
	};
	const add = async (): Promise<void> => {
		try {
			const picked = await window.openbot.pickFolder();
			if (picked === null) return;
			setGrants(await api["grants.add"]({ selection: picked.selection, access: "readwrite" }));
		} catch (error) {
			report(error);
		}
	};

	return (
		<div className="settings-group" aria-label={t("Folders")}>
			<h2>{t("Folders")}</h2>
			<p className="muted">{t("Bots read and write these folders with file tools without asking.")}</p>
			<ul className="provider-list" aria-label={t("Granted folders")}>
				<li>
					<code>{workspace}</code>
					<span className="muted">{t("Workspace · read and write")}</span>
				</li>
				{grants?.map((grant) => (
					<li key={grant.id}>
						<code>{grant.path}</code>
						<span className="muted">{t(grant.access === "read" ? "Read" : "Read and write")}</span>
						<button type="button" aria-label={t("Revoke {path}", { path: grant.path })} disabled={busy} onClick={() => revoke(grant.id)}>
							{t("Revoke")}
						</button>
					</li>
				))}
			</ul>
			<PermissionStatus policy={policy} busy={busy} reload={setPolicy} />
			<button type="button" disabled={busy} onClick={() => void add()}>
				{t("Add folder")}
			</button>
		</div>
	);
}
