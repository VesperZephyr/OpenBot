# B22: Conversation List Previews and Unread State

Status: in progress
Branch: task/b22-conversation-list
Depends on: B21, B13c
Architecture: Sections 5.1, 6.5, 7.1, 8

## Goal

Let the conversation list answer what happened and what still needs reading, consistently for private chats and groups. Previews and reading progress survive Host/desktop restart and never require fetching every conversation from the renderer.

## Scope

In: compact Host-owned message summaries, local durable read cursors, private/group previews with sender and timestamp, unread counts, recent-message ordering within existing sections, explicit Mark as read, foreground/bottom-aware automatic reading, English and Simplified Chinese.

Out: full-text search, unread-only filters, manual mark-unread, group pin/hide, notification redesign, transcript virtualization, attachments, changed agent routing/tools/permissions and cloud synchronization.

## Reference and visual design

[D2](d2-grok-ui-research.md) records inspected Grok Bot 0.71.2 client behavior: roster rows combine local drafts, latest-entry previews and attention data. Rechecked official [chat documentation](https://docs.x.ai/grok-bot/chat-and-collaboration) and [settings documentation](https://docs.x.ai/grok-bot/settings-and-notifications) on 2026-10-18. They establish the messaging/sidebar interaction and distinct attention, working and unread states; they do not establish Grok's persistence or exact read-cursor implementation. The cursor and migration rules below are OpenBot decisions.

Retain B21's quiet neutral roster, system typography, 260 px width (220 px at small sizes), and light/dark tokens. A compact blue count beside the preview is the attention signal; unread names have stronger weight. Preserve the count when a draft or activity label occupies the preview. Show one secondary line, never raw Markdown or tool output. A small localized time sits beside the name. Core remains first; pinned Bots retain their section. Other rows sort by latest committed message time, then creation time and ID; reading, drafts and streamed tokens do not reorder rows. Groups keep their own section, including dissolved history.

Secondary-line priority: actionable Bot attention / working / queued state, local draft, latest message, existing role/member-count fallback. Unread itself does not replace the latest message. Prefix user messages with localized You; group replies identify their sender, including a localized deleted-Bot fallback. A draft is local renderer state and never enters the Host summary.

## Data and protocol contracts

```ts
type ConversationKey = `bot:${string}` | `group:${string}`;
type ConversationPreview = { id: string; senderId: string; text: string; at: number };
type ConversationSummary = {
  conversationKey: ConversationKey;
  latest?: ConversationPreview;
  incomingCount: number;
  readThrough: number;
  unreadCount: number;
};
// Renderer methods:
// conversations.list: {} -> ConversationSummary[]
// conversations.markRead: { conversationKey, through: number } -> null
// Direct ConversationSnapshot and GroupSnapshot add optional readCursor: number.
```

`openbot.conversation-index` is a version-1 session document owned by the Host's runtime adapter, stored beside the existing local Pi documents. Each key stores messageCount, incomingCount, readThrough and latest (bounded plain text, at most 160 Unicode code points). The index is presentation metadata, never a prompt section. Deleted Bots are excluded from list/read APIs; hidden Bots retain their records. Dissolved groups retain their preview and can still be read. Bot and group raw IDs cannot collide.

Only committed nonempty user/assistant text messages count for direct chat; only ordinary public user/Bot posts and result posts count for groups. Thinking, tools, errors without text, streaming fragments, system events, delegation/transfer receipts, drafts and queued inputs not yet in the transcript do not count. An assistant text message accompanying a tool call counts once when committed. A result posted in a group affects that group only; private and group-channel transcripts stay separate. One message contributes one incoming ordinal regardless of token count. Outgoing user messages update the preview without advancing readThrough or incomingCount.

Direct snapshots already include retained history across reset/compaction. Derive message/incoming counts from that ordered immutable history and persist a newer projection before publishing the snapshot. Ignore older projections; no writes for unchanged counts. A crash before projection catches up from history on startup. Group index updates commit atomically with public message publication and its receipt; handoff-only records leave the summary unchanged. Replayed submission/publication cannot increment a count twice.

New conversations initialize an empty record. On first upgrade, histories without an index record are backfilled with their latest preview and existing incoming messages marked read, avoiding a flood of historical unread counts. Subsequent restarts retain the read cursor and discover any committed messages missing from the index.

`conversations.list` reads the bounded index and current identities only, not full snapshots or group histories. Existing `bots.changed` and `groups.changed` events invalidate summaries; emit for new committed messages and successful read advancement, not each streamed token. Renderer summary refreshes are serialized/coalesced so a late response cannot roll back a newer read state. Existing BotActivity remains compatible: actionable/working/queued state wins, otherwise durable unreadCount determines unread versus idle. Unread counts do not become approval counts or native notifications.

## Reading contract

A snapshot's readCursor counts only incoming messages represented by that snapshot, never a separately fetched newer list. Mark-read validates the conversation and a safe nonnegative integer no greater than the current incoming count, then advances readThrough monotonically. Older/repeated acknowledgements are harmless; a delayed acknowledgement cannot clear a newer reply. An arbitrary future cursor is rejected.

Opening/subscribing/fetching a conversation does not mark it read. Auto-read requires the selected rendered conversation, a visible focused document, no blocking modal, and a timeline following within 80 CSS px of the bottom for 400 ms. Scroll/focus/visibility changes cancel or reevaluate the timer. Recheck these conditions at dispatch and use the rendered snapshot's cursor. Reading older history, background/hidden windows, Settings, and roster filtering never clear unread. Jump to latest can resume automatic reading. A header Mark as read button explicitly acknowledges the displayed snapshot even if the user has not scrolled to its end; it does not acknowledge future replies.

## Steps

1. Add protocol types, schemas and preload allowlist. Add runtime index storage/projection with creation, migration and group publication hooks; do not modify Pi vendor code.
2. Add lightweight Host list/mark-read handlers and durable BotActivity fallback. Include readCursor in rendered snapshots; keep routing and native attention behavior unchanged.
3. Integrate coalesced summaries into the renderer, shared row preview/time/count, stable section ordering, and snapshot-bound automatic/explicit reading.
4. Add bilingual copy and focused invariant tests. Extend background e2e for preview, unread, restart, draft/working precedence, foreground/scroll rules, group isolation and stale cursor races.
5. Run full check/e2e and inspect English/Chinese light/dark minimum-size screenshots. Explore an isolated hidden desktop with agent-browser and a real configured model, then stop it and remove copied configuration.

## Acceptance

1. Runtime/Host tests: new private and public group text produces bounded plain-text previews with sender/time; excludes thinking/tool/coordination noise; duplicate receipts and replay preserve counts. Group replies never affect private summaries.
2. Runtime/Host tests: read cursor survives reopen, old acknowledgement leaves newer messages unread, future/invalid cursors and deleted identities are rejected, reset/compaction preserve counts, legacy backfill does not mark old history unread.
3. Performance regression: list reads no conversation snapshots/posts; unchanged/stream-only projection causes no new index writes or roster invalidation. Bounded row payload independent of history length.
4. Background e2e: private/group latest previews and unread badges survive desktop restart; drafts/activity do not erase counts; localized You/deleted sender, timestamps, long names and 99+ badge remain usable without horizontal overflow. Core/pinned ordering remains protected; reads/drafts do not change recency.
5. Background e2e: merely opening hidden desktop does not clear unread; simulated document visibility/focus in the isolated renderer verifies bottom auto-read, history preservation, Jump to latest, explicit Mark as read and snapshot-bound acknowledgement. No OS window is shown or focused for this simulation.
6. Full `pnpm run check` and background `pnpm run e2e`; inspect screenshots; record actual-model private and group reply/preview/unread/restart observations separately from scripted tests. Do not claim all-provider or packaged OS-permission coverage.

## Risks

A renderer read based on list state could acknowledge a message it has not rendered; always use the snapshot cursor. Stale snapshot projections must not overwrite the index. A session-document write can notify observers again; unchanged projections must be no-ops. Preview text is user data: keep it local, out of diagnostics and Git, and send it to no extra service. Existing source history retention is required by the ordinal projection; future purge/truncation requires a separate cursor migration.

## Open questions

None. Scope and verification are authorized by the owner on 2026-10-18.
