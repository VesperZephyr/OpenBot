# B14c: Bounded history reading and persistent search

Status: in review (#64); implementation and automated acceptance complete
Branch: task/b14c-history-scaling; pull request target: main
Depends on: B14a, B22/B23, B24/B25, B14d, D8/D9 (all merged)
Architecture: sections 4.2, 6.1, 6.4, 7.1 and 8.3
Design baseline: `838b032` on main, verified October 28, 2026

## Goal

Keep opening, reading and searching retained private and group conversations responsive at 10,000 messages per conversation. Read old messages without downloading or rendering the entire transcript. Preserve exact message links, tool evidence, drafts, unread positions, streaming, approvals and result readers.

## Scope

In: bounded timeline queries, a rebuildable persistent display/search projection, incremental projection updates, bounded renderer caches, virtualized private/group timelines, exact-anchor navigation, backup/restore cache invalidation and deterministic performance acceptance.

Out: semantic/embedding search, new query syntax, group pin/hide, manual unread, data deletion/retention changes, new model tools, model-context changes, Pi synchronization, canonical group-storage migration, Bot templates, updates and Phase 3. B4a/#62 remains independent; I7/#63 is merged. Neither web batch is a prerequisite for local history work.

This batch bounds OpenBot's additional history projections, transport and renderer work. It does not claim constant total Host memory: Pi retains the active model context, and `GroupsDoc` currently stores canonical group posts and delivery records in a session document. Changing that authoritative layout needs a separate migration spec if measurements show it dominates the agreed fixture. Do not silently move canonical posts into a disposable index.

## Baseline and design

The pre-implementation costs were cumulative:

- `agent-runtime/src/index.ts`: `#earlierEntries` drains all pages before the active head into `#history`; `#project` combines them with the active view. Startup observes every live Bot.
- `agent-runtime/src/conversation-search.ts`: the entire normalized message corpus lives in a `Map`; every search scans it on the Host thread. `committedMessages` copies a whole conversation even for B24's bounded context read.
- `agent-runtime/src/groups.ts`: `history`, `posts` and `indexHistory` derive full arrays from `GroupsDoc`. Group task snapshots can also embed private execution transcripts.
- `server-core/src/index.ts`: observer state retains snapshots and walks tool items for settlement; presentation must not become the source of execution completion.
- Desktop `store.ts`, `ConversationUI.tsx` and `Groups.tsx`: snapshots accumulate by conversation and scroll/search lookup assumes every row is mounted.

Use an OpenBot-owned SQLite sidecar under `<data>/cache/history-v1.sqlite`. Pi and the existing OpenBot documents remain authoritative. Only `agent-runtime` reads Pi and maps entries to display records. A worker thread owned by that adapter owns the sidecar, indexing and search. The worker never opens `openbot.sqlite`, calls model tools or starts an executor. Host composition passes the cache path and closes the worker before releasing the Host lock. Desktop still imports only protocol.

Use indexed keyset queries for timeline/anchor lookup. Search preserves today's literal JavaScript Unicode case-insensitive matching and normalization. Scan ordered candidate rows in bounded worker batches; do not replace it with SQLite `LIKE`, token-only FTS or a new tokenizer, which would change Chinese, substring and Unicode behavior. This first persistent search has linear worst-case search CPU, bounded working memory and no synchronous full-corpus scan on the Host event loop. Record that limit; a later accelerator must prove identical results.

## Contracts

### 1. Derived storage and incremental projection

The sidecar has `PRAGMA user_version = 1` and these logical tables. Names may vary; keys, fields and invariants may not:

| Table | Required content |
| --- | --- |
| `meta` | Schema/projector version, random build generation, source database identity, source checkpoint, ready/building state |
| `conversations` | Conversation key, source identity, last indexed source position, display revision, last display ordinal, incoming count, completeness state |
| `rows` | Primary key `(conversation_key, row_id)`, unique `(conversation_key, ordinal)`, revision, kind, source reference, bounded inline presentation, optional detail identity |
| `messages` | `(conversation_key, message_id)`, sender, timestamp, display ordinal, original public text, normalized search text, insertion sequence |
| `details` | `(conversation_key, row_id, revision, part)`, bounded UTF-8 display-text chunks for oversized rows |
| `tool_links` | Stable tool-call ID to its initiating row/source entry and latest committed result, so a later result updates the original row |

For private group and routine execution windows, use a separate internal partition `(conversationKey, selectorKind, selectorId)` in `conversations`, `rows`, `details` and `tool_links`; never add that execution text to the public group `messages` corpus. Cursor/detail tokens bind this partition and the Host rechecks the delivery-to-group or occurrence-to-Bot relationship on every read. Routine execution text is also excluded from the public message corpus.

Indexes cover conversation/ordinal, conversation/message ID, and search order `(timestamp DESC, conversation_key ASC, message_id ASC)`. Use the current code-point lexical ordering, not locale collation. Do not index thinking, tool output, injected attachment bodies or private group execution text in `messages`; reuse `directMessages`/`groupMessages` inclusion rules. Display data may contain those existing private-chat details and must stay in the appropriate private display partition. No derived row grants access.

Preserve existing transcript/message/tool/post IDs. An ordinal is a local display position, never a replacement identity or read receipt. A tool result updates the tool-call row even when call/result straddle indexing batches, a new topic or compaction. Historical completed tool records must not regress to pending after rebuild. Code Mode activity updates the existing parent row. New-topic/compaction dividers remain visible and do not delete older search text. Pending/streamed content stays separate from committed messages and cannot increase unread counts.

Backfill direct histories through Pi's public `Conversation.entries` API (existing min/max IDs and cursors), at most 256 source entries per batch. For groups, stream bounded projections from the existing canonical post array without copying the entire array into a second retained corpus. A first group hydration may still load the canonical document; report that separately. Do not read Pi tables through an independent SQLite connection.

Use existing Pi `subscribeCommits`/document observations within `agent-runtime` to flag affected identities and latest source watermarks. Its synchronous listener must not call Session APIs, block or retain publication bodies. Perform reads later on the adapter queue. Coalesce dirty identities; if the queue exceeds 256 identities, replace it with one rescan-needed marker. Limit worker transport to two outstanding batches of at most 256 records / 512 KiB each; split oversized details into chunks. Persist projected rows and their checkpoint in one sidecar transaction. Crash before that transaction replays idempotent upserts; crash after it must not duplicate rows.

Subscribe before the initial scan, fence the scan with source watermarks, then reconcile dirtied identities before marking them ready. At reopen, validate the source identity/checkpoint and catch up entries missed while the Host was stopped. Compare referenced source entry/document identity, not only file path, size or modification time. A restore, changed source identity, incompatible projector version or source rewind discards the generation and rebuilds. Where a checkpoint cannot be proven current, rebuild instead of serving it as complete.

Backfill is cancellable between batches, yields to live work and never gates Run recovery or scheduler readiness. Prioritize the selected conversation and live changes. An unindexed conversation returns an explicit building state; never return an empty completed history or an apparently exhaustive search. Corruption, disk-full and worker exit disable derived reads visibly without modifying source state, replaying tools or stopping existing Runs. Allow one worker restart and rebuild per Host process; repeated failure stays visible with an explicit Retry action.

### 2. Desktop timeline API

Add strict TypeBox-validated, desktop-only methods. No application-capability descriptor or Code Mode alias is added. Keep protocol version 1 under the existing bundled/unreleased compatibility policy, including B14d backup compatibility.

```ts
type TimelinePosition =
  | { kind: "latest" }
  | { kind: "around"; rowId: string }
  | { kind: "cursor"; cursor: string };

type TimelineRow = {
  id: string;
  ordinal: number;
  revision: number;
  content:
    | { kind: "direct"; item: TranscriptItem }
    | { kind: "group"; post: GroupPost }
    | { kind: "large"; originalKind: string; preview: string; detail: string };
};

type TimelineWindow = {
  conversationKey: ConversationKey;
  generation: string;
  revision: number;
  rows: readonly TimelineRow[]; // ascending display order
  before?: string;
  after?: string;
  atLatest: boolean;
  readCursor?: number;
};

// conversations.window
type WindowInput = {
  conversationKey: ConversationKey;
  position: TimelinePosition;
  limit?: number; // default 100; integer 1..100
};
type WindowResult =
  | { status: "ready"; window: TimelineWindow }
  | { status: "building" }
  | { status: "unavailable"; retryable: boolean };

// conversations.detail
type DetailInput = { conversationKey: ConversationKey; detail: string; part: number };
type DetailResult = { text: string; nextPart?: number; revision: number };

// conversations.indexStatus (desktop only; empty params)
type IndexStatus = { state: "ready" | "building" | "unavailable"; retryable: boolean };
// conversations.indexRetry (desktop only; empty params); returns null.
```

Bound IDs/generation/detail tokens to 2,048 characters and cursors to 4,096, using the existing conversation-key validation. Integers are nonnegative safe integers; detail `part` starts at zero. Window response JSON is at most 512 KiB including metadata; remove outer rows to fit while retaining an explicit requested anchor. An empty ready window means a verified empty conversation. Latest windows fill backward; around windows start with the anchor and alternate preceding/following rows, then return ascending order. Missing/deleted/unauthorized anchors fail with `not_found`; no fallback to latest disguised as successful navigation.

Inline content is at most 32 KiB serialized per row. A larger item becomes a visibly labelled `large` row with an 8 KiB preview and an opaque detail reference. Its full existing display fields remain accessible in ordered detail parts of at most 32 KiB UTF-8 text, split only on code-point boundaries. Detail text is a labelled plain-text rendering of the same authorized row fields, not hidden model payloads or a raw Pi entry. The detail UI retains at most three parts, supports previous/next, and labels copying as copying the displayed part. Ordinary messages retain existing formatting, copy and artifact actions. Do not silently clip text or mount a multi-megabyte Markdown tree. A row revision change invalidates old detail tokens explicitly.

Window cursors bind generation, conversation/source identity, display revision, direction and boundary ordinal. They are untrusted selectors, never authority; validate every field and current conversation access. No server-side cursor collection or open database transaction is retained. Only committed row changes advance display revision; transient streamed tokens do not. A changed display revision returns `conflict`; the renderer reopens around its stable anchor. Host replacement also invalidates in-flight responses through the existing observation generation even when a sidecar generation survives restart. Cursor failures must not change drafts or read state.

`readCursor` is present only for a complete, latest window and is the incoming ordinal of the source revision actually represented. `atLatest` alone is not permission to acknowledge. Keep the existing visible/focused/native-active/at-bottom/dwell checks; search-target mode and historical pages never auto-acknowledge. A newer sidebar count cannot advance an older rendered receipt. Explicit Mark read uses the same current snapshot-bound semantics; never substitute row ordinal or the global sidebar counter.

### 3. Live state, observation and existing consumers

Separate immutable history windows from transient Run/approval/pending/live activity. Add optional `history: "omit"` to existing `conversations.snapshot` and `groups.snapshot` params. In that mode `items`/`posts` are empty, no historical group task transcript is embedded, and only current nonterminal/attention task state is returned. Control state retains existing authority and exact approval data. Historical group execution details are loaded only on explicit selection through a bounded window scoped to that group's existing delivery; do not broaden a group member's model authority.

Extend `WindowInput` with an optional `deliveryId` only for `group:` keys. The Host resolves that delivery to its existing execution conversation and validates its group binding. Its rows use direct transcript presentation, its cursor includes the delivery identity, and it never supplies a group read cursor. No renderer-supplied internal conversation ID is accepted. This is the existing desktop execution-detail access, not a model API.

`WindowInput` also accepts optional `occurrenceId` for `bot:` keys, mutually exclusive with `deliveryId`. The Host resolves the occurrence through existing routine records and verifies its Bot/channel binding on every window and detail read; no renderer-provided channel ID is accepted. Use a distinct routine display partition, bind its selector in cursors/detail references, and never supply a read receipt or add its private execution text to public search/context reads. `routines.get` returns current control/approval state with omitted history; the details UI loads active or historical execution evidence through these windows with the same row/byte/cache/DOM bounds and stale-response guards. Verify mismatched Bot/occurrence IDs, deleted Bots, private-text exclusion and historical routine navigation.

Migrate all production Desktop readers to history-omitted state plus windows. Legacy snapshot calls without `history` remain available to current fixtures during the transition, but cannot be used by production observation, native attention, search, history navigation or background report delivery. Document any remaining full-history helper as diagnostic/test-only; performance acceptance instruments production call paths to reject it.

Replace the adapter's full-history `#history` cache and Host's retained historical observer snapshots. Live observers use active state and incremental durable-entry projections; their retained state cannot include earlier-topic arrays. Tool-settlement notifications must be driven by newly committed tool outcomes, not by whichever rows a user has loaded. Preserve `toolSettled` idempotence, nested Code Mode settlement and background continuation behavior. No model context or Pi scheduling changes.

Use B14a observation credit and single-flight refresh. In latest mode, invalidation refreshes live state and the bounded tail; in historical mode, retain the reading anchor and refresh activity without appending all intervening messages. Coalesce repeated invalidations into one additional read, discard obsolete selection/generation responses, and show new activity. Jump to latest explicitly replaces the historical window. Stop, approval and drafts must remain usable during indexing/search.

### 4. Search and application reads

Keep `conversations.search` and B24 model search/read schemas, audiences, filtering, snippets, match offsets, ordering, page/result byte limits and query length unchanged. `AppCapabilities` continues to derive eligible keys and recheck model authority after asynchronous work. The worker receives only those eligible keys; deletion/hiding/membership changes during a query trigger a final eligibility check before exposing results. Dissolved-group visibility follows existing behavior; do not invent a new exclusion rule.

Use worker batches of at most 256 rows / 512 KiB; a single oversized message is scanned in chunks with sufficient overlap for the 200-character literal query and existing snippet context. Preserve whitespace normalization and Unicode `/iu` matching across chunk boundaries. At most four outstanding search/context-read jobs are admitted; excess calls fail explicitly. Search has a five-second deadline and cooperatively yields/cancels between batches. No partial page may imply exhaustive results on timeout. Use existing `resource_limit` for model reads and a translated retryable desktop error. UI debounce and stale-response guards remain; abandoned queries must not accumulate in the worker.

Search cursors bind query/options/principal, eligible-scope fingerprint, sidecar generation and a first-page insertion high-water mark, plus the last sort tuple. New arrivals do not reorder subsequent pages; a fresh query sees them. Rebuild invalidates the cursor. Current authorization always overrides the cursor's original scope. These are opaque cursor internals, not new model parameters. Existing result schemas and Code Mode catalog versions stay unchanged.

If any eligible conversation is still indexing, wait only within the deadline and then return a retryable error, not a successful incomplete page. Desktop status explains indexing and offers Retry on failure without displaying query content in diagnostics. B24 context reads query only the anchored message and up to ten neighbors on either side; remove the whole-conversation `committedMessages` copy from this production path. Public text exclusion and output truncation rules remain identical.

### 5. Renderer bounds and reading behavior

Render a measured, variable-height virtual timeline with stable row IDs. Reuse existing message/step/artifact components and existing Markdown rendering. Choose a pinned virtualizer compatible with the installed React/toolchain during implementation; verify its actual APIs rather than relying on the architecture's proposed `anchorTo` option. No general UI redesign or Markdown-library replacement.

- Keep at most three windows / 300 rows per conversation and three conversations in an LRU, with an additional 8 MiB aggregate serialized-content cap. Evict the farthest window from the visible anchor first. Keep only lightweight anchors for at most 100 conversations; drafts remain in their existing durable store.
- Mount at most 80 timeline row roots including overscan; collapsed tool steps must not mount every nested tool row. A detail pane has its own three-part bound. Never build React children for every retained historical row before virtualizing.
- Save `(rowId, offsetWithinRow)` and whether the user follows the tail. Preserve the anchor while prepending/evicting, resizing the reader, changing theme/locale and measuring delayed Markdown/images. Do not use absolute `scrollTop` as the sole historical position.
- Search, usage, memory-source and routine-report links request an around window directly. Load and unfold the exact tool/group detail when appropriate before highlighting it. Missing targets show the existing honest unavailable state.
- Tail-follow only when already following or after explicit send/jump-to-latest. New streamed tokens and background reports cannot pull a historical reader to the bottom. Preserve keyboard focus, IME drafts, accessible loading/error text and existing artifact reader actions in English/Chinese.

### 6. Backup, privacy and compatibility

The sidecar and its WAL/SHM files are disposable and excluded from B14d snapshots. Credentials, model configuration and workspace files keep their existing exclusion. Do not change authoritative Pi documents, read-cursor documents, executor receipts or the backup version/runtime compatibility tag for this cache-only format.

Close the worker on maintenance shutdown. After committed restore and after rollback/startup recovery, invalidate the entire derived cache before serving reads, even when source paths and numeric IDs match. Restore remains paused. Test restore from a pre-B14c backup, rebuilding while preserving old/new topic messages, group report links, attachments, skills and read receipts. Deleting the cache cannot delete history or mark messages read. Diagnostics contain only identities, counts, durations and failure classes, never query text or message bodies.

## Steps

1. Add deterministic large-history fixtures and baseline measurements before optimization. Verify the current Pi public scan/commit contracts and identify every production full-history consumer, including source links and group execution details.
2. Implement the adapter-owned sidecar worker, projection/checkpoint logic, tool-call reconciliation and crash/rebuild handling. Add worker assets to bundled Host staging and startup verification. Keep dependencies/boundary rules intact.
3. Add protocol schemas, authorized Host windows/details/status and history-omitted state reads. Route B24 search/context reads through the bounded worker without changing model schemas or permission scope.
4. Remove production full-history observer caches and settlement-by-visible-history coupling. Wire coalesced invalidation, source/read-cursor fencing and bounded latest/historical refresh.
5. Implement shared private/group virtualization, LRU eviction, large-row details and exact-anchor navigation. Extend existing ScriptedModel e2e with all new visible states.
6. Integrate backup invalidation and packaged worker shutdown/startup. Run the acceptance matrix below, inspect screenshots and explore the new flow with agent-browser in an isolated hidden test app.
7. Update architecture/current-state/backlog with as-built contracts and measurements only when implementation lands. Open one implementation PR linked to this spec; the owner merges.

## Acceptance

| Item | Automated proof required |
| --- | --- |
| 1. Projection fidelity | Adapter tests compare old and new projections for private/group/routine messages, attachments, compaction/reset, interrupted tools, Code Mode and call/result pairs separated by multiple batches; stable IDs and statuses match after restart |
| 2. Bounded work | Instrument source reads, retained rows/bytes, worker queue and mounted DOM. Assert 100-row/512-KiB windows, 32-KiB detail parts, stated cache/job/batch limits, and no production call to full-history snapshots |
| 3. Literal search parity | Compare against the existing search implementation on deterministic English/Chinese/emoji, punctuation, mixed case, combining characters, whitespace and boundary-spanning queries; test paging, tied timestamps, hidden/deleted/dissolved identities, unread filters and no leakage to a group Core |
| 4. Incremental correctness | Append during backfill/search, duplicate commit notification, queue overflow, missed final commit before crash, out-of-order replies, worker failure and rebuild; no lost/duplicated messages and no success that hides an incomplete index |
| 5. Reading state | Hidden e2e: old search hit, prepend/evict, delayed image resize, reader-panel resize, theme/locale change, conversation switch, streaming, compaction and Jump to latest; anchor displacement at most 4 CSS pixels after layout settles |
| 6. Controls and receipts | Search/history navigation never marks later messages read; focus/dwell latest acknowledgement remains monotonic. Approval/Stop, queued steering, nested tool settlement, background completion and scheduled group summary remain responsive and execute exactly once |
| 7. Restore/privacy | Restore a pre-B14c fixture, also restore older data with reused IDs and crash during replacement/rollback; no stale cached message is exposed, read cursors preserved, no source mutation or automatic resumed work; cache absent from exported manifest |
| 8. Large-row safety | A multi-megabyte retained message/tool result yields explicit preview and pageable complete details; Unicode chunks reconstruct exact display text, memory/DOM stay bounded and stale detail refs fail |
| 9. Performance | Run the fixed fixture/thresholds below and retain machine, revision, Node/Electron versions and sanitized measurements; compare both cold-cache and warm-cache paths |
| 10. Integration | `pnpm run check` and full hidden `pnpm run e2e`; inspect English/Chinese, light/dark and minimum-size screenshots; bundled Node/Host/worker startup and close verified; isolated agent-browser flow completed |

### Performance fixture and thresholds

Use deterministic local fixtures, no network/provider timing. Include one private conversation with 10,000 committed public messages, one group with 10,000 public posts, and 28 other conversations with 1,000 messages each. Include interleaved tool calls/results, multiple topics/compactions, repeated timestamps, long Unicode text, 100 artifact references and one 2-MiB legacy display row. Keep the authoritative backup within B14d's existing size limits; do not inflate payloads solely to reach a count.

Measure on the same Apple-silicon Mac, recording hardware, load and versions. After five warm-ups, collect 30 iterations. Warm indexed latest/around window retrieval through renderer display has p95 at most 500 ms; literal search including a no-match scan has p95 at most 1,000 ms. A one-token/one-message update must not scan or serialize old topics; assert operation counts independent of retained private history length. Active controls respond within 250 ms in the fixture while search/rebuild runs. These are local fixture gates, not universal hardware promises.

Cold sidecar rebuild completes within 60 seconds on that recorded machine, keeps the UI responsive and never silently omits history. Compare 1,000 versus 10,000 messages for retained OpenBot projection/cache sizes and mounted DOM; enforce the structural limits above. Record total Host/renderer RSS separately, including Pi active context and canonical group-document costs; do not describe those totals as constant. If canonical group storage prevents the fixture from meeting the thresholds, record the measured blocker in Open questions and stop that dependent acceptance item for a separate migration design rather than weakening the gate or changing canonical storage here.

## Risks

The largest correctness risks are a tool result appearing far after its call, incoming ordinals confused with display positions, restored stores reusing IDs, stale worker results crossing an authority change, and virtualization moving an anchor during measurement. Sidecar failure must degrade reading/search visibly without changing execution. Group canonical storage and linear search CPU remain explicit limits. Snapshot compatibility helpers must not become an accidental production fallback.

## Open questions

None. The owner-approved routine occurrence selector is part of contract 3. Canonical group-storage migration, semantic search and sublinear search acceleration remain excluded.

## Verification

[Final implementation evidence](../acceptance/history-scaling-2026-10-28.md) records the complete fixture, performance gates, command results, failure/recovery tests and isolated desktop inspection. [Historical groundwork](../acceptance/history-baseline-2026-10-28.md) preserves the pre-integration baseline and its narrower limits.

GitHub was rechecked October 28: B4a/#62 is OPEN with no merge commit; I7/#63 is MERGED (`838b032`). B14c remains a separate candidate in #64. No merge or release was performed.


## Implementation notes

- `HistoryProjection` reads Pi through the adapter, with a selected-conversation priority and checkpointed batches. `HistoryStore` owns worker-only SQLite data; `HistoryClient` bounds transport/admission and cancellation. Hash-bound opaque detail references keep maximum-length source IDs within the token limit.
- `ConversationActivity` observes committed tool outcomes independently of display state, including Code Mode children. Production observers emit empty history arrays. Live tool identity/status overlays remain separate from immutable rows, and unchanged Code Mode execution digests do not reread earlier tool bodies. The latest failed user Run supplies retry metadata even when its input is outside the visible window. Approvals render from live state while indexing is unavailable.
- The desktop pins `@tanstack/react-virtual` **3.14.23**. Its installed types and [official API](https://tanstack.com/virtual/latest/docs/api/virtualizer) provide `measureElement`, stable item keys, end anchoring and a bounded range extractor. Successful tool groups mount children only when opened; groups are split into bounded blocks and their mounted children count toward the range budget.
- `e2e/history-scaling.e2e.ts` seeds the full synthetic corpus through public Pi APIs. Its Host fixture rejects production full snapshot/observer calls and records content-free batch/source-read counters. Performance artifacts and screenshots stay under ignored `e2e/.run/history-scaling/`.
- Offline maintenance opens Pi with history disabled. Packaged runtime verification starts the bundled history worker, exports without the sidecar, restores and verifies a new generation before shutdown.
