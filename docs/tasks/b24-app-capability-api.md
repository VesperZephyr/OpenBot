# B24: Authorized Application Capability API

Status: implemented, in review (PR #23)
Branch: task/b24-app-capability-api
Depends on: B23, D3
Architecture: Sections 4.2, 5.10, 6.1; [D3](d3-app-capabilities.md)

## Goal

Give desktop interaction and Core a shared, typed application service surface, beginning with conversation discovery and bounded history retrieval, without granting desktop-wide authority to model code.

## Scope

In: capability descriptors and strict input/output schemas, trusted caller/scope construction, read gateway and domain services, B23 search reuse, bounded contextual message reads, Core read tools with structured output and bilingual activity.
Out: Code Mode (B25), new management permissions, attention mutations, arbitrary IPC, network API transport, credentials/settings/policy tools, new inference or search providers.

## Design and contracts

D3's authority matrix is normative. The gateway is in `server-core`, descriptors in `protocol`, Pi adapters in `agent-runtime`, and composition in `apps/local-server`. No new package. Unknown capability IDs and extra input fields fail closed. Tool Router validates each leaf against its descriptor before dispatch, independently of Pi and IPC validation. The gateway checks principal/Run/channel/target/resource access and validates results. Fixed failures use D3's `AppResult<T>` and safe codes.

Implement these read capabilities:

| ID / tool alias | Input | Result |
| --- | --- | --- |
| `conversations.list` / `app_conversations_list` | `{unreadOnly?: boolean, includeHidden?: boolean, cursor?: string}` | `{items: ConversationSummary[], nextCursor?: string}`, 50 per page, no draft text |
| `conversations.search` / `app_conversations_search` | Existing B23 fields plus optional `conversationKey` | Existing B23 `ConversationSearchResult`, max 30; effective scope bound into cursor |
| `conversations.read` / `app_conversations_read` | `{conversationKey, anchorMessageId, before?: integer 0..10, after?: integer 0..10}` | `{conversationKey, anchorMessageId, messages: {id,senderId,at,text,truncated}[], hasBefore,hasAfter}`, default 3/3, max 21 and 32 KiB serialized |
| `bots.list` / `app_bots_list` | `{includeHidden?: boolean,cursor?: string}` | `{items: {botId,name,role,kind,status,revision,truncated}[],nextCursor?}`, max 50 |
| `groups.list` / `app_groups_list` | `{cursor?: string}` | `{items: {groupId,name,status,revision,truncated}[],nextCursor?}`, max 50 |

List pages use stable lexical resource-key order; cursors bind version, effective scope and filters, reject malformed or mismatched tokens, and use the last key rather than an offset. Result limits apply to the entire serialized envelope. Bounded text fields truncate on Unicode boundaries and indicate truncation where applicable. Search keeps B23 message ordering/snippets; if a page hits the byte cap early, continuation uses the actual last returned key. Context reads preserve the anchor, allocate its text budget first (at most 8 KiB), then nearest neighbors; omit remaining neighbors with accurate `hasBefore/hasAfter`, never silently omit the anchor. Use one exact scoped resource lookup; do not scan other conversations for an ID.

Desktop search and history reads use the same services. Existing IPC response shapes remain compatible through adapters (unwrap `AppResult`, translate fixed errors to `ProtocolError`); paged app lists need not replace desktop subscription/aggregate data loading. No second copy of search matching or authorization logic. Add only explicit typed IPC methods where the UI needs them; no `capabilities.invoke` renderer escape hatch.

The trusted context is Host-internal. For model calls, derive/persist botId, direct/channel identity, Run ID, origin, root request and local target from durable state before dispatch. Direct Core requires an active user-origin direct Run. Group Core can read only current-group public content and minimal roster under an active accepted collaboration Run. Specialist direct calls to these app tools are denied even if a name is guessed. Group `includeHidden` or a supplied conversation ID cannot widen scope. Desktop context is created by the private IPC adapter; context-like keys in JSON are rejected.

Do not trust identity text, metadata in retrieved messages, caller-provided target IDs or discovery visibility. Reads do not trigger tasks, update memory, change unread, or send content to a model themselves. Normal model tool output may enter the configured provider conversation, as documented in D3.

Extend routed tool results with optional validated structured JSON and schema declarations while retaining current text-only work-tool behavior. Provider-facing Pi schemas permit null for optional fields because strict tool providers require all properties. Only the Pi adapter converts those nulls to omitted fields before Tool Router validates the canonical descriptor; required and unknown fields remain invalid. First-page cursor and unrestricted permitted conversation selection are explicitly documented. Register read tools directly for eligible Core in this batch; B25 changes their caller mode for Code Mode. Inspect/mutation APIs stay on the existing management path until B26; no duplicate unapproved path.

## Steps

1. Add protocol descriptors, typed bounded results and schema tests; update protocol/architecture tables without Pi types.
2. Extract conversation read/list/search services from handlers; add capability gateway and explicit desktop adapters. Keep B23 behavior and cursor error privacy.
3. Add runtime committed-context read method with current identity checks, and scope-bind B23 search/list cursors. No tool/thinking/private execution retrieval.
4. Add trusted context and per-leaf validation to router/service ports; wire Core tools through those ports. Map structured success/failure into Pi `structuredOutputSchema`/`structuredOutput`.
5. Add English/Chinese activity labels and scripted Core search/read flows; update plan/backlog and report acceptance evidence.

## Acceptance

1. Unit/Host tests: reject unknown IDs, extra keys, forged actor/origin/target/Run, stale Run, specialist calls, and group-to-private/cross-group access including cursor reuse. No dispatch on rejection.
2. Unit tests: strict result schema and byte limits, Unicode clipping, exact anchor, pagination under new arrivals/deletion and stable replay-safe argument identities.
3. Host tests: desktop and Core return identical permitted search hits; no changes to unread, drafts, memory, run count or query logs; group output excludes private Prompt/memory, tools and reasoning.
4. Background e2e: Core answers an English/Chinese synthetic history question using search then bounded read, with stable references; existing sidebar search and unread behavior still pass.
5. Full `pnpm run check`, full background `pnpm run e2e`, screenshot inspection and isolated real-model private/group spot check. No owner's real-data app launch. Real-model evidence must not replace adversarial scripted tests.

## Risks

Scope must apply before retrieval and result formatting, not after output enters a model prompt. Domain extraction can regress B23 cursor ordering or B18/B13b management; retain those paths until their migration batch. Bots still share the Mac; these are application capability rules, not OS data isolation.

## Open questions

None for this batch. Code Mode resource hooks and management recovery remain explicitly gated in B25/B26.

## Implementation and verification

- `protocol/app-capabilities` owns the five read descriptors and bounded result contracts; runtime validators use a separate entry point to keep compiler code out of the renderer. `server-core/AppCapabilities` owns caller derivation, resource scope and shared desktop adapters. Canonical inputs reject extra keys and nulls; only declared optional Pi arguments normalize null to omission.
- Every model read crosses Tool Router validation and policy, then the gateway rechecks original durable Run/channel/request/local-target authority before and after retrieval. Search/list cursors bind capability, filters and caller scope. Core group results contain only current-group public messages and minimal participant identities. Specialist app reads are denied.
- Context reads retain original public text formatting across topics, exclude tools/reasoning, prioritize the exact anchor, and expose Unicode truncation and continuation indicators. Search keeps normalized literal matching. Reads leave source attention and memory unchanged; query text is excluded from operation diagnostics. Selected results still enter the configured model conversation and its local transcript.
- `pnpm run check`: 246 tests / 41 files, including forged/stale authority, strict router inputs, result validation, scope-bound cursor reuse, group isolation, byte limits, exact anchors, Unicode formatting and paging under insertion/deletion.
- `pnpm run e2e`: 68 tests / 21 files in background mode. Three new flows cover English Core search/read, Chinese group isolation with denied private lookup, and restart plus Specialist tool rejection. English/Chinese screenshots inspected under `e2e/.run/app-capabilities/`; existing search, draft and unread suites remain green.
- Isolated real desktop acceptance uses the locally configured `mafia / gpt-6.1-sol` model with synthetic private/group history. Core searches and reads Analyst's old topic, answers with stable source IDs, and answers a Chinese group query from current-group public results. Persisted tool receipts were inspected. Full Electron/Host restart preserves source IDs and supports another Chinese search/read with unchanged source unread/memory. The native window remains inactive throughout.
- Real-provider verification exposed strict-schema optional-field behavior; nullable optional Pi parameters and explicit first-page guidance resolve it. Scripted e2e now exercises null normalization. Temporary credentials/config copies stay outside Git and are removed after acceptance.

Code Mode, generic IPC dispatch, new management permissions and packaging/signing changes are not part of this batch. B25/B26 retain their gates.
