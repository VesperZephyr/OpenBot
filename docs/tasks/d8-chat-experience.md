# D8: Unified chat and continuous activity feedback

Status: in review in [PR #56](https://github.com/VesperZephyr/OpenBot/pull/56); implemented and verified. Owner requested on 2026-10-23. Branch: `task/d8-chat-experience`, stacked on B11c until its prerequisites merge.

## Problem and outcome

The daily surface separates Bots and groups and exposes application controls beside every conversation. Live group replies lose Markdown, and empty partial responses produce no visible progress. The owner wants the familiar, restrained messaging experience shown in their Grok Bot reference.

## Contract

1. One Chats list contains private conversations and groups. Preserve Core-first and pinned ordering, then interleave the rest by committed message recency with stable identity ties. Preserve drafts, unread counts, search and hidden Bot access. Keyboard number shortcuts follow the visible unfiltered list. Groups use a composite of their members' existing avatars, with an accessible group description.
2. Sidebar chrome consists of compact search/New actions, the conversation list and one bottom-left Settings icon. Search/filter controls expand when requested; Cmd+K opens and focuses search, Escape clears then closes it. Cmd+N and Cmd+, remain available. Remove the large brand block and section split. Management stays within Settings.
3. Move the ordinary Pause all control to General Settings. When work is blocked, retain the contextual Resume work notice in chat. Existing native-session gates, interruption continuation and per-task Stop remain unchanged.
4. Show honest activity from send submission through acknowledgement, queueing, generation, tool work, approval/user waits, cancellation and retry. A compact shared indicator uses actual snapshot state, never fabricated percent complete or reasoning. Empty/absent partial output must not hide it. Live private and group replies share sanitized Markdown and author treatment. Group indicators show who is working; private tool details remain private.
5. Stream actual provider chunks rather than a fake typewriter animation. Preserve finished Markdown blocks while appending/changing the current block, sanitizing each block and keeping external-link/copy behavior. Incomplete links must not become actionable until closed. Keep text selectable, code horizontally scrollable, and active reply feedback visible through tool rounds. Never announce every token to assistive technology.
6. Follow latest while at bottom; preserve the reader's position when scrolled up, expose Jump to latest and preserve drafts while navigating. Terminal states remove activity. Empty history is distinguished from a conversation snapshot still loading.

## Visual direction

Use the current light/dark tokens, system sans-serif and quiet borders. The signature is the member-avatar cluster, shared with the group header. At rest the sidebar should be mostly conversations. Busy feedback is a small three-dot indicator plus a precise label, with a static reduced-motion equivalent. Keep focus rings, translated accessible names, generous icon hit targets and responsive layouts. No new dependency or redesign of model/policy management is needed.

## Execution

- Isolate development from the owner's running app and configured routines.
- Implement shared ordering/avatar and activity components, then simplify navigation.
- Notify observers when Host reconciliation changes a collaboration root state. A completed root must clear its working/Stop row without navigation; this corrects observation delivery without changing scheduling or publication semantics.
- Stabilize streamed Markdown rendering and reuse it for group partials.
- Extend ScriptedModel with delayed real SSE chunks and add end-to-end coverage for navigation, delayed first token, multiple chunks, tool/approval states, scrolling, cancellation and group output.
- Run `pnpm run check` and `pnpm run e2e`, inspect screenshots and explore an isolated hidden app with agent-browser. Update plan/backlog with verified results and limitations; open a PR.

## Acceptance

- [x] One ordered list, group avatars, search/keyboard/filter/read/draft behavior preserved.
- [x] Settings is an icon at bottom left; Pause all is absent from ordinary chat, available in Settings; blocked work remains recoverable.
- [x] Slow first token and empty partials always show activity; sending, queueing, tools, approvals, retry, cancellation and terminal states are truthful.
- [x] Actual incremental Markdown appears before completion in private and group chats, safe incomplete links and stable finished blocks.
- [x] Following, reading older messages and Jump to latest remain predictable during streaming.
- [x] Light/dark, reduced motion, keyboard focus, Chinese/English and narrow layouts inspected; automated suites pass.

## Verification record (2026-10-23)

- `pnpm run check`: boundaries and type checks pass; 520 unit/Host tests across 77 files pass.
- `pnpm run e2e`: all 167 hidden desktop tests across 46 files pass. The 21 focused navigation/streaming tests also pass independently.
- ScriptedModel sends delayed real SSE chunks, including empty chunks, to verify submission/first-token feedback, incremental private/group Markdown, completed block identity, safe links, scrolling, approvals, cancellation and failure recovery.
- A Host regression verifies that root settlement emits one observer notification and later idle sweeps emit none. The desktop regression verifies that completed group work clears without navigating away.
- Inspected light/dark, Chinese/English and narrow-window screenshots, including reduced motion. Explored search/Escape, mixed navigation, streaming/loading and Settings draft preservation through agent-browser in an isolated hidden app.
- No real-provider spot check was needed for this UI batch. Native permissions/signing gates are unchanged. The owner's running app, configured radar and schedules were not used as test fixtures.

## Open questions

None. Native browser/desktop control, new model capabilities and changelog retrieval quality are outside this task. Existing snapshot APIs do not distinguish private model reasoning from first-token waiting; use “Thinking” for generation with no visible text, not a fabricated reasoning transcript. Scheduled group reports remain atomic publications; their in-progress details are available in Routines, not prematurely published to the group.
