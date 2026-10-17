/**
 * End-to-end: web search. The Tavily key is stored through Settings, a fake Tavily endpoint stands in for the provider
 * (`OPENBOT_TAVILY_BASE_URL`), and a scripted model calls `web_search`. Screenshots land in e2e/.run/web/.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AppHarness, createBot, launchApp } from "./harness.ts";

const KEY = "tvly-e2e-key";
let h: AppHarness;
let tavily: Server;
const authorizations: (string | undefined)[] = [];

beforeAll(async () => {
	tavily = createServer((request, response) => {
		request.resume();
		request.on("end", () => {
			authorizations.push(request.headers.authorization);
			response.writeHead(200, { "content-type": "application/json" });
			response.end(
				JSON.stringify({
					query: "tide pools",
					response_time: 0.2,
					results: [
						{ title: "Tide tables 2026", url: "https://tides.example/2026", content: "Daily high and low tides.", score: 0.9, published_date: "2026-01-02" },
					],
				}),
			);
		});
	});
	await new Promise<void>((resolve) => tavily.listen(0, "127.0.0.1", resolve));
	h = await launchApp("web", { env: { OPENBOT_TAVILY_BASE_URL: `http://127.0.0.1:${(tavily.address() as AddressInfo).port}` } });
	await h.page().getByRole("textbox", { name: "Message OpenBot" }).waitFor();
}, 60_000);

afterAll(async () => {
	await h?.close();
	await new Promise<void>((resolve) => tavily.close(() => resolve()));
});

describe("Web search", () => {
	it("stores the Tavily key in Settings", async () => {
		const page = h.page();
		await page.getByRole("button", { name: /^Settings/ }).click();
		const section = page.locator(".settings-group", { has: page.getByRole("heading", { name: "Web search" }) });
		await section.getByText("Not set up").waitFor();
		await section.getByLabel("Tavily API key").fill(KEY);
		await section.getByRole("button", { name: "Save key" }).click();
		await section.getByText("Key stored").waitFor();
		expect(await section.getByLabel("Tavily API key").inputValue()).toBe("");
		// The search key is not a model provider.
		expect(await page.getByLabel("Provider").locator("option").allTextContents()).not.toContain("search:tavily");
		await h.shot("01-web-search-settings");
	});

	it("shows a search row with the results", async () => {
		const page = h.page();
		await createBot(h, "Researcher");
		h.model.script({ tool: "web_search", args: { query: "tide pools", count: 3 } }, { text: "Found the 2026 tide tables." });
		await h.send("When are the low tides?");
		const row = page.locator(".tool-card.tool-succeeded", { hasText: "Searched" });
		await row.waitFor();
		expect(await row.locator(".tool-subject").textContent()).toBe("tide pools");
		await row.locator("summary").click();
		await expect.poll(() => row.locator(".tool-output").textContent()).toContain("1. Tide tables 2026");
		expect(await row.locator(".tool-output").textContent()).toContain("URL: https://tides.example/2026");
		await page.getByText("Found the 2026 tide tables.").waitFor();
		expect(authorizations).toEqual([`Bearer ${KEY}`]);
		expect(JSON.stringify(h.model.requests.at(-1)?.messages.at(-1))).toContain("https://tides.example/2026");
		await h.shot("02-web-search-row");
	});

	it("tells the Bot to set up search after the key is removed", async () => {
		const page = h.page();
		await page.getByRole("button", { name: /^Settings/ }).click();
		const section = page.locator(".settings-group", { has: page.getByRole("heading", { name: "Web search" }) });
		await section.getByRole("button", { name: "Remove" }).click();
		await section.getByText("Not set up").waitFor();

		await page.locator(".bot-row", { hasText: "Researcher" }).click();
		h.model.script({ tool: "web_search", args: { query: "tide pools" } }, { text: "Search is not set up yet." });
		await h.send("Search again");
		const failed = page.locator(".tool-card.tool-failed", { hasText: "Searched" });
		await failed.waitFor();
		expect(await failed.locator(".tool-output").textContent()).toContain("Web search is not set up: add a Tavily API key in Settings");
		expect(authorizations).toHaveLength(1);
		await h.shot("03-web-search-not-set-up");
	});
});
