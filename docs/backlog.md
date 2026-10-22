# OpenBot Backlog


Active delivery scope (2026-10-22): the owner prioritizes attributable memory, correction/forgetting and explicit sharing (B27a), then per-role default skills (B27b), on one local Mac. B9c OAuth and B12b optional model review remain excluded; Phase 3 remains deferred. I3 (#42), B6a (#43) and D5 (#44) are merged. Backup/restore (B14d), history scaling (B14c), templates (B13e) and signed updates (B14f) follow these role foundations. Historical planning sections do not authorize excluded or deferred work.

Work after the tools demo, cut into batches that can each be finished and verified on their own. Each batch states its approach, key decisions, and the acceptance that closes it. A batch gets a full task spec in [`tasks/`](tasks/README.md) before execution starts; batches here without a spec link are approach only.

The [architecture](architecture.md) defines the target design; the [technical plan](technical-plan.md) records current state. When a batch lands, move it to the plan's current-state table and delete it here.

Current delivery order: [Post-B26 development roadmap](development-roadmap.md), with the first four execution packets and subsequent workflow gates. Baseline `main` includes B26 (PR #27); no planned feature is authorized merely by its place in this queue. All new PRs target `main`.

References:

- **MCode**: `~/minimax-ai/minimax-code` (MiniMax Code). Study, do not copy.
- **Grok Bot**: [source-backed research snapshot](research/grok-bot.md) and [client interaction research](tasks/d2-grok-ui-research.md); distinguish official facts, observations and inference.
- **Pi**: `~/github/pi/packages/coding-agent` for the reference coding-agent tools.

## Desktop design delivery

[D6: Personal assistant design](tasks/d6-desktop-design.md) is implemented on `task/d6-desktop-design`, with automated acceptance complete and review pending. The owner approved chat styling, ordinary Bot rows with a protected identity star, and editable profiles with generated/uploaded avatars for every Bot together. Merge remains pending. AI image generation, adjustable cropping, proactive greetings, new result grouping and settings category navigation need separate specs.

## Memory design research

[D5: Local memory research](tasks/d5-memory-research.md) is merged in PR #44. The owner approved the local role direction from [D6 research PR #45](https://github.com/VesperZephyr/OpenBot/pull/45).

- **B27a, in review (#46):** [Attributable memory and explicit sharing](tasks/b27a-memory-provenance.md). Topic provenance, correction/forget protection, owner-confirmed scope moves, bounded shared facts and bilingual controls. No semantic extraction or embedding service.
- **B27b, next:** pin reviewed skill versions to each role; direct-chat defaults remain guidance, with tools and grants independently enforced. Requires its own ready implementation spec.
- **Later research:** bounded retrieval, semantic contradictions and source citations. B14d must preserve both local/shared documents and protection metadata together.

## Role methods

[B27b: Per-role skill defaults](tasks/b27b-role-skills.md) is implemented in PR #47, following the owner-approved local role direction. Profile pins are exact shared-library versions; direct-user admission composes them with message attachments and freezes accepted method snapshots. Groups and routines keep their existing explicit selections. Memory provenance/correction/sharing is the separate [B27a PR #46](https://github.com/VesperZephyr/OpenBot/pull/46); neither batch introduces cloud services or new grants.

After these role foundations, retain B14d/B14c/B13e/B14f ordering. Per-message skill overrides, capability readiness and broader group defaults need separate specs.

## Phases

| Phase | Goal | Batches |
| --- | --- | --- |
| **1. MVP** | A standard agent Bot you can install and use every day: chat with any configured model, work in files and the terminal, research the web, ask before risky actions, remember the user, survive restarts | B1–B8 |
| 2. Enhancements | Connectors, skills, routines, deterministic permissions, Bots working together, desktop completion | B9–B15 |
| 3. Computer control (deferred) | Managed browser with takeover and secrets, desktop computer use, voice and teach-a-task | Architecture M3 (browser part), M6, M8 |

The MVP deliberately leaves out the managed browser, computer use, connectors, skills, routines, and group chats. The architecture keeps their seams (`targetId`, Tool Router, executor capabilities), so they attach later without reworking Phase 1.

## Phase 1: MVP (merged, integrated acceptance)

All eight batches are merged into `main`. Each spec in [`tasks/`](tasks/README.md) holds its contracts and historical evidence. [I2](tasks/i2-mvp-acceptance.md) verifies the current integrated candidate with complete automated checks, real-model file work and an ad-hoc packaged build. [The acceptance record](acceptance/mvp-2026-10-19.md) distinguishes these results from the clean-install and native release checks below.

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

Release follow-up: [B8a — Login shell command path](tasks/b8a-login-path.md) resolves the user's login PATH once before Host startup, with bounded fallback and no other shell environment import. Merged; its original evidence covers 178 unit tests, 25 background e2e tests, ad-hoc packaging and bundled Host/executor startup.

### MVP acceptance

Release follow-up: [B7a — Background desktop tests](tasks/b7a-background-e2e.md) makes automated verification quiet by default, with explicitly enabled visible windows for debugging. Merged; current automated acceptance continues to use its isolated background mode.

The MVP is done when all of these pass on a packaged build installed on a Mac that never ran the development setup:

1. First launch creates only the protected Core, offers built-in/custom model setup or skip, and stores a supplied API key in Keychain. Specialists require user creation.
2. A Bot searches a repository in the workspace with `rg` or `grep` (no approval card), edits code, runs its tests in the background after **Allow once**, and reports the result.
3. A Bot researches a question with `web_search` and `web_fetch`, cites the pages it opened, and saves a report in the workspace.
4. **Always allow** on a command card stops later identical commands from asking; the rule is visible and deletable in Settings.
5. Telling a Bot a preference ("always answer in Chinese") persists in its memory and applies in a new topic after restart.
6. Three Bots work at once; a fourth waits; Stop and redirect work while a Bot is busy.
7. An unexpected Host crash retains pending approvals and stable invocation identities. Intentional quitting withdraws active approvals under B14b; interrupted or uncertain effects remain visible and require explicit continuation rather than blind replay.
8. A long conversation keeps working past the model's context window (compaction).

## Phase 2: Enhancements

Remaining work needs its own ready spec. Current implemented enhancements are recorded in the technical plan and integration gate below.

Accepted product direction: [D1](tasks/d1-bot-product-design.md). B16/B17 establish model entry and permanent Core identity; B20 refines the desktop and adds English/Chinese. Core management (B18) adds chat-driven Specialist lifecycle with explicit approvals. Prompt and memory controls (B19) are merged. Channel contexts (B13a) are merged; group lifecycle (B13b) and bounded collaboration (B13c) are merged. Existing agent mechanisms continue to reuse Pi. Connectors, routines and computer control are not prerequisites for this foundation.

- **B9. MCP connectors** (architecture M7). Executor-supervised stdio servers and HTTP sessions, credentials from the Keychain injected only into their own server, tools named `mcp__<server>__<tool>` through Tool Router with receipts, a Connect apps page.
- **B10. Skills.** Library at `<data>/skills/<name>/SKILL.md`, a `skills` prompt section listing names and descriptions, `skill_load`, `skill_save` with user confirmation, `/` in the composer to attach one.
- **B11a. Local routines:** merged in PR #41; see the [spec](tasks/b11a-local-routines.md). Confirmed panel management, isolated occurrences, exact reports, catch-up and absence protection. Model-driven proposals are a separate follow-up without a ready spec.
- **B13. Bots together** (architecture M4). Core-coordinated group chats, explicit mentions, bounded delegation and ownership transfer (B13a–c); remaining work: templates (export and import without memory, history, credentials, or grants), usage per Bot from `pi.usage`.
- **B14. Desktop completion** (architecture M2 rest). [B14a](tasks/b14a-reliable-observation.md) implements bounded observation and reconnect recovery (in review). B23 provides `Cmd+K` history search. B14b adds sidebar Pause all and lifecycle gates. Remaining: richer menu-bar status, Normal and Verbose tool detail, transcript virtualization, login item, auto-update with electron-updater.
- **B15. Agent extras.** Image results from `local_read` for vision models, waking the Bot when a background task finishes, attachments in the composer, background subagents for parallel research within one Bot.

## Phase 3: Computer control (deferred)

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
- Remaining B13 work: Bot templates. B13d usage evidence is implemented in its independent review branch. Cross-group/direct-chat peer dispatch, selective memory transfer and full data purge require separate specs; agent execution continues to reuse Pi.
- [D2: Grok UI research](tasks/d2-grok-ui-research.md): complete, including installed 0.71.2 client inspection.
- [B21: Conversation experience](tasks/b21-conversation-experience.md): merged in PR #17; shared private/group shell, contextual details, local filtering/New, durable local drafts and send recovery, keyboard mentions, scroll preservation and compact task activity. English/Chinese; 229 unit tests and 54 background e2e; isolated real-model private chat, Core delegation/result return and explicit @.
- [B22: Conversation list previews and unread state](tasks/b22-conversation-list.md): implemented, awaiting review; 234 unit tests and 59 background e2e; isolated real-model private/group replies and full restart verification; local Host index, snapshot-bound durable read cursors, bilingual previews/time/counts, draft/activity precedence and recency within protected Core/pinned sections.
- [B23: Conversation search and unread filtering](tasks/b23-conversation-search.md): implemented, awaiting review in PR #20 (stacked on B22); 239 unit tests and 65 background e2e; isolated real-model private/group history search and full restart; local literal matching, bounded results, unread composition, bilingual exact-message navigation, stale-response guards and draft/read preservation.
- Remaining UI work: group pin/hide, manual mark-unread, transcript virtualization, large-history search indexing and artifact previews require separate specs.

## Application capability foundation (D3)

Owner-requested architecture increment: expose selected current application capabilities to Core through an authorized shared Host layer, then local programmatic composition. [D3](tasks/d3-app-capabilities.md) records source research, authority, module boundaries, budgets, recovery and privacy. B24 implements the first authorized read slice.

1. [B24: Authorized application API](tasks/b24-app-capability-api.md) — merged into `main` via PR #23; five shared typed read services, scoped search/history and Core routed tools. 246 unit tests, 68 background e2e and isolated real-model private/group/restart verification.
2. [B25: Local app Code Mode](tasks/b25-local-app-code-mode.md) — merged into `main` via PR #24; bounded Pi QuickJS/discovery/replay adapter, original Run authorization, durable bilingual activity and packaged worker assets. 259 unit tests, 69 background e2e, ad-hoc package and isolated real-model private/group/restart acceptance.
3. [B26: Code Mode management](tasks/b26-code-mode-management.md) — merged into `main` in PR #27; eight direct-Core management aliases, exact nested approvals, transactional receipt checks, failure latching, expiry and bilingual partial-completion activity. Acceptance is recorded in the spec.

Attention-state mutation, UI navigation, cross-Bot memory operations, new dispatch surfaces and external API transports remain separately specified follow-ups. Existing desktop method availability never automatically confers model authority.

## Usage delivery

- [B13d: Usage and execution evidence](tasks/b13d-usage-evidence.md): in review in [PR #33](https://github.com/VesperZephyr/OpenBot/pull/33), independently based on merged `main`. Reads Pi's model ledger without counting Code Mode children again, freezes Run intervals with admission/settlement, preserves known-price estimates and distinguishes unavailable prices, and links private/group results and approvals from bilingual Bot details. Final acceptance is recorded in the spec.
## Post-B26 artifact delivery

- [B15a: Bounded file inputs and result artifacts](tasks/b15a-bounded-artifacts.md): implemented, in review in [PR #30](https://github.com/VesperZephyr/OpenBot/pull/30), targeting `main`. 293 unit/Host tests, 79 full background e2e tests, six final artifact scenarios and isolated real-model text/image/publication/export/restart acceptance. Private text/image input, durable local copies, result cards, exact group result publication, safe preview/export/removal and spill quotas. B14a PR #29 remains independent.
- Native packaged evidence remains a release gate; validation stays in isolated background apps.
## Post-B26 implementation

- [B14b: Lifecycle gates](tasks/b14b-lifecycle-gates.md): implemented on `task/b14b-lifecycle-gates`, in review. 301 unit/Host tests, 80 full background e2e tests, seven final lifecycle scenarios, bundled runtime startup and isolated real-model interruption/continuation passed. Global sidebar Pause all, durable queue retention, native handshake and lock/sleep/quit gating, executor quiescence, explicit private continuation, and group-chain interruption. Unexpected Host crashes preserve the existing replay contract; intentional quitting withdraws active approvals. Packaged native lock/sleep acceptance remains a release gate.
- I1 integrates the independently reviewed B14a/B15a/B14b/B12a/B13d heads while preserving observation guards, immutable attachment references and interruption settlement.

## Deterministic policy delivery

- [B12a](tasks/b12a-deterministic-policy.md): implemented on `task/b12a-deterministic-policy`, dependent on B14b / PR #31. Target-bound revisions, atomic approval scopes, exact approval identity, conservative scoped revocation, unattended expiry and English/Chinese settings. 319 unit/Host tests and 84 full background e2e tests passed, with bundled startup and isolated real-model acceptance. Evidence is recorded in the task spec; the PR targets `main`, with prerequisite B14b merged first.

## Current integration gate

- **Done:** [I1](tasks/i1-product-foundation.md), [B10](tasks/b10-reviewed-skills.md), [B15b](tasks/b15b-background-completion.md) and [B9a](tasks/b9a-stdio-connectors.md) are merged in PRs #34–#37. I1 includes the reviewed B14a/B15a/B14b/B12a/B13d implementations. Their specs retain historical verification evidence.
- **B14e:** [Desktop-owned credentials](tasks/b14e-main-credentials.md) is merged in PR #38. It replaces Host command-line Keychain access with a native main-process owner, private broker, explicit migration and bilingual status. Automated/native acceptance and release limitations are recorded in the spec.
- **B9b:** [HTTPS MCP sessions](tasks/b9b-https-connectors.md) is merged in [PR #39](https://github.com/VesperZephyr/OpenBot/pull/39). 461 unit/Host and 120 hidden e2e tests, nine final connector scenarios and isolated real-model one-write/restart acceptance passed. Explicit TLS endpoints and private bearer credentials, bounded JSON/SSE, durable retry cooldown, honest unknown writes and bilingual connection/recovery controls.
- **I2:** [MVP acceptance and bilingual introduction](tasks/i2-mvp-acceptance.md) is merged in PR #40. The candidate including B9b passed 461 unit/Host and 122 hidden e2e tests, useful real-model report/memory/recovery checks, and an ad-hoc DMG build with signature and checksum verification. It includes a public product screenshot and English/Chinese README. It is an acceptance increment, not an expansion of the MVP feature scope.
- **Done (#42):** [I3 workflow acceptance](tasks/i3-workflow-acceptance.md) verifies the P1 workflow integration gate; [evidence](acceptance/workflow-2026-10-20.md) distinguishes captured research from unavailable live retrieval. Next: backup/restore, history scaling, templates and signed updates, each with its own spec. Developer ID identity, update continuity, native lifecycle and TCC remain separate release gates.

## Prompt reliability and memory research

- **In review (#43):** [B6a: Evidence-based Bot delivery](tasks/b6a-prompt-reliability.md). 479 unit/Host and 132 hidden desktop tests, inspected screenshots and a two-turn real-model report/unknown-write trial; [adoption/defer record](research/grok-prompt-adoption.md).
- **Memory delivery:** B27a implements topic attribution, owner corrections/forgetting and explicit shared scope. Retrieval and semantic contradiction handling remain separate research.
- Other prompt candidates remain in the adoption/defer record and do not enable excluded capabilities.
