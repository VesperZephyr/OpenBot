/** B9a: supervised connector discovery, exact approval and local credentials on a hidden desktop. */
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { launchApp, type AppHarness } from "./harness.ts";
let h: AppHarness, core: string;
const sentinel = "B9A_SYNTHETIC_SENTINEL_839221";
const api = (name: string, params = {}): Promise<any> =>
	h.page().evaluate(({ name, params }) => (window as any).openbot.methods[name](params), { name, params });
const poll = (read: () => Promise<any>) => expect.poll(read, { timeout: 15000 });
const list = () => api("connectors.list");
const snapshot = () => api("conversations.snapshot", { botId: core });
const coreChat = async () => {
	await h.page().locator(".bot-row").first().click();
};
beforeAll(async () => {
	h = await launchApp("connectors");
	h.page().setDefaultTimeout(10000);
	await api("settings.update", { defaultModel: { provider: "scripted", modelId: "scripted" } });
	core = (await api("bots.list")).find((b: any) => b.kind === "core").botId;
});
afterEach(async ({ task }) => {
	if (task.result?.state === "fail") await h.shot("failure");
});
afterAll(async () => {
	if (h) {
		for (const item of await list().catch(() => []))
			await api("connectors.remove", {
				connectorId: item.connectorId,
				expectedRevision: item.revision,
				requestId: crypto.randomUUID(),
			}).catch(() => {});
		await h.close();
	}
});
it("installs a reviewed local program and saves a credential separately without revealing it", async () => {
	expect(await list()).toEqual([]);
	await h.page().getByRole("button", { name: /^Settings/ }).click();
	await h.page().getByRole("button", { name: "Connect apps", exact: true }).click();
	await h.page().getByRole("button", { name: "Add connector", exact: true }).click();
	await h.page().getByLabel("Connector name", { exact: true }).fill("Fixture notes");
	await h.page().getByLabel("Connector ID", { exact: true }).fill("notes");
	await h.page().getByLabel("Executable path", { exact: true }).fill(process.execPath);
	await h.page().getByLabel("Token environment variable (optional)", { exact: true }).fill("FIXTURE_TOKEN");
	for (const [i, value] of [
		resolve("packages/local-executor/test/fixtures/mcp-server.mjs"),
		"normal",
		join(h.workspace, "connector-note.txt"),
	].entries()) {
		await h.page().getByRole("button", { name: "Add argument", exact: true }).click();
		await h
			.page()
			.getByLabel(`Argument ${i + 1}`, { exact: true })
			.fill(value);
	}
	await h.shot("01-install-en");
	await h.page().getByRole("button", { name: "Install and connect", exact: true }).click();
	await h.page().getByLabel("Token", { exact: true }).waitFor();
	expect((await list())[0]).toMatchObject({ state: "needs_attention", credentialConfigured: false });
	await h.page().getByLabel("Token", { exact: true }).fill(sentinel);
	await h.page().getByRole("button", { name: "Save credential", exact: true }).click();
	await poll(async () => await h.page().getByLabel("Token", { exact: true }).inputValue()).toBe("");
	await h.page().getByRole("button", { name: "Connect", exact: true }).click();
	await poll(async () => (await list())[0]?.state).toBe("connected");
	expect((await list())[0].credentialConfigured).toBe(true);
	expect(JSON.stringify(await list())).not.toContain(sentinel);
	expect(await h.page().locator("body").innerText()).not.toContain(sentinel);
	await h
		.page()
		.locator(".connectors-panel")
		.evaluate((el) => (el.scrollTop = 0));
	await h.shot("02-connected-en");
});
it("loads deferred schemas through Pi search then denies and approves exact calls", async () => {
	await coreChat();
	h.model.script(
		{ tool: "tool_search", args: { query: "write_note", limit: 1 } },
		{ tool: "mcp__notes__write_note", args: { text: "denied" } },
		{ text: "Connector write denied." },
	);
	const start = h.model.requests.length;
	await h.send("Find write_note and save a note.");
	await poll(async () => (await snapshot()).approvals[0]?.tool).toBe("mcp__notes__write_note");
	const names = (n: number) => (h.model.requests[n]?.tools ?? []).map((tool: any) => tool.function.name);
	expect(names(start)).toContain("tool_search");
	expect(names(start)).not.toContain("mcp__notes__write_note");
	expect(names(start + 1)).toContain("mcp__notes__write_note");
	expect(await h.page().locator(".approval").getByText("Always allow", { exact: true }).count()).toBe(0);
	await h.shot("03-approval-en");
	await h.page().locator(".approval").getByRole("button", { name: "Deny", exact: true }).click();
	await h.page().getByText("Connector write denied.", { exact: true }).waitFor();
	expect(await readFile(join(h.workspace, "connector-note.txt"), "utf8").catch(() => null)).toBeNull();
	h.model.script(
		{ tool: "mcp__notes__write_note", args: { text: "approved once" } },
		{ tool: "tool_search", args: { query: "echo_token", limit: 1 } },
		{ tool: "mcp__notes__echo_token", args: { text: "check" } },
		{ text: "Connector write and private credential check complete." },
	);
	await h.send("Save approved once, then check the token without revealing it.");
	await poll(async () => (await snapshot()).approvals[0]?.tool).toBe("mcp__notes__write_note");
	await h.page().locator(".approval").getByRole("button", { name: "Allow once", exact: true }).click();
	await poll(async () => (await snapshot()).approvals[0]?.tool).toBe("mcp__notes__echo_token");
	await h.page().locator(".approval").getByRole("button", { name: "Allow once", exact: true }).click();
	await h.page().getByText("Connector write and private credential check complete.", { exact: true }).waitFor();
	expect(await readFile(join(h.workspace, "connector-note.txt"), "utf8")).toBe("approved once");
	expect(JSON.stringify(h.model.requests)).not.toContain(sentinel);
	expect(JSON.stringify(await snapshot())).not.toContain(sentinel);
	const echo = (await snapshot()).items.find((item: any) => item.tool === "mcp__notes__echo_token");
	expect(echo.output).toContain("[redacted]");
});
it("keeps configuration after restart but requires an explicit connection and supports Chinese", async () => {
	await h.relaunch();
	expect((await list())[0]).toMatchObject({ state: "disconnected", credentialConfigured: true });
	await api("settings.update", { language: "zh-CN" });
	await h.page().getByRole("button", { name: /^设置/ }).click();
	await h.page().getByRole("button", { name: "连接应用", exact: true }).click();
	await h
		.page()
		.getByRole("button", { name: /Fixture notes/ })
		.click();
	await h.page().getByRole("button", { name: "连接", exact: true }).waitFor();
	await h.shot("04-disconnected-zh");
	await h.page().getByRole("button", { name: "连接", exact: true }).click();
	await poll(async () => (await list())[0]?.state).toBe("connected");
	await h.page().getByRole("button", { name: "断开连接", exact: true }).click();
	await poll(async () => (await list())[0]?.state).toBe("disconnected");
	await h.page().getByRole("button", { name: "连接", exact: true }).click();
	await poll(async () => (await list())[0]?.state).toBe("connected");
	await api("settings.update", { language: "en" });
});
it("cancels a pending approval on removal and never permits the queued write", async () => {
	await coreChat();
	h.model.script({ tool: "mcp__notes__write_note", args: { text: "must not overwrite" } }, { text: "Connector removed safely." });
	await h.send("Try another connector write.");
	await poll(async () => (await snapshot()).approvals[0]?.tool).toBe("mcp__notes__write_note");
	await h.page().getByRole("button", { name: /^Settings/ }).click();
	await h.page().getByRole("button", { name: "Connect apps", exact: true }).click();
	await h
		.page()
		.getByRole("button", { name: /Fixture notes/ })
		.click();
	await h.page().getByRole("button", { name: "Remove connector", exact: true }).click();
	await h.page().getByRole("button", { name: "Confirm removal", exact: true }).click();
	await poll(list).toEqual([]);
	await coreChat();
	await h.page().getByText("Connector removed safely.", { exact: true }).waitFor();
	expect(await readFile(join(h.workspace, "connector-note.txt"), "utf8")).toBe("approved once");
	const logs = await readFile(join(h.dataDirectory, "logs", "host.log"), "utf8").catch(() => "");
	expect(logs).not.toContain(sentinel);
	await h.shot("05-removed-en");
});
