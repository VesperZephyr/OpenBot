import { createServer, type Server } from "node:http";
import { mkdir, writeFile, readFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { launchApp, repo, type AppHarness } from "./harness.ts";
let h: AppHarness;
let server: Server, site: string;
const nativePage = async () => {
	await poll(async () =>
		h
			.app()
			.context()
			.pages()
			.some((page) => page !== h.page() && page.url().startsWith("preview:")),
	).toBe(true);
	return h
		.app()
		.context()
		.pages()
		.find((page) => page !== h.page() && page.url().startsWith("preview:"))!;
};
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/2cAAAAASUVORK5CYII=";
const markdown = `# Competitor radar\n\nA focused daily briefing. **Verified updates**, ready to read.\n\n## Product updates\n\n| Product | Release | Evidence |\n| --- | --- | --- |\n| OpenBot | 1.2 | Official changelog |\n| Agent Studio | 3.1 | Release notes |\n\n- [x] Domestic hunter checked\n- [ ] International follow-up\n\n## Analysis\n\nThe score is $x^2 + y^2$.\n\n\`\`\`typescript\nconst report = { verified: true };\n\`\`\`\n\n> Sources remain local and readable.\n\n[Jump to sources](#sources) · [Related note](related.md)\n\n## Sources\n\nAn official update[^1].\n\n[^1]: A recorded primary source.\n\n![Evidence pixel](pixel.png)\n\n<script>window.__markdownEscalation=true</script>\n`;
const html = `<!doctype html><html><head><style>body{font:16px system-ui;background:#f6f8f7;color:#183c32;padding:42px}h1{font-size:34px}article{background:white;padding:28px;border-radius:14px;max-width:720px}button{background:#1d6a51;color:white;border:0;border-radius:8px;padding:14px}p{line-height:1.8}</style></head><body><article><p>OPENBOT · LOCAL REPORT</p><h1>Interactive research brief</h1><p>Inline interactions work in this offline reading space.</p><button id="counter" onclick="this.textContent='Reviewed '+(++window.count)">Review findings</button><p id="network">Pending network check</p></article><script>window.count=0;fetch('https://example.invalid/reader-canary').then(()=>document.getElementById('network').textContent='Network escaped').catch(()=>document.getElementById('network').textContent='Network blocked');try{parent.document.body.dataset.escaped='yes'}catch{window.parentBlocked=true}</script></body></html>`;
const api = (name: string, params = {}): Promise<any> =>
	h.page().evaluate(({ name, params }) => (window as any).openbot.methods[name](params), { name, params });
const poll = (fn: () => Promise<any>) => expect.poll(fn, { timeout: 15000 });
const dialog = () => h.page().getByRole("dialog", { name: "Files", exact: true });
const open = async (name: string) => {
	await dialog().locator(".file-entries").getByRole("button", { name, exact: true }).click();
};
beforeAll(async () => {
	server = createServer((req, res) => {
		res.setHeader("Access-Control-Allow-Origin", "*");
		if (req.url === "/remote.js") {
			res.setHeader("Content-Type", "text/javascript");
			res.end("window.remoteResourceLoaded=true");
		} else if (req.url === "/api") {
			res.end("loaded");
		} else {
			res.setHeader("Content-Type", "text/html");
			res.end("<h1>Linked source page</h1><p>This page opens inside OpenBot.</p>");
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	site = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
	h = await launchApp("files", {
		prepare: async (run) => {
			const ws = join(run, "workspace");
			await mkdir(join(ws, "reports"));
			for (const [name, body] of Object.entries({
				"brief.md": markdown,
				"related.md": "# Related research\n\nBacked by evidence.",
				"interactive.html": html
					.replace("https://example.invalid/reader-canary", `${site}/api`)
					.replace("Network escaped", "Network loaded")
					.replace(
						"<script>window.count",
						`<a href="${site}/page" target="_blank">Read source page</a><script src="${site}/remote.js"></script><script>window.count`,
					),
				"table.csv": 'Product,Note\nOpenBot,"Quoted, with comma"\nAgent,"Line one\nLine two"',
				"unsupported.docx": "unsupported",
				"invalid.pdf": "wrong",
				"large.md": "x".repeat(2 * 1024 * 1024 + 1),
				"long.md": "# Long report\n" + "Verified evidence.\n\n".repeat(5000) + "END_OF_DOCUMENT",
			}))
				await writeFile(join(ws, name), body);
			await writeFile(join(ws, "pixel.png"), Buffer.from(png, "base64"));
			await writeFile(join(ws, "reports", "nested.txt"), "Nested local note");
			await copyFile(join(repo, "e2e/fixtures/reader.pdf"), join(ws, "reader.pdf"));
			await writeFile(join(run, "native.md"), "# Native selection\n\nRead without attaching.");
			return {};
		},
	});
	h.page().setDefaultTimeout(15000);
	h.page().on("console", (msg) => {
		if (msg.type() === "error" || msg.type() === "warning") console.log("Reader console:", msg.text());
	});
	h.page().on("pageerror", (err) => console.log("Reader error:", err.message));
});
afterEach(async ({ task }) => {
	if (task.result?.state === "fail") await h.shot("failure");
});
afterAll(async () => {
	await h?.close();
	await new Promise<void>((resolve) => server.close(() => resolve()));
});
it("opens a formatted Markdown reader with outline, GFM, math, code, images and source", async () => {
	await h.page().getByRole("button", { name: "Files", exact: true }).click();
	await open("brief.md");
	await dialog().getByRole("heading", { name: "Competitor radar", exact: true }).waitFor();
	expect(await dialog().locator(".reading-prose table tr").count()).toBe(3);
	expect(await dialog().locator(".katex").count()).toBeGreaterThan(0);
	expect(await dialog().locator(".hljs-keyword").count()).toBeGreaterThan(0);
	await poll(() =>
		dialog()
			.locator(".reading-prose img")
			.evaluate((img: HTMLImageElement) => img.naturalWidth),
	).toBe(1);
	expect(await h.page().evaluate(() => (window as any).__markdownEscalation)).toBeUndefined();
	await dialog().getByRole("button", { name: "Copy", exact: true }).click();
	await dialog().getByRole("button", { name: "Copied", exact: true }).waitFor();
	await dialog().getByRole("button", { name: "Sources", exact: true }).click();
	await dialog().getByRole("button", { name: "Competitor radar", exact: true }).click();
	await h.shot("01-markdown-en");
	await dialog().getByRole("button", { name: "Source", exact: true }).click();
	expect(await dialog().locator(".reader-source").textContent()).toBe(markdown);
	await dialog().getByRole("button", { name: "Reading", exact: true }).click();
	await dialog().getByRole("link", { name: "Related note", exact: true }).click();
	await dialog().getByRole("heading", { name: "Related research" }).waitFor();
	await open("long.md");
	await dialog()
		.getByText(/END_OF_DOCUMENT/)
		.waitFor();
});
it("shows loading and ignores a late result when the selected file changes", async () => {
	await h.app().evaluate(({ ipcMain }) => {
		const original = (ipcMain as any)._invokeHandlers.get("openbot:call");
		(globalThis as any).__readerOriginal = original;
		ipcMain.removeHandler("openbot:call");
		ipcMain.handle("openbot:call", async (event, method, params) => {
			const result = await original(event, method, params);
			if (method === "files.read" && params.path === "related.md")
				await new Promise((resolve) => {
					(globalThis as any).__readerRelease = resolve;
				});
			return result;
		});
	});
	try {
		await open("related.md");
		await dialog().getByRole("status").filter({ hasText: "Opening file…" }).waitFor();
		await h.shot("05-loading");
		await open("brief.md");
		await dialog().getByRole("heading", { name: "Competitor radar", exact: true }).waitFor();
		await h.app().evaluate(() => {
			(globalThis as any).__readerRelease();
		});
		await h.page().waitForTimeout(80);
		expect(await dialog().getByRole("heading", { name: "Related research", exact: true }).count()).toBe(0);
	} finally {
		await h.app().evaluate(({ ipcMain }) => {
			ipcMain.removeHandler("openbot:call");
			ipcMain.handle("openbot:call", (globalThis as any).__readerOriginal);
		});
	}
});
it("renders HTML resources and linked pages in an isolated embedded browser", async () => {
	await open("interactive.html");
	const page = await nativePage();
	await page.getByRole("heading", { name: "Interactive research brief" }).waitFor();
	await page.getByRole("button", { name: "Review findings" }).click();
	await page.getByRole("button", { name: "Reviewed 1" }).waitFor();
	await page.getByText("Network loaded", { exact: true }).waitFor();
	expect(
		await page.evaluate(() => ({
			bridge: typeof (window as any).openbot,
			node: typeof (window as any).require,
			resource: (window as any).remoteResourceLoaded,
		})),
	).toEqual({ bridge: "undefined", node: "undefined", resource: true });
	expect(
		await page.evaluate(async () => {
			try {
				await fetch("file:///etc/passwd");
				return "escaped";
			} catch {
				return "blocked";
			}
		}),
	).toBe("blocked");
	expect(
		await page.evaluate(async () => {
			try {
				await fetch("app://openbot/index.html");
				return "escaped";
			} catch {
				return "blocked";
			}
		}),
	).toBe("blocked");
	const viewport = await h.page().locator(".reader-web-viewport").boundingBox();
	const bounds = await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.contentView.children.at(-1)!.getBounds());
	expect(Math.abs(bounds.x - viewport!.x)).toBeLessThan(2);
	expect(Math.abs(bounds.width - viewport!.width)).toBeLessThan(2);
	await page.screenshot({ path: join(h.run, "02-html-content-en.png") });
	await h.shot("02-html-shell-en");
	const oldUrl = page.url();
	await page.getByRole("link", { name: "Read source page", exact: true }).click();
	await page.getByRole("heading", { name: "Linked source page" }).waitFor();
	expect(h.app().context().pages()).toHaveLength(2);
	await dialog().getByRole("button", { name: "Back", exact: true }).click();
	await page.getByRole("heading", { name: "Interactive research brief" }).waitFor();
	await dialog().getByRole("button", { name: "Source", exact: true }).click();
	await poll(async () => page.isClosed()).toBe(true);
	await expect(h.page().evaluate((url) => (window as any).openbot.readerOpen(url), oldUrl)).rejects.toThrow("address");
	await open("brief.md");
	await dialog().getByRole("heading", { name: "Competitor radar", exact: true }).waitFor();
});
it("reads PDF pages, quoted CSV, images and nested files with useful errors", async () => {
	await open("reader.pdf");
	await dialog().getByText("Page 1 of 2", { exact: true }).waitFor();
	await dialog().locator(".react-pdf__Page__textContent").getByText("OpenBot reader page 1", { exact: true }).waitFor();
	await dialog().getByRole("button", { name: "Next page", exact: true }).click();
	await dialog().locator(".react-pdf__Page__textContent").getByText("OpenBot reader page 2", { exact: true }).waitFor();
	await h.shot("03-pdf-en");
	await open("table.csv");
	await dialog().getByRole("cell", { name: "Quoted, with comma", exact: true }).waitFor();
	expect(await dialog().locator(".csv-reader tr").count()).toBe(3);
	await open("pixel.png");
	await poll(() =>
		dialog()
			.locator(".reader-image img")
			.evaluate((img: HTMLImageElement) => img.naturalWidth),
	).toBe(1);
	await open("reports");
	await open("nested.txt");
	await dialog().getByText("Nested local note", { exact: true }).waitFor();
	await dialog().getByRole("button", { name: "Parent folder", exact: true }).click();
	for (const name of ["unsupported.docx", "invalid.pdf", "large.md"]) {
		await open(name);
		await dialog().getByRole("alert").waitFor();
		expect(await dialog().getByRole("alert").textContent()).toContain("Could not open file");
	}
});
it("opens native selections without attaching or inference and preserves chat drafts on close", async () => {
	expect(await h.page().evaluate(() => typeof (window as any).openbot.methods["files.open"])).toBe("undefined");
	await h.app().evaluate(
		({ dialog }, path) => {
			dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as any;
		},
		join(h.run, "native.md"),
	);
	await dialog().getByRole("button", { name: "Open file", exact: true }).click();
	await dialog().getByRole("heading", { name: "Native selection", exact: true }).waitFor();
	expect(await h.page().locator(".attachment-chips .artifact-card").count()).toBe(0);
	expect(h.model.requests).toHaveLength(0);
	await dialog().getByRole("button", { name: "Close preview", exact: true }).click();
	const composer = h.page().locator(".compose-area textarea");
	await composer.fill("Keep this draft");
	await h.page().getByRole("button", { name: "Files", exact: true }).click();
	await dialog().getByRole("heading", { name: "Native selection", exact: true }).waitFor();
	await h.page().keyboard.press("Escape");
	expect(await composer.inputValue()).toBe("Keep this draft");
	expect(await dialog().count()).toBe(0);
});
it("supports Chinese dark mode and the minimum window size", async () => {
	await api("settings.update", { language: "zh-CN" });
	await h.page().evaluate(() => {
		localStorage.setItem("openbot.appearance", "dark");
	});
	await h.page().reload();
	await h.app().evaluate(({ BrowserWindow }) => {
		BrowserWindow.getAllWindows()[0]!.setSize(880, 640);
	});
	await h.page().getByRole("button", { name: "文件", exact: true }).click();
	await dialog().count();
	await h.page().locator(".file-entries").getByRole("button", { name: "brief.md", exact: true }).click();
	await h.page().getByRole("heading", { name: "Competitor radar", exact: true }).waitFor();
	expect(
		await h
			.page()
			.locator(".file-workspace")
			.evaluate((el) => el.scrollWidth <= el.clientWidth),
	).toBe(true);
	await h.shot("04-markdown-zh-dark-min");
	await h.page().getByRole("button", { name: "关闭预览", exact: true }).click();
	expect(h.model.requests).toHaveLength(0);
	const logs = await readFile(join(h.dataDirectory, "logs", "host.log"), "utf8");
	expect(logs).not.toContain("Read without attaching");
	expect(logs).not.toContain("native.md");
});
