import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createWebSearch, MemorySecretStore, TAVILY_PROVIDER_ID, WEB_SEARCH_NOT_CONFIGURED, type WebToolHandler } from "../src/index.ts";

type Received = { readonly headers: IncomingHttpHeaders; readonly body: Record<string, unknown> };

/** A fake Tavily `POST /search`: `tvly-good` is the only valid key; the query "busy" is rate limited. */
let server: Server;
let baseUrl: string;
let received: Received[];

beforeAll(async () => {
	server = createServer((request, response) => {
		let text = "";
		request.on("data", (chunk) => (text += chunk));
		request.on("end", () => {
			const body = JSON.parse(text) as Record<string, unknown>;
			received.push({ headers: request.headers, body });
			const reply = (status: number, value: unknown) => {
				response.writeHead(status, { "content-type": "application/json" });
				response.end(JSON.stringify(value));
			};
			if (request.method !== "POST" || request.url !== "/search") return reply(404, { detail: { error: "Not found" } });
			if (request.headers.authorization !== "Bearer tvly-good") return reply(401, { detail: { error: "Unauthorized: missing or invalid API key." } });
			if (body.query === "busy") return reply(429, { detail: { error: "Your request has been blocked due to excessive requests." } });
			if (body.query === "nothing") return reply(200, { query: body.query, results: [], response_time: 0.1 });
			reply(200, {
				query: body.query,
				response_time: 0.4,
				results: [
					{ title: "Tide tables 2026", url: "https://tides.example/2026", content: "Daily  high and\nlow tides.", score: 0.9, published_date: "2026-01-02" },
					{ title: "Tide pool etiquette", url: "https://example.org/etiquette", content: "Step on bare rock only.", score: 0.7, published_date: null },
				],
			});
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

let secrets: MemorySecretStore;
let search: WebToolHandler;
const signal = new AbortController().signal;

beforeEach(() => {
	received = [];
	secrets = new MemorySecretStore();
	search = createWebSearch({ secrets, tavilyBaseUrl: baseUrl });
});

describe("web_search", () => {
	it("fails with an actionable message without a key and never calls the provider", async () => {
		expect(await search({ query: "tide pools" }, signal)).toEqual({ status: "failed", output: WEB_SEARCH_NOT_CONFIGURED });
		expect(received).toEqual([]);
	});

	it("sends the stored key as a Bearer token and numbers the results", async () => {
		await secrets.setApiKey(TAVILY_PROVIDER_ID, "tvly-good");
		const outcome = await search({ query: "tide pools", count: 2 }, signal);
		expect(received[0]?.headers.authorization).toBe("Bearer tvly-good");
		expect(received[0]?.body).toMatchObject({ query: "tide pools", max_results: 2, include_published_date: true });
		expect(outcome.status).toBe("succeeded");
		expect(outcome.output).toBe(
			[
				'Results for "tide pools":',
				"",
				"1. Tide tables 2026",
				"   URL: https://tides.example/2026",
				"   Published: 2026-01-02",
				"   Daily high and low tides.",
				"",
				"2. Tide pool etiquette",
				"   URL: https://example.org/etiquette",
				"   Step on bare rock only.",
			].join("\n"),
		);
	});

	it("clamps count to the provider limit", async () => {
		await secrets.setApiKey(TAVILY_PROVIDER_ID, "tvly-good");
		await search({ query: "tide pools", count: 50 }, signal);
		expect(received[0]?.body.max_results).toBe(10);
	});

	it("uses a key saved after the tool was created and stops after it is removed", async () => {
		await secrets.setApiKey(TAVILY_PROVIDER_ID, "tvly-good");
		expect((await search({ query: "tide pools" }, signal)).status).toBe("succeeded");
		await secrets.deleteApiKey(TAVILY_PROVIDER_ID);
		expect((await search({ query: "tide pools" }, signal)).output).toBe(WEB_SEARCH_NOT_CONFIGURED);
	});

	it("reports provider errors with Tavily's reason", async () => {
		await secrets.setApiKey(TAVILY_PROVIDER_ID, "tvly-wrong");
		expect(await search({ query: "tide pools" }, signal)).toEqual({
			status: "failed",
			output: "Tavily search failed: 401 Unauthorized: missing or invalid API key.",
		});
		await secrets.setApiKey(TAVILY_PROVIDER_ID, "tvly-good");
		expect((await search({ query: "busy" }, signal)).output).toBe(
			"Tavily search failed: 429 Your request has been blocked due to excessive requests.",
		);
	});

	it("says a miss does not prove absence", async () => {
		await secrets.setApiKey(TAVILY_PROVIDER_ID, "tvly-good");
		const outcome = await search({ query: "nothing" }, signal);
		expect(outcome).toEqual({ status: "succeeded", output: 'No results for "nothing". A miss does not prove absence; try other words.' });
	});
});
