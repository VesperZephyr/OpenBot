import { useEffect, useRef, useState } from "react";
import { isConnectorEnvironment, isConnectorId, type ConnectorProfile } from "@openbot/protocol";
import { api, refreshConnectors, useStore } from "./store";
import { t } from "./i18n";
import "./connectors.css";
const statusLabel = { connected: "Connected", disconnected: "Disconnected", needs_attention: "Needs attention" };
const blank = { connectorId: "", name: "", command: "", args: [] as string[], credentialEnv: "" };
export function ConnectorsPanel() {
	const profiles = useStore((s) => s.connectors);
	const [selected, setSelected] = useState<string>(),
		[draft, setDraft] = useState<typeof blank>(),
		[token, setToken] = useState("");
	const [busy, setBusy] = useState(false),
		[error, setError] = useState(false),
		[confirmRemove, setConfirmRemove] = useState(false);
	const request = useRef<{ fingerprint: string; id: string } | undefined>(undefined);
	useEffect(() => {
		void refreshConnectors().catch(() => setError(true));
	}, []);
	const detail = profiles?.find((item) => item.connectorId === selected);
	const choose = (id?: string) => {
		setSelected(id);
		setDraft(undefined);
		setToken("");
		setError(false);
		setConfirmRemove(false);
		request.current = undefined;
	};
	const stableId = (intent: unknown) => {
		const fingerprint = JSON.stringify(intent);
		if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
		return request.current.id;
	};
	const work = async (action: () => Promise<unknown>, done?: () => void) => {
		if (busy) return;
		setBusy(true);
		setError(false);
		try {
			await action();
			await refreshConnectors();
			request.current = undefined;
			done?.();
		} catch {
			setError(true);
		} finally {
			setBusy(false);
		}
	};
	const change = (action: "connect" | "disconnect" | "remove", item: ConnectorProfile) =>
		void work(
			() =>
				api[`connectors.${action}`]({
					connectorId: item.connectorId,
					expectedRevision: item.revision,
					requestId: stableId({ action, id: item.connectorId, revision: item.revision }),
				}),
			() => {
				setConfirmRemove(false);
				if (action === "remove") choose();
			},
		);
	const valid =
		draft &&
		isConnectorId(draft.connectorId) &&
		draft.name.trim() &&
		draft.command.startsWith("/") &&
		(!draft.credentialEnv || isConnectorEnvironment(draft.credentialEnv));
	return (
		<section className="connectors-panel" aria-label={t("Connect apps")}>
			<header className="connector-heading">
				<div>
					<h1>{t("Connect apps")}</h1>
					<p>{t("Give your Bots tools from a local MCP program.")}</p>
				</div>
				<button
					disabled={busy}
					onClick={() => {
						choose();
						setDraft({ ...blank, args: [] });
					}}
				>
					{t("Add connector")}
				</button>
			</header>
			<div className="connector-layout">
				<nav className="connector-index" aria-label={t("Installed connectors")}>
					<button disabled={busy} onClick={() => void refreshConnectors().catch(() => setError(true))}>
						{t("Refresh")}
					</button>
					{profiles === undefined ? (
						<p role="status">{t("Loading…")}</p>
					) : profiles.length === 0 ? (
						<p>{t("No connected apps yet. Add a local program you trust.")}</p>
					) : (
						profiles.map((item) => (
							<button
								disabled={busy}
								key={item.connectorId}
								aria-current={selected === item.connectorId ? "true" : undefined}
								onClick={() => choose(item.connectorId)}
							>
								<strong>{item.name}</strong>
								<small>{t(statusLabel[item.state])}</small>
							</button>
						))
					)}
				</nav>
				<div className="connector-workspace">
					{error && <p role="alert">{t("Could not confirm this change. Refresh and review the connector before trying again.")}</p>}
					{draft ? (
						<form
							onSubmit={(event) => {
								event.preventDefault();
								if (!valid) return;
								const input = {
									connectorId: draft.connectorId,
									name: draft.name,
									command: draft.command,
									args: draft.args,
									...(draft.credentialEnv ? { credentialEnv: draft.credentialEnv } : {}),
								};
								void work(
									() => api["connectors.install"]({ ...input, requestId: stableId(input) }),
									() => choose(input.connectorId),
								);
							}}
						>
							<h2>{t("Add connector")}</h2>
							{(
								[
									["name", "Connector name"],
									["connectorId", "Connector ID"],
									["command", "Executable path"],
									["credentialEnv", "Token environment variable (optional)"],
								] as const
							).map(([key, label]) => (
								<label className="connector-field" key={key}>
									<span>{t(label)}</span>
									<input
										aria-label={t(label)}
										disabled={busy}
										required={key !== "credentialEnv"}
										maxLength={key === "command" ? 4096 : key === "name" ? 80 : 64}
										value={draft[key]}
										onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
									/>
								</label>
							))}
							<fieldset disabled={busy}>
								<legend>{t("Arguments")}</legend>
								{draft.args.map((arg, index) => (
									<div className="connector-argument" key={index}>
										<input
											aria-label={t("Argument {index}", { index: index + 1 })}
											maxLength={2048}
											value={arg}
											onChange={(e) => setDraft({ ...draft, args: draft.args.map((value, i) => (i === index ? e.target.value : value)) })}
										/>
										<button
											type="button"
											aria-label={t("Remove argument {index}", { index: index + 1 })}
											onClick={() => setDraft({ ...draft, args: draft.args.filter((_, i) => i !== index) })}
										>
											×
										</button>
									</div>
								))}
								<button type="button" disabled={draft.args.length >= 32} onClick={() => setDraft({ ...draft, args: [...draft.args, ""] })}>
									{t("Add argument")}
								</button>
							</fieldset>
							<p className="muted">
								{t(
									"Each argument is passed literally. Keep tokens out of arguments; save them in the credential field after installation.",
								)}
							</p>
							<p className="muted">
								{t(
									"This program runs on your Mac with your user access. Install only programs you trust. Every Bot tool call still needs approval.",
								)}
							</p>
							<div className="connector-actions">
								<button type="button" disabled={busy} onClick={() => choose()}>
									{t("Cancel")}
								</button>
								<button className="primary" disabled={busy || !valid}>
									{t("Install and connect")}
								</button>
							</div>
						</form>
					) : detail ? (
						<article>
							<header className="connector-title">
								<h2>{detail.name}</h2>
								<span role="status">{t(statusLabel[detail.state])}</span>
							</header>
							{detail.error && <p role="alert">{t(detail.error)}</p>}
							<dl className="connector-definition">
								<dt>{t("Executable path")}</dt>
								<dd>{detail.command}</dd>
								<dt>{t("Arguments")}</dt>
								<dd>{detail.args.length ? detail.args.map((arg, i) => <code key={i}>{arg || '""'}</code>) : t("None")}</dd>
								<dt>{t("Connector ID")}</dt>
								<dd>
									{detail.connectorId} · v{detail.revision}
								</dd>
							</dl>
							<div className="connector-actions">
								<button disabled={busy || detail.removed} onClick={() => change("connect", detail)}>
									{t(detail.state === "connected" ? "Reconnect" : "Connect")}
								</button>
								<button disabled={busy || detail.state === "disconnected"} onClick={() => change("disconnect", detail)}>
									{t("Disconnect")}
								</button>
								<button disabled={busy} onClick={() => setConfirmRemove(true)}>
									{t("Remove connector")}
								</button>
							</div>
							{confirmRemove && (
								<div className="connector-removal">
									<p>{t("Remove this connector and its saved credential? Previous tool results stay in chat history.")}</p>
									<button disabled={busy} onClick={() => setConfirmRemove(false)}>
										{t("Cancel")}
									</button>
									<button disabled={busy} onClick={() => change("remove", detail)}>
										{t("Confirm removal")}
									</button>
								</div>
							)}
							{detail.credentialEnv && !detail.removed && (
								<form
									className="connector-credential"
									onSubmit={(e) => {
										e.preventDefault();
										void work(
											() =>
												api["connectors.credential.set"]({
													connectorId: detail.connectorId,
													expectedRevision: detail.revision,
													value: token,
												}),
											() => setToken(""),
										);
									}}
								>
									<h3>{t("Connector credential")}</h3>
									<p>
										{detail.credentialEnv} · {t(detail.credentialConfigured ? "Credential saved" : "No credential saved")}
									</p>
									<label className="connector-field">
										<span>{t("Token")}</span>
										<input
											type="password"
											autoComplete="off"
											aria-label={t("Token")}
											disabled={busy}
											value={token}
											minLength={8}
											maxLength={8192}
											required
											onChange={(e) => setToken(e.target.value)}
										/>
									</label>
									<p className="muted">
										{t("Stored in the local Keychain and sent only to this program. Saving disconnects it; connect again when ready.")}
									</p>
									<div className="connector-actions">
										<button disabled={busy || token.length < 8}>{t("Save credential")}</button>
										<button
											type="button"
											disabled={busy || !detail.credentialConfigured}
											onClick={() =>
												void work(
													() => api["connectors.credential.delete"]({ connectorId: detail.connectorId, expectedRevision: detail.revision }),
													() => setToken(""),
												)
											}
										>
											{t("Delete credential")}
										</button>
									</div>
								</form>
							)}
							<section className="connector-tools" aria-label={t("Reviewed tools")}>
								<h3>
									{t("Reviewed tools")} <small>{detail.tools.length}</small>
								</h3>
								<p className="muted">{t("Bots discover these tools when needed. Discovery does not approve execution.")}</p>
								{detail.tools.map((tool) => (
									<details key={tool.name}>
										<summary>{tool.name}</summary>
										<p>{tool.description}</p>
										<pre>{JSON.stringify(tool.inputSchema, null, 2)}</pre>
									</details>
								))}
							</section>
						</article>
					) : (
						<div className="connector-empty">
							<h2>{t("Your tools, on your Mac.")}</h2>
							<p>{t("Select a connector to inspect its program, credentials and reviewed tools.")}</p>
							<p>{t("After restarting OpenBot, connect explicitly before using a connector.")}</p>
						</div>
					)}
				</div>
			</div>
		</section>
	);
}
