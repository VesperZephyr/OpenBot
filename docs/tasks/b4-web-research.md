# B4: Web Research

Status: done (Phase 1 MVP merged; see task index)
Branch: task/b4-web-research
Depends on: none
Architecture: Sections 5.1 (Host tools `web_search`, `web_fetch`), 5.9 (secrets in the Keychain)

## Goal

Let a Bot research a question on the web: find sources with `web_search`, read them with `web_fetch` as Markdown that keeps links, and know when a page could not really be read (login wall, bot check, JavaScript shell, missing page) instead of summarizing an error page. This is MVP acceptance item 3 ("researches a question, cites the pages it opened").

## Scope

In:
- `web_search` Host tool behind a `SearchProvider` port, with a Tavily adapter. Key stored through `credentials.set` under provider ID `search:tavily`.
- `web_fetch` rewritten: Readability main content, Turndown Markdown, absolute links, `offset` paging, a `retrieval_outcome` label line.
- `RedactedSettings.webSearch` and a **Web search** section in desktop Settings.
- Unit tests against a local fake Tavily server and local HTML fixtures; e2e suite `e2e/web.e2e.ts`.

Out:
- Prompt guidance for research (search misses, citing opened pages, primary sources): B6 owns the system prompt.
- A second search provider (Brave): only when someone needs it.
- Browser automation and pages that need JavaScript: Phase 3 managed browser.

## Design

**`web_search` is always offered.** The backlog proposed hiding the tool without a key; the cross-batch contract decided instead that it is always registered and fails with an actionable message ("Web search is not set up: add a Tavily API key in Settings"). The tool list then never changes with settings, which keeps Pi's prompt cache stable and lets the Bot tell the user what to do.

**Provider.** Tavily: built for agents, clean snippets, published dates, free tier. The handler reads the key from the `SecretStore` on every call, so saving or removing it in Settings applies without a restart. Base URL `https://api.tavily.com`, overridable by `OPENBOT_TAVILY_BASE_URL` (read by the Host; the desktop passes it through) so tests use a local fake.

**DOM for Readability.** `linkedom` over `jsdom`: Readability only needs a standards-shaped DOM, linkedom is a fraction of jsdom's size and start-up time, and it parses the fixtures correctly. Links and image sources are made absolute against the final URL before extraction, because linkedom has no base URL.

**Retrieval outcome.** Classified on the raw HTML before extraction, after studying MCode `local-web-fetch-client.ts`: `not_found` (404/410), `access_challenge` (a bot-check marker such as Cloudflare, reCAPTCHA, hCaptcha, Turnstile, DataDome, with a challenge status or wording and little other text), `auth_required` (401, or a form with a password field and little text outside forms), `dynamic_page` (2xx, scripts, and an essentially empty body), `http_error` (any other non-2xx; added so a server error is never labelled usable), else `usable_content`. Only `usable_content` succeeds; the others fail with a hint telling the model what to do next.

**Paging.** Output is cut at 40,000 characters of Markdown, preferably at a line break, with a hint naming the `offset` to continue. Re-fetching with `offset` is stateless.

**Private-address block.** Unchanged and still applied to every hop of a redirect chain. `createWebFetch({ isBlockedHost })` lets unit tests serve fixtures from `127.0.0.1`; the Host composes the default (`createWebFetch()`), and no environment variable can change it.

## Contracts

```ts
// packages/server-core/src/web-search.ts
export type SearchResult = { readonly title: string; readonly url: string; readonly snippet: string; readonly published?: string };
export interface SearchProvider {
	readonly name: string;
	search(query: string, count: number, signal: AbortSignal): Promise<readonly SearchResult[]>;
}
export const TAVILY_PROVIDER_ID = "search:tavily";

// packages/server-core SecretStore port gains:
getApiKey(providerId: string): Promise<string | undefined>;

// packages/protocol RedactedSettings gains:
readonly webSearch: { readonly provider: "tavily"; readonly configured: boolean };
```

Tool arguments: `web_search { query: string; count?: 1..10 (default 5) }`, `web_fetch { url: string; offset?: integer ≥ 0 }`.

`web_fetch` output header:

```
URL: <final URL after redirects>
Status: <HTTP status>
Title: <page title, when found>
retrieval_outcome: usable_content | not_found | access_challenge | auth_required | dynamic_page | http_error
```

Provider IDs starting with `search:` never appear in model provider listings (`settings.providers`, `models.list`, pi-ai `CredentialStore.list`).

## Steps

1. `web-search.ts` (port, Tavily adapter, handler), `SecretStore.getApiKey` in server-core, `KeychainCredentials`, `MemorySecretStore`; catalog entry; compose in `apps/local-server/src/tools.ts`. Check: `packages/server-core/test/web-search.test.ts`.
2. `web-fetch.ts` rewrite with outcomes and paging. Check: `packages/server-core/test/web-fetch.test.ts`.
3. `RedactedSettings.webSearch`, `search:*` filtering, desktop `WebSearchSettings.tsx`, tool row verb. Check: `pnpm run typecheck`.
4. `e2e/web.e2e.ts`. Check: `pnpm run e2e`.

## Acceptance

1. Without a key, `web_search` fails with the actionable message and never calls the provider — `web-search.test.ts` "fails with an actionable message without a key and never calls the provider".
2. With a key, the request carries `Authorization: Bearer <key>` and the model sees numbered results with title, URL, date, and snippet — "sends the stored key as a Bearer token and numbers the results"; a key saved or removed later applies without a restart — "uses a key saved after the tool was created and stops after it is removed".
3. Tavily errors (bad key, rate limit) come back as failed outcomes with Tavily's reason — "reports provider errors with Tavily's reason".
4. Each retrieval outcome is labelled from a fixture page served locally — `web-fetch.test.ts` "labels %s as %s and fails" and "returns the main content as Markdown with absolute links".
5. Long pages page through `offset` with every paragraph returned exactly once — "pages long documents through offset without losing text".
6. Every redirect hop goes through the host check — "refuses a blocked host reached through a redirect"; the default check refuses loopback and private addresses — "refuses loopback and private addresses by default".
7. `settings.webSearch` reflects the stored key and `search:*` never appears among model providers — `host-service.test.ts` "reports the search key as web search, never as a model provider".
8. Storing the key in Settings, a scripted `web_search` call shows a **Searched** row with the result; after **Remove** the call fails with the set-up message — `e2e/web.e2e.ts`.

## Risks

- Heuristic outcomes misfire on unusual pages. The label is advisory and the Markdown is still returned for `usable_content`; tune markers with real pages.
- Readability drops content on pages without a clear main region; the handler falls back to the whole body.
- Tavily's `include_published_date` is beta; when absent the date line is omitted.

## Open questions

None.
