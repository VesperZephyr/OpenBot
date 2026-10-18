# OpenBot Backlog

Work after the tools demo, cut into batches that can each be finished and verified on their own. Each batch states its approach, key decisions, and the acceptance that closes it. A batch gets a full task spec in [`tasks/`](tasks/README.md) before execution starts; batches here without a spec link are approach only.

The [architecture](architecture.md) defines the target design; the [technical plan](technical-plan.md) records current state. When a batch lands, move it to the plan's current-state table and delete it here.

References:

- **MCode**: `~/minimax-ai/minimax-code` (MiniMax Code). Study, do not copy.
- **Grok Bot**: [docs.x.ai/grok-bot](https://docs.x.ai/grok-bot/overview) and the leaked prompt at `~/github/system_prompts_leaks/xAI/grok-bot.md`.
- **Pi**: `~/github/pi/packages/coding-agent` for the reference coding-agent tools.

## Phases

| Phase | Goal | Batches |
| --- | --- | --- |
| **1. MVP** | A standard agent Bot you can install and use every day: chat with any configured model, work in files and the terminal, research the web, ask before risky actions, remember the user, survive restarts | B1–B8 |
| 2. Enhancements | Connectors, skills, routines, full Auto Review, Bots working together, desktop completion | B9–B15 |
| 3. Computer control | Managed browser with takeover and secrets, desktop computer use, voice and teach-a-task | Architecture M3 (browser part), M6, M8 |

The MVP deliberately leaves out the managed browser, computer use, connectors, skills, routines, and group chats. The architecture keeps their seams (`targetId`, Tool Router, executor capabilities), so they attach later without reworking Phase 1.

## Phase 1: MVP (implemented, awaiting acceptance)

All eight batches are implemented on `feat/mvp`. Each spec in [`tasks/`](tasks/README.md) holds the design, contracts, and as-built notes. Unit tests, Host-level smoke runs, and the e2e suites (in CI on macOS) pass. The acceptance list below still needs a real model and a packaged build.

| Batch | What it delivers | Spec |
| --- | --- | --- |
| B1 | Approvals and executor receipts survive restarts; interrupted commands are reported, never repeated; orphaned process groups are killed | [b1](tasks/b1-durable-approvals.md) |
| B2 | Runs with a global cap and FIFO queue, Stop by `runId`, messages sent while a Bot works steer its Run | [b2](tasks/b2-runs.md) |
| B3 | One output limiter with spill files, `local_edit` expected SHA-256, background commands with `task_output` and `task_stop` | [b3](tasks/b3-coding-tools.md) |
| B4 | `web_search` through Tavily, `web_fetch` as Markdown with retrieval outcomes, Web search settings | [b4](tasks/b4-web-research.md) |
| B5 | Read-only commands inside grants run without asking, Always allow for commands and folders, Commands and Folders settings | [b5](tasks/b5-always-allow.md) |
| B6 | Prompt sections, per-Bot memory with `memory_update`, thinking level, compaction and New topic dividers, Retry | [b6](tasks/b6-bot-quality.md) |
| B7 | Onboarding, one subscribed and coalesced conversation feed, collapsed steps, Copy, Reveal, notifications, Duplicate and Delete, TypeBox IPC validation | [b7](tasks/b7-desktop-mvp.md) |
| B8 | Signed or ad-hoc arm64 DMG with bundled Node and Host, fuses, `app://`, release workflow, Host log | [b8](tasks/b8-installable-build.md) |

Release follow-up: [B8a — Login shell command path](tasks/b8a-login-path.md) resolves the user's login PATH once before Host startup, with bounded fallback and no other shell environment import. Implemented on `task/b8a-login-path` (stacked on B7a), awaiting merge; 178 unit tests, 25 background e2e tests, ad-hoc packaging, and bundled Host/executor smoke pass.

### MVP acceptance

Release follow-up: [B7a — Background desktop tests](tasks/b7a-background-e2e.md) makes automated verification quiet by default, with explicitly enabled visible windows for debugging. Implemented on `task/b7a-background-e2e`, awaiting merge; 163 unit tests and 24 background e2e tests pass.

The MVP is done when all of these pass on a packaged build installed on a Mac that never ran the development setup:

1. First launch walks through choosing a model and creating a first Bot; the API key lands in the Keychain.
2. A Bot searches a repository in the workspace with `rg` or `grep` (no approval card), edits code, runs its tests in the background after **Allow once**, and reports the result.
3. A Bot researches a question with `web_search` and `web_fetch`, cites the pages it opened, and saves a report in the workspace.
4. **Always allow** on a command card stops later identical commands from asking; the rule is visible and deletable in Settings.
5. Telling a Bot a preference ("always answer in Chinese") persists in its memory and applies in a new topic after restart.
6. Three Bots work at once; a fourth waits; Stop and redirect work while a Bot is busy.
7. Quitting during a pending approval and relaunching shows the same approval; an interrupted command is reported, never repeated.
8. A long conversation keeps working past the model's context window (compaction).

## Phase 2: Enhancements

Approach only; each becomes a spec when Phase 1 lands.

Accepted product direction: [D1](tasks/d1-bot-product-design.md). B16/B17 establish model entry and permanent Core identity; B20 refines the desktop and adds English/Chinese. Core management (B18) adds chat-driven Specialist lifecycle with explicit approvals. Prompt and memory controls (B19) are merged. Channel contexts (B13a) are merged; group lifecycle (B13b) and bounded collaboration (B13c) are implemented and in review. Existing agent mechanisms continue to reuse Pi. Connectors, routines and computer control are not prerequisites for this foundation.

- **B9. MCP connectors** (architecture M7). Executor-supervised stdio servers and HTTP sessions, credentials from the Keychain injected only into their own server, tools named `mcp__<server>__<tool>` through Tool Router with receipts, a Connect apps page. OAuth through the default browser comes after the first token-based connectors work.
- **B10. Skills.** Library at `<data>/skills/<name>/SKILL.md`, a `skills` prompt section listing names and descriptions, `skill_load`, `skill_save` with user confirmation, `/` in the composer to attach one.
- **B11. Routines** (after B2). Scheduler in `server-core` with occurrence request IDs `routine:<id>:<scheduledAt>`, a fresh conversation per occurrence admitted through B2's queue, test run, coalesced catch-up after sleep, Grok Bot limits (50 per Bot, 5-minute spacing, 20 runs of history), `routine_propose` with a confirmation card.
- **B12. Full Auto Review.** Ask-first rules (always win), argument predicates for URL origins and connector tools, an optional model reviewer that can only escalate, 10-minute expiry for approvals raised by unattended work.
- **B13. Bots together** (architecture M4). Core-coordinated group chats, explicit mentions, bounded delegation and ownership transfer (B13a–c); remaining work: templates (export and import without memory, history, credentials, or grants), usage per Bot from `pi.usage`.
- **B14. Desktop completion** (architecture M2 rest). Subscriptions with `seq`, gap detection and backpressure, `Cmd+K` search, menu-bar app with running Bots and **Pause all**, Normal and Verbose tool detail, transcript virtualization, login item, Keychain moved out of the `security` CLI, auto-update with electron-updater.
- **B15. Agent extras.** Image results from `local_read` for vision models, waking the Bot when a background task finishes, attachments in the composer, background subagents for parallel research within one Bot.

## Phase 3: Computer control

Architecture M3 (managed browser, takeover, secret requests), M6 (desktop computer use with the signed Swift helper and control lease), and M8 (dictation, teach-a-task). These need packaging and signing from B8 for TCC attribution; start with spikes before specs: two Bots' browser windows not throttled in the background, and the disclaimed helper receiving Screen Recording and Accessibility grants.

## Product foundation implementation

- [B16: Model sources](tasks/b16-model-sources.md): implemented on `task/b16-model-sources`, awaiting review; 183 unit tests and 27 background e2e tests pass.
- [B17: Core Bot](tasks/b17-core-bot.md): implemented on `task/b17-core-bot`, awaiting review; 186 unit tests and 29 background e2e tests pass. Only the Core is seeded; Specialists require user creation.
- [B20: Desktop experience and English / Chinese](tasks/b20-desktop-experience.md): implemented on `task/b20-desktop-experience`; local language preference, refined UI and isolated real-model desktop verification.
- [B18: Core management](tasks/b18-core-management.md): merged in PR #11; Core-only tools, durable exact approvals, revision checks, atomic receipts and bilingual local activity.
- [B19: Prompt and memory controls](tasks/b19-memory-controls.md): merged in PR #12; revision conflicts, local bounded history/restore, replay safety and empty-memory duplication. 200 unit tests and 40 background e2e tests; isolated real-model verification.
- [B13a: Channel contexts](tasks/b13a-channel-contexts.md): merged in PR #13; shared Bot identity with isolated channel context, scoped lifecycle and durable Run mapping. B13b supplies group UX.
- [B13b: Group lifecycle](tasks/b13b-group-lifecycle.md): implemented, awaiting review; local group records, exact Core approvals, participant-only group contexts, durable delivery/recovery and bilingual desktop controls.
- [B13c: Bounded collaboration](tasks/b13c-collaboration.md): implemented, awaiting review; Core-default group entry, explicit @, delegate/transfer/result receipts, two-hop/twelve-delivery limits, tree cancellation, local state and bilingual UI. 223 unit tests and 49 background e2e; isolated real-model collaboration and recovery.
- Remaining B13 work: Bot templates and usage. Cross-group/direct-chat peer dispatch, selective memory transfer and full data purge require separate specs; agent execution continues to reuse Pi.
- [D2: Grok UI research](tasks/d2-grok-ui-research.md): complete, including installed 0.71.2 client inspection.
- [B21: Conversation experience](tasks/b21-conversation-experience.md): merged in PR #17; shared private/group shell, contextual details, local filtering/New, durable local drafts and send recovery, keyboard mentions, scroll preservation and compact task activity. English/Chinese; 229 unit tests and 54 background e2e; isolated real-model private chat, Core delegation/result return and explicit @.
- [B22: Conversation list previews and unread state](tasks/b22-conversation-list.md): implemented, awaiting review; 234 unit tests and 59 background e2e; isolated real-model private/group replies and full restart verification; local Host index, snapshot-bound durable read cursors, bilingual previews/time/counts, draft/activity precedence and recency within protected Core/pinned sections.
- [B23: Conversation search and unread filtering](tasks/b23-conversation-search.md): implemented, awaiting review in PR #20 (stacked on B22); 239 unit tests and 65 background e2e; isolated real-model private/group history search and full restart; local literal matching, bounded results, unread composition, bilingual exact-message navigation, stale-response guards and draft/read preservation.
- Remaining UI work: group pin/hide, manual mark-unread, transcript virtualization, large-history search indexing and artifact previews require separate specs.
