import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { launchApp, type AppHarness } from "./harness.ts";
let h: AppHarness, core: string, textId: string, imageId: string;
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/2cAAAAASUVORK5CYII=";
const poll = (fn: () => Promise<any>) => expect.poll(fn, { timeout: 15000 });
const snapshot = () => h.api("conversations.snapshot", { botId: core });
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
	await h.api("settings.update", {
		defaultModel: { provider: "scripted", modelId: "scripted" },
	});
	core = (await h.api("bots.list"))[0].botId;
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
			dialog.showOpenDialog = (async () => ({
				canceled: false,
				filePaths: paths,
			})) as any;
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
	expect((await h.api("conversations.search", { query: "notes.md" })).items.length).toBeGreaterThan(0);
	expect((await h.api("conversations.search", { query: "ATTACHMENT_BODY_CANARY" })).items).toHaveLength(0);
	expect(await h.page().evaluate(() => typeof (window as any).openbot.methods["artifacts.import"])).toBe("undefined");
	await card(imageId).getByRole("button", { name: "Preview", exact: true }).click();
	await h.page().locator(".reader-image img").waitFor();
	await poll(() =>
		h
			.page()
			.locator(".reader-image img")
			.evaluate((img: HTMLImageElement) => img.naturalWidth),
	).toBe(1);
	await h.shot("01-inputs-en");
	await h.page().getByRole("button", { name: "Close preview", exact: true }).click();
});
it("rejects renderer paths and expires a native selection when its renderer navigates", async () => {
	await expect(
		h.page().evaluate(() =>
			(window as any).openbot.exportArtifact({
				artifactId: "bad",
				requestId: "r",
				path: "/tmp/forged",
			}),
		),
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
			(globalThis as any).__pickerResolve({
				canceled: false,
				filePaths: [path],
			});
		},
		join(h.run, "expired.txt"),
	);
	await new Promise((resolve) => setTimeout(resolve, 100));
	expect(await h.page().locator(".attachment-chips .artifact-card").count()).toBe(0);
	const audit = await readFile(join(h.dataDirectory, "logs", "host.log"), "utf8");
	expect(audit.match(/"action":"import"/g)).toHaveLength(2);
});
it("publishes immutable HTML in an isolated reader, exports without overwrite and retains removal after restart", async () => {
	const html = "<html><script>window.__artifactCanary=true</script><body>RESULT_CANARY</body></html>";
	h.model.script(
		{ tool: "local_write", args: { path: "report.html", content: html } },
		{
			tool: "artifact_publish",
			args: { path: "report.html", name: "Summary.html" },
		},
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
	await poll(async () =>
		h
			.app()
			.context()
			.pages()
			.some((page) => page.url().startsWith("preview:")),
	).toBe(true);
	const htmlPage = h
		.app()
		.context()
		.pages()
		.find((page) => page.url().startsWith("preview:"))!;
	await htmlPage.getByText("RESULT_CANARY", { exact: true }).waitFor();
	await h.page().getByRole("button", { name: "Source", exact: true }).click();
	expect(await h.page().locator(".reader-source").textContent()).toBe(html);
	expect(await h.page().evaluate(() => (window as any).__artifactCanary)).toBeUndefined();
	expect(await h.page().locator("iframe").count()).toBe(0);
	await h.page().getByRole("button", { name: "Close preview", exact: true }).click();
	const destination = join(h.run, "exported.html");
	await h.app().evaluate(({ dialog }, path) => {
		dialog.showSaveDialog = (async () => ({
			canceled: false,
			filePath: path,
		})) as any;
	}, destination);
	await card(id).getByRole("button", { name: "Export copy", exact: true }).click();
	await poll(async () => readFile(destination, "utf8").catch(() => "")).toBe(html);
	await card(id).getByRole("button", { name: "Export copy", exact: true }).click();
	await h
		.page()
		.getByText("Export destination already exists. Choose a new filename.", {
			exact: true,
		})
		.waitFor();
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
	await h.api("messages.submit", {
		botId: core,
		requestId,
		text,
		artifactIds: [textId],
	});
	await h.page().getByText("Attachment retry receipt.", { exact: true }).waitFor();
	await idle();
	const ref = await h.api("artifacts.get", { artifactId: textId }),
		calls = h.model.requests.length;
	await h.page().evaluate(
		({ core, requestId, text, ref }) => {
			const key = `bot:${core}`,
				draft = {
					version: 1,
					text: "Newer unsent draft",
					recipientIds: [],
					revision: 2,
					updatedAt: Date.now(),
				};
			localStorage.setItem(
				"openbot.composers.v1",
				JSON.stringify({
					version: 1,
					records: {
						[key]: {
							draft,
							attempt: {
								requestId,
								conversationKey: key,
								text,
								recipientIds: [],
								attachments: [ref],
								draftRevision: 1,
								state: "pending",
							},
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
	await expect(
		h.api("messages.submit", {
			botId: core,
			requestId,
			text,
			artifactIds: [imageId],
		}),
	).rejects.toThrow("another message");
});
it("opens AI Markdown and PDF result filenames directly in a focused reader", async () => {
	h.model.script(
		{
			tool: "local_write",
			args: {
				path: "Daily brief.md",
				content: "# Daily radar brief\n\n**Verified evidence** in the conversation.",
			},
		},
		{ tool: "artifact_publish", args: { path: "Daily brief.md" } },
		{ text: "Your readable report is ready." },
	);
	await box().fill("Prepare the daily report file.");
	await box().press("Enter");
	await h.page().getByText("Your readable report is ready.", { exact: true }).waitFor();
	await idle();
	await box().fill("Keep my next question");
	await h.page().locator(".messages .artifact-name").filter({ hasText: "Daily brief.md" }).click();
	await h.page().getByRole("heading", { name: "Daily radar brief", exact: true }).waitFor();
	expect(await h.page().locator(".file-browser").count()).toBe(0);
	await h.shot("06-message-file-reader");
	await h.page().getByRole("button", { name: "Close preview", exact: true }).click();
	expect(await box().inputValue()).toBe("Keep my next question");
	await writeFile(join(h.workspace, "Published.pdf"), await readFile(join(import.meta.dirname, "fixtures", "reader.pdf")));
	h.model.script({ tool: "artifact_publish", args: { path: "Published.pdf" } }, { text: "The PDF is ready." });
	await box().fill("Share the prepared PDF.");
	await box().press("Enter");
	await h.page().getByText("The PDF is ready.", { exact: true }).waitFor();
	await idle();
	const requests = h.model.requests.length;
	await h.page().locator(".messages .artifact-name").filter({ hasText: "Published.pdf" }).click();
	await h.page().getByText("Page 1 of 2", { exact: true }).waitFor();
	expect(h.model.requests).toHaveLength(requests);
	await h.shot("07-message-pdf-reader");
	await h.page().getByRole("button", { name: "Close preview", exact: true }).click();
});
it("publishes group task results without attaching an earlier delivery's files", async () => {
	const member = (
			await h.api("bots.create", {
				requestId: "file-member",
				name: "File helper",
			})
		).botId,
		groupId = "group_files";
	await h.api("groups.change", {
		requestId: "file-group",
		action: "create",
		groupId,
		expectedRevision: 0,
		fields: {
			name: "File team",
			objective: "Synthetic result sharing",
			memberIds: [core, member],
			leadBotId: member,
		},
	});
	await h.page().locator(".group-nav").filter({ hasText: "File team" }).click();
	h.model.script(
		{
			tool: "local_write",
			args: { path: "group-result.txt", content: "GROUP_RESULT" },
		},
		{ tool: "artifact_publish", args: { path: "group-result.txt" } },
		{ text: "Published the group result." },
	);
	await h.api("groups.send", {
		groupId,
		requestId: "group-file",
		text: "Publish the result",
		recipientIds: [member],
	});
	await poll(
		async () =>
			(await h.api("groups.snapshot", { groupId })).posts.find((p: any) => p.text === "Published the group result.")?.attachments?.length,
	).toBe(1);
	const posts = (await h.api("groups.snapshot", { groupId })).posts,
		id = posts.find((p: any) => p.text === "Published the group result.").attachments[0].artifactId;
	const result = h.page().locator(`.group-post .artifact-card[data-artifact-id="${id}"]`);
	await result.getByRole("button", { name: "Preview", exact: true }).click();
	expect(await h.page().locator(".reader-source").textContent()).toBe("GROUP_RESULT");
	await h.page().getByRole("button", { name: "Close preview", exact: true }).click();
	h.model.script({ text: "A later delivery without a file." });
	await h.api("groups.send", {
		groupId,
		requestId: "group-followup",
		text: "Acknowledge only",
		recipientIds: [member],
	});
	await poll(async () =>
		(await h.api("groups.snapshot", { groupId })).posts.some((p: any) => p.text === "A later delivery without a file."),
	).toBe(true);
	expect(
		(await h.api("groups.snapshot", { groupId })).posts.find((p: any) => p.text === "A later delivery without a file.").attachments,
	).toBeUndefined();
	await h.shot("04-group-result");
	await h
		.page()
		.locator(".bot-row:not(.group-nav)")
		.filter({ has: h.page().getByText("OpenBot", { exact: true }) })
		.first()
		.click();
});
it("opens a generated group Markdown and HTML pair with aligned controls and retained page state", async () => {
	await h.page().reload();
	await h.page().locator(".group-nav").filter({ hasText: "File team" }).click();
	const md =
		"# Radar reading brief\n\nBased on a previously verified report.\n\n| Product | Region | Status |\n| --- | --- | --- |\n| Domestic sample | Domestic | Verified |\n| Overseas sample | Overseas | Unverified |";
	const html =
		'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Radar reading page</title><style>body{font:16px system-ui;padding:20px;margin:0}button{padding:8px}article{margin-top:16px}h1{font-size:24px}</style></head><body><h1>Radar reading page</h1><button onclick="document.querySelector(\'#domestic\').hidden=true;this.textContent=\'Overseas selected\'">Overseas</button><article id="domestic">Domestic sample</article><article>Overseas sample</article></body></html>';
	h.model.script(
		{ tool: "local_write", args: { path: "radar-reading-with-a-long-shared-report-name.md", content: md } },
		{
			tool: "local_write",
			args: { path: "radar-reading-with-a-long-shared-report-name.html", content: html },
		},
		{ tool: "artifact_publish", args: { path: "radar-reading-with-a-long-shared-report-name.md" } },
		{ tool: "artifact_publish", args: { path: "radar-reading-with-a-long-shared-report-name.html" } },
		{ text: "Both radar files are ready." },
	);
	const composer = h.page().locator(".group-view textarea");
	await composer.fill("Generate the Markdown and interactive HTML reading pair.");
	await composer.press("Enter");
	const post = h.page().locator(".group-post").filter({ hasText: "Both radar files are ready." });
	await post.getByRole("button", { name: "radar-reading-with-a-long-shared-report-name.md", exact: true }).waitFor();
	await composer.fill("Keep my question while reading");
	await post.getByRole("button", { name: "radar-reading-with-a-long-shared-report-name.md", exact: true }).click();
	await h.page().getByRole("heading", { name: "Radar reading brief", exact: true }).waitFor();
	await post.getByRole("button", { name: "radar-reading-with-a-long-shared-report-name.html", exact: true }).click();
	await poll(
		async () =>
			h
				.app()
				.context()
				.pages()
				.filter((page) => page.url().startsWith("preview:")).length,
	).toBe(1);
	const page = h
		.app()
		.context()
		.pages()
		.find((page) => page.url().startsWith("preview:"))!;
	await page.getByRole("button", { name: "Overseas", exact: true }).click();
	await h.page().getByRole("tab", { name: "radar-reading-with-a-long-shared-report-name.md", exact: true }).click();
	await h.page().getByRole("button", { name: "Zoom in", exact: true }).click();
	await h.page().getByRole("tab", { name: "radar-reading-with-a-long-shared-report-name.html", exact: true }).click();
	await page.getByRole("button", { name: "Overseas selected", exact: true }).waitFor();
	expect(await page.locator("#domestic").isVisible()).toBe(false);
	await post.getByRole("button", { name: "radar-reading-with-a-long-shared-report-name.md", exact: true }).click();
	expect(await h.page().getByRole("tablist", { name: "Open files and pages" }).getByRole("tab").count()).toBe(2);
	expect(await h.page().getByRole("button", { name: "Reset zoom", exact: true }).textContent()).toBe("110%");
	expect(await composer.inputValue()).toBe("Keep my question while reading");
	expect(await h.page().locator(".file-browser").count()).toBe(0);
	expect(await h.page().locator(".reader-tab-extension").allTextContents()).toEqual([".md", ".html"]);
	const buttons = h.page().locator(".reader-tab-content:not([hidden]) .reader-zoom-controls button");
	const bounds = await buttons.evaluateAll((nodes) =>
		nodes.map((node) => {
			const r = node.getBoundingClientRect();
			return { x: r.x, y: r.y, w: r.width, h: r.height };
		}),
	);
	expect(new Set(bounds.map((r) => r.y)).size).toBe(1);
	expect(bounds[2]!.x - bounds[1]!.x - bounds[1]!.w).toBeLessThan(8);
	for (const r of bounds) expect(r.h).toBeGreaterThanOrEqual(28);
	const icons = await h
		.page()
		.locator(".reader-tabs-header svg")
		.evaluateAll((nodes) =>
			nodes.map((node) => {
				const r = node.getBoundingClientRect();
				return [r.width, r.height];
			}),
		);
	expect(icons.every(([width, height]) => width === 16 && height === 16)).toBe(true);
	const labels = await h
		.page()
		.locator(".reader-tab-title")
		.evaluateAll((nodes) => nodes.map((n) => n.scrollWidth > n.clientWidth));
	expect(labels).toEqual([true, true]);
	for (const suffix of await h.page().locator(".reader-tab-extension").all()) expect(await suffix.isVisible()).toBe(true);
	const tabBar = await h.page().locator(".reader-tabs").boundingBox();
	for (const close of await h.page().locator(".reader-tab-close").all()) {
		const bounds = await close.boundingBox();
		expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(tabBar!.x + tabBar!.width + 1);
	}
	await h.shot("08-group-reading-pair");
	await h.page().getByRole("tab", { name: "radar-reading-with-a-long-shared-report-name.html", exact: true }).click();
	await page.screenshot({ path: join(h.run, "08-group-html-page.png") });
	await h.page().getByRole("button", { name: "Close radar-reading-with-a-long-shared-report-name.html", exact: true }).click();
	await poll(async () => page.isClosed()).toBe(true);
	await h.page().getByRole("heading", { name: "Radar reading brief", exact: true }).waitFor();
	await h.page().getByRole("button", { name: "Close preview", exact: true }).click();
	await composer.fill("");
	await h
		.page()
		.locator(".bot-row:not(.group-nav)")
		.filter({ has: h.page().getByText("OpenBot", { exact: true }) })
		.first()
		.click();
});
it("rejects incompatible image models and presents Chinese cards in a small dark window", async () => {
	await h.api("models.addProvider", {
		id: "text-only",
		name: "Text only",
		baseUrl: h.modelBaseUrl,
		api: "openai-completions",
		modelIds: ["text-only"],
	});
	await h.api("settings.update", {
		language: "zh-CN",
		defaultModel: { provider: "text-only", modelId: "text-only" },
	});
	await expect(
		h.api("messages.submit", {
			botId: core,
			requestId: "unsupported-image",
			text: "",
			artifactIds: [imageId],
		}),
	).rejects.toThrow("does not support image");
	await h.page().reload();
	await card(textId).getByRole("button", { name: "预览", exact: true }).click();
	await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(880, 700));
	await h.page().emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
	expect(await h.page().evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	expect(await h.page().evaluate(() => (window as any).openbot.windowActive())).toBe(false);
	await h.shot("03-files-zh-dark");
});
