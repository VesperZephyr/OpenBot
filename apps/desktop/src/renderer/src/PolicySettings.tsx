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
	const update = (change: { commandSetting?: CommandSetting; readOnlyDefault?: boolean }): void =>
		void api["policy.update"](change).then(setPolicy).catch(report);

	return (
		<div className="settings-group" aria-label="Commands">
			<h2>Commands</h2>
			<p className="muted">How Bots may run shell commands on this Mac.</p>
			<select
				value={policy.commandSetting}
				onChange={(event) => update({ commandSetting: event.target.value as CommandSetting })}
				aria-label="Command setting"
			>
				{(Object.keys(SETTING_LABELS) as CommandSetting[]).map((setting) => (
					<option key={setting} value={setting}>
						{SETTING_LABELS[setting]}
					</option>
				))}
			</select>
			<label className="toggle">
				<input
					type="checkbox"
					checked={policy.readOnlyDefault}
					onChange={(event) => update({ readOnlyDefault: event.target.checked })}
				/>
				<span>
					Run read-only commands inside granted folders without asking (<code>rg</code>, <code>grep</code>, <code>ls</code>,{" "}
					<code>cat</code>, <code>git status</code>, …)
				</span>
			</label>
			<ul className="provider-list" aria-label="Command rules">
				{policy.rules.length === 0 && <li className="muted">No rules yet. Choose Always allow on a command to add one.</li>}
				{policy.rules.map((rule) => (
					<li key={rule.id}>
						<code>{ruleText(rule)}</code>
						<button
							type="button"
							aria-label={`Delete rule ${ruleText(rule)}`}
							onClick={() => void api["policy.rules.delete"]({ id: rule.id }).then(setPolicy).catch(report)}
						>
							Delete
						</button>
					</li>
				))}
			</ul>
		</div>
	);
}

/** Settings → Folders: granted folders with revoke, and Add folder through the native picker. */
export function FolderSettings({ workspace }: { readonly workspace: string }) {
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
		<div className="settings-group" aria-label="Folders">
			<h2>Folders</h2>
			<p className="muted">Bots read and write these folders with file tools without asking.</p>
			<ul className="provider-list" aria-label="Granted folders">
				<li>
					<code>{workspace}</code>
					<span className="muted">Workspace · read and write</span>
				</li>
				{grants?.map((grant) => (
					<li key={grant.id}>
						<code>{grant.path}</code>
						<span className="muted">{grant.access === "read" ? "Read" : "Read and write"}</span>
						<button
							type="button"
							aria-label={`Revoke ${grant.path}`}
							onClick={() => void api["grants.revoke"]({ id: grant.id }).then(setGrants).catch(report)}
						>
							Revoke
						</button>
					</li>
				))}
			</ul>
			<button type="button" onClick={() => void add()}>
				Add folder
			</button>
		</div>
	);
}
