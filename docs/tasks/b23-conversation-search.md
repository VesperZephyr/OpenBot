# B23: Local Conversation Search and Unread Filtering

Status: in progress
Branch: task/b23-conversation-search
Depends on: B22 (PR #19), B21
Architecture: Sections 5.1, 6.1, 7.1, 8

## Goal

Find earlier private and public group messages from the conversation list, jump to the matching message, and focus the list on conversations with unread replies. Search is local, read-only, and independent of model inference.

## Scope

In: literal case-insensitive history search with Chinese support, bounded snippets and pagination, message-location navigation, unread-only filtering composed with search, keyboard access, English and Simplified Chinese, restart reconstruction and race-safe results.

Out: semantic/embedding search, files/attachments/tool output/reasoning/memory search, regex/query syntax, search-history persistence, manual mark-unread, group pin/hide, transcript virtualization and agent tools. These need separate specs.

## Reference and design

The official [Grok Bot chat documentation](https://docs.x.ai/grok-bot/chat-and-collaboration), reviewed 2026-10-18, documents cross-conversation message search, Cmd/Ctrl+K and jumping to matching history. [D2](d2-grok-ui-research.md) records prior installed-client inspection. This does not establish Grok's search backend or exact unread-filter semantics; the contracts below are OpenBot decisions.

Keep the existing quiet sidebar and system font, neutral surfaces (`#f5f5f5`, `#ececee`, dark equivalents), muted secondary text (`#66666f`) and blue unread signal (`#2563eb`). Add a compact All / Unread segmented control below search. For a nonblank query, retain matching conversation-name/role/objective rows and add a Messages section with compact result buttons: conversation name, sender/time, and a two-line excerpt with highlighted match. Search is available through the existing input and Cmd/Ctrl+K. Escape clears the query. Tab/Shift+Tab and Enter reach/activate results; IME composition must not clear or submit prematurely.

Unread means conversations with `unreadCount > 0`, not individual unread messages. Applying it to history search can return an older matching message from a currently unread conversation. Core and pinned ordering remains protected among eligible rows. Hidden Bots are excluded unless the existing Show hidden control is enabled; a query continues to reveal matching hidden conversation-name rows as before, and includes their history. Deleted Bots are excluded; dissolved groups remain searchable. Explain empty filters/searches; distinguish loading, empty and recoverable error states. Search/filtering never closes the selected conversation or discards its draft.

Selecting a message keeps the query/results available, opens its private/group conversation, centers the matching message and visibly highlights the row. A persistent Viewing a search result cue and Jump to latest action make the historical position clear. While a search target is active, do not auto-acknowledge unread, even if a short transcript puts the target near its end. Jump to latest or ordinary conversation navigation exits this mode; explicit Mark as read remains available. Same-conversation and repeated-result navigation must work. If a result disappears, show a localized unavailable state instead of scrolling to an unrelated message.

## Contracts

```ts
type ConversationSearchHit = {
  conversationKey: ConversationKey;
  messageId: string;
  senderId: string;
  at: number;
  snippet: string; // <= 180 Unicode code points, plain text
  matchStart: number; // UTF-16 offsets into snippet, for safe React <mark>
  matchEnd: number;
};
// conversations.search:
// params { query: string, unreadOnly?: boolean, includeHidden?: boolean, cursor?: string }
// result { items: ConversationSearchHit[], nextCursor?: string }
```

Query is trimmed, internal whitespace collapsed, at most 200 UTF-16 code units. Matching uses the entire query as a literal substring, Unicode case-insensitive, with normalized whitespace in message text. One-character/CJK queries work. Punctuation is literal; never interpret regex or SQL. Empty/whitespace query returns no history results and avoids scanning. Search only committed nonempty user/assistant text and public group user/reply/result posts; exclude live fragments, thinking, tools, errors without text, queued input, delegation/transfer receipts and private group-channel execution context. Use stable transcript/post IDs, including history retained across reset/compaction. Search beyond the latest preview and beyond the first 160 characters of a message.

The runtime adapter owns a derived in-memory corpus of committed message text, keyed by conversation and stable message ID. Durable transcripts remain the only source of truth; no second persistent copy, provider request or search log is added. Direct observers populate it before publishing snapshots. Group post/publication populate it only after successful commits; startup backfill reconstructs all group history. Append-only counts ignore stale projections and avoid re-normalizing unchanged messages on token updates. Host startup completes this reconstruction before accepting requests. Removing/hiding identities affects eligibility immediately through current Host records; querying never fetches conversation snapshots or group histories and never changes read cursors.

For this single-user MVP, search scans the normalized local corpus with literal matching and retains at most 31 ordered candidates (30 results plus a continuation probe). Newest message time first, then stable conversation/message IDs as deterministic ties. Cursor is a bounded opaque token bound to normalized query and filter values plus the last sort key; reject malformed or mismatched cursors with a fixed content-free error. Newer messages inserted between pages do not duplicate older results. Eligibility may change between pages; current state always wins. Avoid returning full history over IPC. Add a 10,000-message fixture proving bounded pages and no transcript reads; use a generous timing guard as regression detection, not a universal latency guarantee. A persistent inverted index/worker is a follow-up if large local histories require it.

Renderer debounces input by 200 ms, ignores stale/out-of-order responses, and clears stale pages when query/filter or roster summaries change. Load more uses only the current result cursor; changing a query or closing the filter cannot append an older request. Query, filter, cursor and jump target are transient renderer state, never model input or persisted search history. Text/snippets use React text nodes, not HTML injection. Existing drafts remain independently local.

## Steps

1. Add public search types/schema/allowlist; add the runtime corpus and immutable direct/group projection hooks, startup reconstruction, bounded snippets and stable pagination.
2. Add the Host search handler with current identity/unread eligibility, fixed validation errors and content-free diagnostics. Keep Pi/public protocol boundaries intact.
3. Add All/Unread controls and local history results with debounce, pagination and race guards; wire exact message navigation and read suppression into the shared timeline; translate all new states.
4. Cover query semantics, replay, restart, privacy exclusions, hidden/deleted/dissolved lifecycle, cursors and large-history behavior in unit/Host tests. Extend background e2e for English/Chinese search, unread composition, keyboard/IME, pagination/races, result jumps and draft/read preservation.
5. Run full check and background e2e, inspect light/dark minimum-size screenshots, explore the isolated desktop with agent-browser, verify private/group history using the real configured model, restart it, then stop it and remove copied model configuration.

## Acceptance

1. Runtime/Host: literal English case-insensitive and Chinese search finds old full message content across new topics/compaction, excluding tools/reasoning/group execution internals; stable IDs, replay and restart preserve results.
2. Runtime/Host: bounded snippets/highlights/pages, deterministic ties and cursor validation; 10,000-message corpus with no per-query history/snapshot fetch; no query/snippet in audit records or extra model requests.
3. Host: unread filtering is conversation-level; hidden/deleted identities and dissolved group history follow the stated rules; search cannot mark anything read.
4. Background e2e: sidebar search and All/Unread combine, clear/loading/error/empty states, bilingual layout, keyboard/IME, paging and stale-response protection; current drafts and selected chat remain intact.
5. Background e2e: private/group result click centers/highlights the exact stable message; repeated and same-chat jumps work; search/history viewing retains unread even with simulated foreground; Jump to latest restores ordinary reading.
6. Full `pnpm run check`, background `pnpm run e2e`, inspected screenshots and isolated real-model desktop search/unread/restart observations, reported separately from scripted tests.

## Risks

The derived corpus uses memory proportional to committed text and rebuilds on Host startup; it avoids repeated transcript reads per keystroke but does not promise constant-time search. Future purge/truncation requires explicit corpus invalidation. Search results may race with deletion or new replies: validate current identity eligibility, keep stable targets, and never infer read state from a search result. Searches and excerpts are private local data and must stay out of logs and Git.

## Open questions

Scope and verification authorized by the owner on 2026-10-18. The unread filter applies at conversation level; the UI labels it explicitly. B23 is stacked on B22 until PR #19 merges.
