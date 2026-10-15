/**
 * `web_search`: a Host tool that queries the configured search provider. The tool is always offered; without a stored
 * key it fails with a message telling the user where to add one. The key is read on every call, so saving or removing
 * it in Settings applies without a restart.
 */
import type { ToolOutcome } from "@openbot/protocol";
import type { SecretStore } from "./index.ts";

export type SearchResult = {
	readonly title: string;
	readonly url: string;
	readonly snippet: string;
	/** Publication or last-update date as reported by the provider. */
	readonly published?: string;
};

export interface SearchProvider {
	/** Shown to the model in failure messages. */
	readonly name: string;
	search(query: string, count: number, signal: AbortSignal): Promise<readonly SearchResult[]>;
}

/** Secret store provider ID of the Tavily API key. `search:` IDs never appear among model providers. */
export const TAVILY_PROVIDER_ID = "search:tavily";
export const SEARCH_PROVIDER_PREFIX = "search:";
export const WEB_SEARCH_NOT_CONFIGURED = "Web search is not set up: add a Tavily API key in Settings";

const DEFAULT_TAVILY_BASE_URL = "https://api.tavily.com";
const DEFAULT_COUNT = 5;
const MAX_COUNT = 10;
const TIMEOUT_MS = 30_000;

/** Tavily Search (`POST /search`, Bearer key). Errors carry Tavily's own reason. */
export class TavilySearch implements SearchProvider {
	readonly name = "Tavily";
	readonly #apiKey: string;
	readonly #baseUrl: string;

	constructor(options: { readonly apiKey: string; readonly baseUrl?: string }) {
		this.#apiKey = options.apiKey;
		this.#baseUrl = (options.baseUrl ?? DEFAULT_TAVILY_BASE_URL).replace(/\/+$/, "");
	}

	async search(query: string, count: number, signal: AbortSignal): Promise<readonly SearchResult[]> {
		const response = await fetch(`${this.#baseUrl}/search`, {
			method: "POST",
			signal,
			headers: { authorization: `Bearer ${this.#apiKey}`, "content-type": "application/json" },
			body: JSON.stringify({ query, max_results: count, search_depth: "basic", include_published_date: true }),
		});
		// Every field is checked before use: the response is outside our control.
		const body = ((await response.json().catch(() => undefined)) ?? {}) as TavilyResponse;
		if (!response.ok) throw new Error(`${response.status} ${tavilyError(body) ?? response.statusText}`);
		const results = Array.isArray(body.results) ? (body.results as TavilyResult[]) : [];
		return results.flatMap((result): SearchResult[] => {
			if (typeof result?.url !== "string") return [];
			const published = typeof result.published_date === "string" && result.published_date !== "" ? result.published_date : undefined;
			return [
				{
					title: typeof result.title === "string" ? result.title : result.url,
					url: result.url,
					snippet: typeof result.content === "string" ? result.content : "",
					...(published === undefined ? {} : { published }),
				},
			];
		});
	}
}

export type WebSearchOptions = {
	readonly secrets: SecretStore;
	/** Tavily endpoint; the Host passes `OPENBOT_TAVILY_BASE_URL` so tests can point it at a local fake. */
	readonly tavilyBaseUrl?: string;
};

/** A web Host tool: Tool Router's Host tool handler shape. */
export type WebToolHandler = (args: Readonly<Record<string, unknown>>, signal: AbortSignal) => Promise<ToolOutcome>;

/** The `web_search` Host tool handler. */
export function createWebSearch(options: WebSearchOptions): WebToolHandler {
	return async (args, signal) => {
		const query = typeof args.query === "string" ? args.query.trim() : "";
		if (query === "") return { status: "failed", output: "query is empty" };
		const count = typeof args.count === "number" && Number.isInteger(args.count) ? Math.min(Math.max(args.count, 1), MAX_COUNT) : DEFAULT_COUNT;
		const apiKey = await options.secrets.getApiKey(TAVILY_PROVIDER_ID);
		if (apiKey === undefined || apiKey === "") return { status: "failed", output: WEB_SEARCH_NOT_CONFIGURED };
		const provider = new TavilySearch({ apiKey, ...(options.tavilyBaseUrl === undefined ? {} : { baseUrl: options.tavilyBaseUrl }) });
		let results: readonly SearchResult[];
		try {
			results = await provider.search(query, count, AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]));
		} catch (error) {
			if (signal.aborted) throw error;
			return { status: "failed", output: `${provider.name} search failed: ${error instanceof Error ? error.message : String(error)}` };
		}
		return { status: "succeeded", output: formatResults(query, results) };
	};
}

/** Numbered results for the model: title, URL, date when known, and snippet. */
export function formatResults(query: string, results: readonly SearchResult[]): string {
	if (results.length === 0) return `No results for "${query}". A miss does not prove absence; try other words.`;
	const lines = results.map((result, index) => {
		const head = [`${index + 1}. ${result.title}`, `   URL: ${result.url}`];
		if (result.published !== undefined) head.push(`   Published: ${result.published}`);
		const snippet = result.snippet.replace(/\s+/g, " ").trim();
		if (snippet !== "") head.push(`   ${snippet}`);
		return head.join("\n");
	});
	return `Results for "${query}":\n\n${lines.join("\n\n")}`;
}

/** Tavily's response and error bodies as documented; fields stay `unknown` until checked. */
type TavilyResult = { readonly url?: unknown; readonly title?: unknown; readonly content?: unknown; readonly published_date?: unknown } | null;
type TavilyResponse = { readonly results?: unknown; readonly detail?: unknown; readonly error?: unknown };

function tavilyError(body: TavilyResponse): string | undefined {
	const detail = body.detail as { readonly error?: unknown } | readonly { readonly msg?: unknown }[] | string | null | undefined;
	if (typeof detail === "string") return detail;
	if (Array.isArray(detail)) return detail.map((entry) => String(entry?.msg)).join("; ");
	if (typeof detail === "object" && detail !== null && "error" in detail && typeof detail.error === "string") return detail.error;
	return typeof body.error === "string" ? body.error : undefined;
}
