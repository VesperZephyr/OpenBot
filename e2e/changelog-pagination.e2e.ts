import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { launchApp, createBot, repo, type AppHarness } from "./harness.ts";
let h: AppHarness;
beforeAll(async () => { h = await launchApp("changelog-pagination", { env: { OPENBOT_HOST_ENTRY: join(repo, "e2e/fixtures/changelog-pagination-host.mts") } }); await createBot(h, "Catalogue Researcher"); }, 60_000);
afterAll(async () => { await h?.close(); });
it("reads remote HTML and JSON continuations, retaining product/date precision and explicit terminal evidence", async () => {
	h.model.script(
		{ tool: "web_fetch", args: { url: "https://zcode.z.ai/_next/changelog?page=1", mode: "page" } },
		{ tool: "web_fetch", args: request => { expect(JSON.stringify(request.messages.at(-1))).toContain("Scroll to load more releases."); return { url: "https://zcode.z.ai/_next/changelog?page=2", mode: "page" }; } },
		{ tool: "web_fetch", args: request => { expect(JSON.stringify(request.messages.at(-1))).toContain("You've reached the end of the release history."); return { url: "https://www.trae.cn/api/changelog?page=1&page_size=10" }; } },
		{ tool: "web_fetch", args: request => { const text = JSON.stringify(request.messages.at(-1)); expect(text).toContain('has_more\\\":true'); return { url: "https://www.trae.cn/api/changelog?page=2&page_size=10" }; } },
		{ text: "Both official catalogues reached their terminal page. Dates remain date-only: exact-window publication is unverified. TRAE and TRAE APP remain separate." },
	);
	await h.send("Read both official catalogues through their remote terminal pages, preserving dates and product variants.");
	await h.page().locator(".transcript").getByText("Both official catalogues reached their terminal page.", { exact: false }).waitFor();
	const messages = JSON.stringify(h.model.requests.at(-1)?.messages);
	for (const value of ['has_more\\\":false', 'total_entries\\\":11', '2026-10-26', 'TRAE APP', "Earlier body"]) expect(messages).toContain(value);
	await h.page().locator(".steps-row").last().locator("summary").first().click();
	await h.page().locator(".transcript").getByText("Both official catalogues reached their terminal page.", { exact: false }).scrollIntoViewIfNeeded();
	await h.shot("01-official-pagination");
});
