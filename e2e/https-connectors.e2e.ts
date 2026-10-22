/** B9b: real TLS transport with synthetic remote effects on an isolated hidden desktop. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { launchApp, type AppHarness } from "./harness.ts";
import { httpsFixture } from "../packages/local-executor/test/fixtures/mcp-https.ts";
let h: AppHarness, fixture: Awaited<ReturnType<typeof httpsFixture>>, core: string;
const api = (name: string, params = {}): Promise<any> =>
	h.page().evaluate(({ name, params }) => (window as any).openbot.methods[name](params), { name, params });
const poll = (read: () => Promise<any>) => expect.poll(read, { timeout: 15000 });
const profile = async () => (await api("connectors.list"))[0];
const snapshot = () => api("conversations.snapshot", { botId: core });
const change = async (action: string) => {
	const p = await profile();
	return api(`connectors.${action}`, { connectorId: p.connectorId, expectedRevision: p.revision, requestId: crypto.randomUUID() });
};
const panel = async () => {
	await h.page().getByRole("button", { name: /^Settings/ }).click();
	await h.page().getByRole("button", { name: "Connect apps", exact: true }).click();
	await h
		.page()
		.getByRole("button", { name: /HTTPS notes/ })
		.click();
};
beforeAll(async () => {
	h = await launchApp("https-connectors", {
		prepare: async (root) => {
			fixture = await httpsFixture(root);
			return { NODE_EXTRA_CA_CERTS: fixture.certPath };
		},
	});
	h.page().setDefaultTimeout(10000);
	await api("settings.update", { defaultModel: { provider: "scripted", modelId: "scripted" } });
	core = (await api("bots.list")).find((b: any) => b.kind === "core").botId;
});
afterEach(async ({ task }) => {
	if (task.result?.state === "fail") await h.shot("failure");
});
afterAll(async () => {
	if (h) {
		for (const p of await api("connectors.list").catch(() => []))
			await api("connectors.remove", { connectorId: p.connectorId, expectedRevision: p.revision, requestId: crypto.randomUUID() }).catch(
				() => {},
			);
		await h.close();
	}
	await fixture?.close();
});
it("installs HTTPS through the form, rejects an expired token and replaces it privately", async () => {
	await h.page().getByRole("button", { name: /^Settings/ }).click();
	await h.page().getByRole("button", { name: "Connect apps", exact: true }).click();
	await h.page().getByRole("button", { name: "Add connector", exact: true }).click();
	await h.page().getByLabel("Connection type", { exact: true }).selectOption("https");
	await h.page().getByLabel("Connector name", { exact: true }).fill("HTTPS notes");
	await h.page().getByLabel("Connector ID", { exact: true }).fill("https-notes");
	await h.page().getByLabel("HTTPS endpoint", { exact: true }).fill(fixture.endpoint.replace("https:", "http:"));
	expect(await h.page().getByRole("button", { name: "Install and connect", exact: true }).isDisabled()).toBe(true);
	await h.page().getByLabel("HTTPS endpoint", { exact: true }).fill(fixture.endpoint);
	await h.shot("01-https-install-en");
	await h.page().getByRole("button", { name: "Install and connect", exact: true }).click();
	await h.page().getByLabel("Token", { exact: true }).waitFor();
	expect(await profile()).toMatchObject({ transport: "https", auth: "bearer", state: "needs_attention", credentialConfigured: false });
	await h.page().getByLabel("Token", { exact: true }).fill("EXPIRED_SYNTHETIC_TOKEN");
	await h.page().getByRole("button", { name: "Save credential", exact: true }).click();
	await poll(async () => await h.page().getByLabel("Token", { exact: true }).inputValue()).toBe("");
	await h.page().getByRole("button", { name: "Connect", exact: true }).click();
	await h
		.page()
		.getByText("HTTPS connector authentication failed. Check or replace the credential, then connect again.", { exact: true })
		.waitFor();
	await h.shot("02-auth-failed-en");
	await h.page().getByLabel("Token", { exact: true }).fill(fixture.state.token);
	await h.page().getByRole("button", { name: "Save credential", exact: true }).click();
	await poll(async () => await h.page().getByLabel("Token", { exact: true }).inputValue()).toBe("");
	await h.page().getByRole("button", { name: "Connect", exact: true }).click();
	await poll(async () => (await profile())?.state).toBe("connected");
	expect(JSON.stringify(await profile())).not.toContain(fixture.state.token);
	expect(JSON.stringify(await profile())).not.toContain("fixture-private-session");
	await h.shot("03-https-connected-en");
});
it("discovers HTTPS tools and requires exact denial/approval before each write", async () => {
	await h.page().locator(".bot-row").first().click();
	h.model.script(
		{ tool: "tool_search", args: { query: "write_note", limit: 1 } },
		{ tool: "mcp__https-notes__write_note", args: { text: "denied" } },
		{ text: "HTTPS write denied." },
	);
	await h.send("Find write_note and propose a synthetic update.");
	await poll(async () => (await snapshot()).approvals[0]?.tool).toBe("mcp__https-notes__write_note");
	await h.page().locator(".approval").getByRole("button", { name: "Deny", exact: true }).click();
	await h.page().getByText("HTTPS write denied.", { exact: true }).waitFor();
	expect(fixture.state.writes).toEqual([]);
	fixture.state.mode = "sse";
	h.model.script(
		{ tool: "mcp__https-notes__write_note", args: { text: "approved HTTPS update" } },
		{ tool: "tool_search", args: { query: "echo_token", limit: 1 } },
		{ tool: "mcp__https-notes__echo_token", args: { text: "check" } },
		{ text: "HTTPS write confirmed." },
	);
	await h.send("Save approved HTTPS update and check the credential privately.");
	for (const name of ["write_note", "echo_token"]) {
		await poll(async () => (await snapshot()).approvals[0]?.tool).toBe(`mcp__https-notes__${name}`);
		await h.page().locator(".approval").getByRole("button", { name: "Allow once", exact: true }).click();
	}
	await h.page().getByText("HTTPS write confirmed.", { exact: true }).waitFor();
	expect(fixture.state.writes).toEqual(["approved HTTPS update"]);
	expect(JSON.stringify(h.model.requests)).not.toContain(fixture.state.token);
	expect(JSON.stringify(await snapshot())).not.toContain(fixture.state.token);
	fixture.state.mode = "normal";
});
it("shows expired sessions and rate limits in Chinese, then reconnects explicitly", async () => {
	await panel();
	fixture.state.mode = "expired";
	await change("connect");
	await h
		.page()
		.getByText("HTTPS connector session expired or endpoint was not found. Connect again to start a new session.", { exact: true })
		.waitFor();
	await api("settings.update", { language: "zh-CN" });
	await h.page().getByText("HTTPS 会话已过期或端点不存在，请重新连接以建立新会话。", { exact: true }).waitFor();
	await h.shot("04-expired-session-zh");
	fixture.state.mode = "rate";
	fixture.state.retry = "8";
	await change("connect");
	await h.page().getByText("HTTPS 连接器已被限流，请等到可重试时间后重新连接。", { exact: true }).waitFor();
	expect(await h.page().getByRole("button", { name: "连接", exact: true }).isDisabled()).toBe(true);
	await h.shot("05-rate-limit-zh");
	const retryAt = (await profile()).retryAt;
	const count = fixture.state.sessions;
	fixture.state.mode = "normal";
	await h.relaunch();
	expect(await profile()).toMatchObject({ state: "disconnected", retryAt });
	await h.page().getByRole("button", { name: /^设置/ }).click();
	await h.page().getByRole("button", { name: "连接应用", exact: true }).click();
	await h.page().getByRole("button", { name: /HTTPS notes/ }).click();
	expect(await h.page().getByRole("button", { name: "连接", exact: true }).isDisabled()).toBe(true);
	await poll(async () => await h.page().getByRole("button", { name: "连接", exact: true }).isEnabled()).toBe(true);
	expect(fixture.state.sessions).toBe(count);
	await h.page().getByRole("button", { name: "连接", exact: true }).click();
	await poll(async () => (await profile()).state).toBe("connected");
	await api("settings.update", { language: "en" });
});
it("preserves one unknown write on response loss across restart without retry", async () => {
	await h.page().locator(".bot-row").first().click();
	h.model.script(
		{ tool: "tool_search", args: { query: "lose_response", limit: 1 } },
		{ tool: "mcp__https-notes__lose_response", args: { text: "one uncertain update" } },
		{ text: "The HTTPS update needs inspection." },
	);
	await h.send("Test one synthetic update with response loss.");
	await poll(async () => (await snapshot()).approvals[0]?.tool).toBe("mcp__https-notes__lose_response");
	await h.page().locator(".approval").getByRole("button", { name: "Allow once", exact: true }).click();
	await poll(async () => (await snapshot()).items.find((i: any) => i.tool === "mcp__https-notes__lose_response")?.status).toBe(
		"interrupted",
	);
	expect(fixture.state.writes).toEqual(["approved HTTPS update", "one uncertain update"]);
	await h.shot("06-unknown-write-en");
	await h.relaunch();
	expect((await profile()).state).toBe("disconnected");
	expect((await snapshot()).items.find((i: any) => i.tool === "mcp__https-notes__lose_response")?.status).toBe("interrupted");
	expect(fixture.state.writes).toEqual(["approved HTTPS update", "one uncertain update"]);
	await panel();
	await change("connect");
	await poll(async () => (await profile()).state).toBe("connected");
});
it("disconnects and removes the endpoint and its credential without remote rollback claims", async () => {
	const count = fixture.state.deleted;
	await h.page().getByRole("button", { name: "Disconnect", exact: true }).click();
	await poll(async () => (await profile()).state).toBe("disconnected");
	// The Host invalidates local state before the executor finishes remote session cleanup.
	await expect.poll(() => fixture.state.deleted, { timeout: 15000 }).toBeGreaterThan(count);
	await h.page().getByRole("button", { name: "Remove connector", exact: true }).click();
	await h.page().getByRole("button", { name: "Confirm removal", exact: true }).click();
	await poll(() => api("connectors.list")).toEqual([]);
	const log = await readFile(join(h.dataDirectory, "logs", "host.log"), "utf8");
	expect(log).not.toContain(fixture.state.token);
	expect(log).not.toContain("fixture-private-session");
	expect(fixture.state.writes).toEqual(["approved HTTPS update", "one uncertain update"]);
	await h.shot("07-removed-en");
});
