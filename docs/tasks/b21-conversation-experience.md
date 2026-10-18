# B21: Conversation Experience

Status: done (PR #17)
Branch: task/b21-conversation-design
Depends on: B13c, B19, B20
Architecture: Sections 5.7, 6.5, 7.1, 8
Research: [D2: Grok Bot Interaction Research](d2-grok-ui-research.md)

## Goal

Make private and group conversations feel like one coherent desktop product. Improve navigation, reading, composition and task visibility while preserving existing Host behavior and local privacy.

## Scope

In: shared conversation shell, roster row design, unified New menu, contextual details, local per-conversation drafts, send recovery, keyboard mentions, scroll anchoring, compact collaboration activity, English and Simplified Chinese.

Out: new agent tools, changed permissions/routing, new group lifecycle semantics, full-text search, durable group unread/latest-message projections, attachments, voice, connectors, routines, template sharing, cloud synchronization and a new editor framework. Reuse the current textarea and structured recipient IDs for this increment. Follow-ups are recorded in D2.

## Design

Adopt D2's neutral tokens, typography and dimensions. Use one row geometry for Bots and groups; keep Core first with a small Core marker. Retain existing ordering semantics initially. Show current activity or a local draft preview before role/member-count fallback. Do not fetch full histories for sidebar previews or invent unseen-message state.

Place Search and New at the top of the roster. Search filters existing Bot/group names and roles locally; label it Search conversations, not Search messages. New opens Create Bot and Create group choices using existing forms. Opening a Bot stays a private chat. Ordinary group messages still route to Core. Group details explain that Core coordinates even when another member is the configured lead.

Use one header/composer/timeline shell with explicit direct/group adapters. Move edit and destructive actions into the header menu and details surface. Core has no delete action. Destructive confirmations and revision checks stay intact. Details contain existing profile, Prompt and memory controls for a Bot, or membership and task details for a group. On widths below 1200 px, use a focus-trapped overlay; above that width, an optional 320 px panel. Closing details restores focus to its opener and retains drafts.

Conversation content remains selectable Markdown. Sender identity, handoff and return events have a quieter visual weight than final results. Show one compact working row per active root, with actual owner names and an expand action. Keep Stop task chain reachable without expansion. Expanded details show the existing delivery count, status and scoped Run stop. Pending approvals stay fully visible; paused/cancelled work retains an explanation. Completed roots retain their public handoff/results. Never use a visual status change as authority to start or stop work.

## Draft and send contracts

These are renderer-owned UI records, not Pi context or Host business records. No protocol change is required for draft storage. Use the desktop's existing persistent renderer partition with a versioned local-storage key; no remote analytics, assets or draft synchronization. Credentials are not part of this store.

```ts
type ConversationKey = `bot:${string}` | `group:${string}`;
type ComposerDraft = {
  version: 1;
  text: string;
  recipientIds: readonly string[]; // Groups only; empty means Core.
  revision: number;
  updatedAt: number;
};
type SendAttempt = {
  requestId: string;
  conversationKey: ConversationKey;
  text: string;
  recipientIds: readonly string[];
  draftRevision: number;
  state: "pending" | "uncertain";
};
```

- Keys include the conversation kind; equal raw IDs cannot collide. Store drafts independently from navigation components. Persist on edit and before dispatch; do not erase drafts on navigation, language change or restart.
- Validate stored records and handle corrupt storage without crashing. Storage failure preserves the in-memory text and displays a local notice; never silently discard older drafts to make room. Successful deletion of a Bot clears its draft. A dissolved group retains a read-only, copyable unsent draft.
- Capture text, recipients, revision and request ID before dispatch. Reuse the same immutable attempt when retrying an uncertain send. Change renderer `sendMessage` to accept the captured request ID; do not generate a new Host request ID for the same retry.
- Clear only the draft revision acknowledged by the Host. A late success or failure cannot overwrite text typed after submission, or a draft in another conversation. Uncertain attempts remain visible with Retry and Copy; they do not automatically resend on startup. New edits form a separate draft. Show acknowledged messages from Host state, without duplicate optimistic transcript entries.
- Explicit recipient selection is scoped to the group. Remove stale recipients visibly before sending and require the user to reselect or choose Core; never silently redirect a task that was addressed to a removed Bot. A successful send resets recipients for the next empty draft to Core.
- No private draft is sent to a model until the user sends it. Do not include draft text in diagnostics.

### Recovery decisions

- Store one unresolved send attempt per conversation in `openbot.composers.v1`. New typing remains editable but sending waits until the prior attempt resolves or the user explicitly dismisses its recovery record. Dismiss does not cancel accepted work; show that distinction beside the action.
- Persist the immutable attempt before calling Host. If persistence fails, do not dispatch. On renderer restart, pending attempts become uncertain and wait for explicit Retry. Treat transport errors conservatively as uncertain; never mint a replacement request ID automatically.
- Keep the submitted draft visible until acknowledgement. Clear it only if its revision still matches the captured revision. On retry success, clear only that revision. Retain newer text and recipients unchanged.
- An unresolved retry preserves the original recipients, even if membership changes; Host performs its existing validation or receipt replay. The new draft blocks sending when a selected recipient disappears, until explicit removal or Core selection.
- Store presentation layout and scroll anchors in renderer memory only. Drafts and send recovery survive restart; scroll restoration is per window session. Host snapshots remain the sole transcript source.
- Details use a shared responsive panel; existing profile/memory forms and group editor remain the mutation surfaces. Existing Bot menu actions stay available. Native dialog semantics or an equivalent focus trap cover modal editors.

## Keyboard and scrolling contracts

- Enter sends, Shift+Enter inserts a newline; IME composition never sends or chooses a mention. Send is disabled while the same attempt is pending. A later separate instruction may still steer work using existing Host semantics.
- In a group, `@` opens the member/Core picker. Arrow keys move the active option, Enter/Tab selects, Escape closes, and focus returns to the composer. Selecting records an ID and shows a removable recipient chip. Plain text @names remains inert. Do not add cross-Bot private-chat routing.
- Cmd+K focuses conversation filtering; Cmd+N opens New; Cmd+, opens existing settings. Dialogs, menus and mention lists have appropriate roles, visible focus, Escape behavior and focus restoration. Do not globally consume editing shortcuts while an unrelated modal is active.
- A shared scroll controller treats the reader as following when within 80 CSS px of the bottom. While following, new content remains visible. Otherwise preserve the visible message anchor and show New activity / Jump to latest. Explicitly sending scrolls that conversation to its latest content. Switching conversations restores the last anchor where available. A language change or details-panel resize does not jump to the bottom.
- Render status from Host data: a pending delivery without a Run is Queued; a running Run is Working; a pending approval is Needs approval; a halted root shows its recorded reason. Never infer completion from the arrival of text alone.

## Steps

1. Extract shared renderer shell, roster row, header and composer primitives from `App.tsx` and `Groups.tsx`; keep direct/group adapters explicit. Apply shared tokens without changing Host/runtime modules.
2. Add a local draft/send-attempt store and integrate immutable request IDs into the existing renderer API calls. Cover late acknowledgements and navigation races before changing layout.
3. Add local conversation filtering, unified New flow and contextual details using existing management/memory components.
4. Add mention keyboard interaction, scroll preservation and compact collaboration activity. Preserve existing approval and cancellation calls.
5. Add English/Chinese copy and background e2e for every new interaction. Inspect actual screenshots and explore the isolated desktop with agent-browser.
6. Run full check/e2e, then use a synthetic isolated real-model desktop to exercise private chat, Core-led group dispatch, @ targeting, readable activity and result return. Stop the isolated app and remove copied model configuration.

## Acceptance

1. E2e: Core remains unique and undeletable; New exposes both supported creation flows; opening a Specialist remains a private chat; name/role filtering navigates Bots and groups without model calls.
2. Store invariants and e2e: independent drafts survive Bot/group switches, locale changes and restart; send failure preserves text; late completion cannot overwrite a newer draft; retry uses one request ID and one Host message; uncertain startup state never sends automatically.
3. E2e: @ selection works by keyboard and pointer; Escape and removal work; Chinese IME Enter does not send; a removed recipient cannot silently fall back to Core.
4. E2e: while scrolled up, streamed updates and group posts preserve the reading anchor; Jump to latest resumes following; details and locale changes preserve position.
5. E2e: compact activity exposes actual ownership, queued/running/approval/paused states, full task-chain stop and scoped individual stop; B13c's existing isolation/recovery regressions still pass.
6. Screenshots: English and Chinese, light/dark, 880×700 minimum and 1440×900 desktop; long names and code blocks remain usable; keyboard focus and reduced motion verified. Pending approvals and Stop remain reachable without horizontal page overflow.
7. `pnpm run check` and full background `pnpm run e2e` pass. Record actual model observations separately; do not assert cloud behavior, all-provider support or packaged OS permissions.

## Risks

Drafts contain user text and must stay in the local desktop partition. Storage quota errors need visible recovery. Sharing visual primitives must not merge private/group channels or weaken scoped approval/cancellation. Rich editor replacement and transcript virtualization would broaden this task substantially and remain deferred.

## Open questions

None. The owner authorized implementation on 2026-10-18. Persistent draft and send-attempt recovery are part of this batch.

## Implementation and verification

Implemented in `apps/desktop` without Host, protocol or Pi changes. `ConversationUI` supplies the shared shell, responsive details, modal focus and scroll anchoring. `ChatComposer` supplies structured mentions and send recovery; `ComposerStore` persists local drafts and immutable attempts. Private chat remains direct; ordinary group messages continue through Core.

Verified on macOS on 2026-10-18:

| Acceptance | Evidence |
| --- | --- |
| 1. Navigation and identity | Existing Core/lifecycle e2e and new conversation-experience e2e cover the unique protected Core, both New choices, private chat and local name/role filtering with no model requests. |
| 2. Draft and send recovery | Six store tests cover scoping, late acknowledgements, duplicate pending sends, immutable retry, restored pending state, storage failure/corruption and deletion races. Desktop restart e2e preserves drafts; a lost UI acknowledgement replays one request with one Host post/model call and retains a newer draft. |
| 3. Mentions | Keyboard Enter/Tab/Escape, pointer selection, Chinese IME, stale-member blocking and explicit Core reset pass in e2e. |
| 4. Reading | Private/group updates while reading history preserve scroll position; details resize and Jump to latest pass. Locale/restart and navigation preserve drafts. |
| 5. Activity and control | Group regressions cover Core dispatch, ownership transfer, permission boundaries, recovery, approval visibility, root Stop and expanded individual Stop. Public results remain after completion. |
| 6. Visuals and keyboard | Inspected English/Chinese screenshots in light/dark at 1440×900 and 880×700, including long names, horizontally scrolling code, details and dissolved-group drafts. Focus/Escape and reduced-motion media are exercised. Agent-browser exploration of the isolated desktop covered details, memory, group navigation and pointer mentions. |
| 7. Full validation | `pnpm run check`: 229 tests across 37 files. Full background `pnpm run e2e`: 54 tests across 18 suites. |

Real-model spot check used an isolated, hidden desktop with synthetic Bots/groups and a configured endpoint. Bot and group creation used the UI. A direct private message received its expected response. An ordinary group message went to Core, delegated 23 × 19 to Analyst, and returned 437 through a completed `user → peer → result` chain with two automatic deliveries. Explicit keyboard @Reviewer returned 42 in Chinese for 41 + 1. Private/group drafts survived navigation, language change and renderer restart; Prompt/memory and group details remained accessible. These observations validate one configured model, not every provider or packaged macOS permissions.

Synthetic screenshots remain outside version control under `e2e/.run/conversation-experience/` and the temporary real-model acceptance directory. The isolated desktop was stopped and its copied model configuration removed after verification. No owner conversation data was used.

Follow-ups remain separate: durable sidebar latest-message/unread projections, full-text search, transcript virtualization, artifacts, attachments and richer editing.
