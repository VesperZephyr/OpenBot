import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { launchApp, type AppHarness } from "./harness.ts";
let h: AppHarness, core: string, textId: string, imageId: string;
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/2cAAAAASUVORK5CYII=";
const api = (name: string, params = {}): Promise<any> =>
	h.page().evaluate(({ name, params }) => (window as any).openbot.methods[name](params), { name, params });
const poll = (fn: () => Promise<any>) => expect.poll(fn, { timeout: 15000 });
const snapshot = () => api("conversations.snapshot", { botId: core });
const box = () => h.page().locator(".compose-area textarea");
const card = (id: string) => h.page().locator(`.messages .artifact-card[data-artifact-id="${id}"]`).first();
const idle = () => poll(async () => (await snapshot()).run).toBeUndefined();
beforeAll(async () => {
	h = await launchApp("artifacts", {
		prepare: async (run) => {
			const path = join(run, "home", "models.json"),
				config = JSON.parse(await readFile(path, "utf8"));
			config.providers.scripted.models[0].input = ["text", "image"];
			await writeFile(path, JSON.stringify(config));
			await writeFile(join(run, "notes.md"), "ATTACHMENT_BODY_CANARY 本地材料");
			await writeFile(join(run, "pixel.png"), Buffer.from(png, "base64"));
			return {};
		},
	});
	h.page().setDefaultTimeout(10000);
	await api("settings.update", { defaultModel: { provider: "scripted", modelId: "scripted" } });
	core = (await api("bots.list"))[0].botId;
});
afterEach(async ({ task }) => {
	if (task.result?.state === "fail") await h.shot("failure");
});
afterAll(async () => {
	await h?.close();
});
it("imports selected text/images, retains them after source deletion and sends actual multimodal content", async () => {
	await h.app().evaluate(
		({ dialog }, paths) => {
			dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as any;
		},
		[join(h.run, "notes.md"), join(h.run, "pixel.png")],
	);
	await h.page().getByRole("button", { name: "Attach files", exact: true }).click();
	await poll(() => h.page().locator(".attachment-chips .artifact-card").count()).toBe(2);
	const ids = await h
		.page()
		.locator(".attachment-chips .artifact-card")
		.evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-artifact-id")));
	textId = ids[0]!;
	imageId = ids[1]!;
	await rm(join(h.run, "notes.md"));
	await rm(join(h.run, "pixel.png"));
	await box().fill("Read these selected files.");
	await h.page().reload();
	await poll(() => h.page().locator(".attachment-chips .artifact-card").count()).toBe(2);
	h.model.script({ text: "I read the selected local attachments." });
	await box().press("Enter");
	await h.page().getByText("I read the selected local attachments.", { exact: true }).waitFor();
	await idle();
	const input = h.model.requests[0]!.messages.filter((m) => m.role === "user");
	expect(JSON.stringify(input)).toContain("ATTACHMENT_BODY_CANARY");
	expect(JSON.stringify(input)).toContain("data:image/png;base64,");
	const user = (await snapshot()).items.find((i: any) => i.kind === "user");
	expect(user.attachments.map((a: any) => a.artifactId)).toEqual([textId, imageId]);
	expect(JSON.stringify(user)).not.toContain("ATTACHMENT_BODY_CANARY");
	expect((await api("conversations.search", { query: "notes.md" })).items.length).toBeGreaterThan(0);
	expect((await api("conversations.search", { query: "ATTACHMENT_BODY_CANARY" })).items).toHaveLength(0);
	expect(await h.page().evaluate(() => typeof (window as any).openbot.methods["artifacts.import"])).toBe("undefined");
	await card(imageId).getByRole("button", { name: "Preview", exact: true }).click();
	await card(imageId).locator("img").waitFor();
	await poll(() =>
		card(imageId)
			.locator("img")
			.evaluate((img: HTMLImageElement) => img.naturalWidth),
	).toBe(1);
	await h.shot("01-inputs-en");
});
it("rejects renderer paths and expires a native selection when its renderer navigates", async () => {
	await expect(
		h.page().evaluate(() => (window as any).openbot.exportArtifact({ artifactId: "bad", requestId: "r", path: "/tmp/forged" })),
	).rejects.toThrow("Invalid export request");
	await writeFile(join(h.run, "expired.txt"), "EXPIRED_PICKER_CANARY");
	await h.app().evaluate(({ dialog }) => {
		dialog.showOpenDialog = (() =>
			new Promise((resolve) => {
				(globalThis as any).__pickerResolve = resolve;
			})) as any;
	});
	await h.page().getByRole("button", { name: "Attach files", exact: true }).click();
	await poll(() => h.app().evaluate(() => typeof (globalThis as any).__pickerResolve)).toBe("function");
	await h.page().reload();
	await h.app().evaluate(
		(_electron, path) => {
			(globalThis as any).__pickerResolve({ canceled: false, filePaths: [path] });
		},
		join(h.run, "expired.txt"),
	);
	await new Promise((resolve) => setTimeout(resolve, 100));
	expect(await h.page().locator(".attachment-chips .artifact-card").count()).toBe(0);
	const audit = await readFile(join(h.dataDirectory, "logs", "host.log"), "utf8");
	expect(audit.match(/"action":"import"/g)).toHaveLength(2);
});
it("publishes immutable HTML as escaped text, exports without overwrite and retains removal after restart", async () => {
	const html = "<html><script>window.__artifactCanary=true</script><body>RESULT_CANARY</body></html>";
	h.model.script(
		{ tool: "local_write", args: { path: "report.html", content: html } },
		{ tool: "artifact_publish", args: { path: "report.html", name: "Summary.html" } },
		{ text: "The result file is ready." },
	);
	await box().fill("Create and publish the synthetic result.");
	await box().press("Enter");
	await h.page().getByText("The result file is ready.", { exact: true }).waitFor();
	await idle();
	const result = (await snapshot()).items.find((i: any) => i.kind === "tool" && i.tool === "artifact_publish");
	expect(result.status).toBe("succeeded");
	const id = result.artifact.artifactId;
	await writeFile(join(h.workspace, "report.html"), "source changed");
	await card(id).getByRole("button", { name: "Preview", exact: true }).click();
	expect(await card(id).locator(".artifact-preview pre").textContent()).toBe(html);
	expect(await h.page().evaluate(() => (window as any).__artifactCanary)).toBeUndefined();
	expect(await h.page().locator("iframe").count()).toBe(0);
	const destination = join(h.run, "exported.html");
	await h.app().evaluate(({ dialog }, path) => {
		dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as any;
	}, destination);
	await card(id).getByRole("button", { name: "Export copy", exact: true }).click();
	await poll(async () => readFile(destination, "utf8").catch(() => "")).toBe(html);
	await card(id).getByRole("button", { name: "Export copy", exact: true }).click();
	await h.page().getByText("Export destination already exists. Choose a new filename.", { exact: true }).waitFor();
	await h.shot("02-safe-result-en");
	await card(id).getByRole("button", { name: "Remove local copy", exact: true }).click();
	await card(id).getByRole("alertdialog").getByRole("button", { name: "Remove local copy", exact: true }).click();
	await card(id).getByText("This local copy is unavailable", { exact: true }).waitFor();
	await h.relaunch();
	await card(id).getByText("This local copy is unavailable", { exact: true }).waitFor();
	const audit = await readFile(join(h.dataDirectory, "logs", "host.log"), "utf8");
	expect(audit).not.toContain("ATTACHMENT_BODY_CANARY");
	expect(audit).not.toContain("RESULT_CANARY");
});
it("retries a lost acknowledgement with immutable attachments and preserves a newer draft", async () => {
	const requestId = "attachment-lost-ack",
		text = "Check the same saved attachment.";
	h.model.script({ text: "Attachment retry receipt." });
	await api("messages.submit", { botId: core, requestId, text, artifactIds: [textId] });
	await h.page().getByText("Attachment retry receipt.", { exact: true }).waitFor();
	await idle();
	const ref = await api("artifacts.get", { artifactId: textId }),
		calls = h.model.requests.length;
	await h.page().evaluate(
		({ core, requestId, text, ref }) => {
			const key = `bot:${core}`,
				draft = { version: 1, text: "Newer unsent draft", recipientIds: [], revision: 2, updatedAt: Date.now() };
			localStorage.setItem(
				"openbot.composers.v1",
				JSON.stringify({
					version: 1,
					records: {
						[key]: {
							draft,
							attempt: { requestId, conversationKey: key, text, recipientIds: [], attachments: [ref], draftRevision: 1, state: "pending" },
						},
					},
				}),
			);
		},
		{ core, requestId, text, ref },
	);
	await h.page().reload();
	await h.page().getByRole("button", { name: "Retry send", exact: true }).click();
	await h.page().getByText("Message delivery is uncertain", { exact: true }).waitFor({ state: "detached" });
	expect(await box().inputValue()).toBe("Newer unsent draft");
	expect(h.model.requests.length).toBe(calls);
	expect((await snapshot()).items.filter((i: any) => i.kind === "user" && i.parts.some((p: any) => p.text === text))).toHaveLength(1);
	await expect(api("messages.submit", { botId: core, requestId, text, artifactIds: [imageId] })).rejects.toThrow("another message");
});
it("publishes group task results without attaching an earlier delivery's files", async () => {
	const member = (await api("bots.create", { requestId: "file-member", name: "File helper" })).botId,
		groupId = "group_files";
	await api("groups.change", {
		requestId: "file-group",
		action: "create",
		groupId,
		expectedRevision: 0,
		fields: { name: "File team", objective: "Synthetic result sharing", memberIds: [core, member], leadBotId: member },
	});
	await h.page().locator(".group-nav").filter({ hasText: "File team" }).click();
	h.model.script(
		{ tool: "local_write", args: { path: "group-result.txt", content: "GROUP_RESULT" } },
		{ tool: "artifact_publish", args: { path: "group-result.txt" } },
		{ text: "Published the group result." },
	);
	await api("groups.send", { groupId, requestId: "group-file", text: "Publish the result", recipientIds: [member] });
	await poll(
		async () =>
			(await api("groups.snapshot", { groupId })).posts.find((p: any) => p.text === "Published the group result.")?.attachments?.length,
	).toBe(1);
	const posts = (await api("groups.snapshot", { groupId })).posts,
		id = posts.find((p: any) => p.text === "Published the group result.").attachments[0].artifactId;
	const result = h.page().locator(`.group-post .artifact-card[data-artifact-id="${id}"]`);
	await result.getByRole("button", { name: "Preview", exact: true }).click();
	expect(await result.locator("pre").textContent()).toBe("GROUP_RESULT");
	h.model.script({ text: "A later delivery without a file." });
	await api("groups.send", { groupId, requestId: "group-followup", text: "Acknowledge only", recipientIds: [member] });
	await poll(async () =>
		(await api("groups.snapshot", { groupId })).posts.some((p: any) => p.text === "A later delivery without a file."),
	).toBe(true);
	expect(
		(await api("groups.snapshot", { groupId })).posts.find((p: any) => p.text === "A later delivery without a file.").attachments,
	).toBeUndefined();
	await h.shot("04-group-result");
	await h.page().locator(".bot-row:not(.group-nav)").filter({ hasText: "Core" }).first().click();
});
it("rejects incompatible image models and presents Chinese cards in a small dark window", async () => {
	await api("models.addProvider", {
		id: "text-only",
		name: "Text only",
		baseUrl: h.modelBaseUrl,
		api: "openai-completions",
		modelIds: ["text-only"],
	});
	await api("settings.update", { language: "zh-CN", defaultModel: { provider: "text-only", modelId: "text-only" } });
	await expect(api("messages.submit", { botId: core, requestId: "unsupported-image", text: "", artifactIds: [imageId] })).rejects.toThrow(
		"does not support image",
	);
	await h.page().reload();
	await card(textId).getByRole("button", { name: "预览", exact: true }).click();
	await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(880, 700));
	await h.page().emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
	expect(await h.page().evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	expect(await h.page().evaluate(() => (window as any).openbot.windowActive())).toBe(false);
	await h.shot("03-files-zh-dark");
});
