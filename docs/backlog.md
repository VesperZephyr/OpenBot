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

### MVP acceptance

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

- **B9. MCP connectors** (architecture M7). Executor-supervised stdio servers and HTTP sessions, credentials from the Keychain injected only into their own server, tools named `mcp__<server>__<tool>` through Tool Router with receipts, a Connect apps page. OAuth through the default browser comes after the first token-based connectors work.
- **B10. Skills.** Library at `<data>/skills/<name>/SKILL.md`, a `skills` prompt section listing names and descriptions, `skill_load`, `skill_save` with user confirmation, `/` in the composer to attach one.
- **B11. Routines** (after B2). Scheduler in `server-core` with occurrence request IDs `routine:<id>:<scheduledAt>`, a fresh conversation per occurrence admitted through B2's queue, test run, coalesced catch-up after sleep, Grok Bot limits (50 per Bot, 5-minute spacing, 20 runs of history), `routine_propose` with a confirmation card.
- **B12. Full Auto Review.** Ask-first rules (always win), argument predicates for URL origins and connector tools, an optional model reviewer that can only escalate, 10-minute expiry for approvals raised by unattended work.
- **B13. Bots together** (architecture M4). Group chats with mentions and a lead Bot, `bot_message`, `bot_handoff` with request ID `handoff:<invocationId>`, templates (export and import without memory, history, credentials, or grants), usage per Bot from `pi.usage`.
- **B14. Desktop completion** (architecture M2 rest). Subscriptions with `seq`, gap detection and backpressure, `Cmd+K` search, menu-bar app with running Bots and **Pause all**, Normal and Verbose tool detail, transcript virtualization, login item, Keychain moved out of the `security` CLI, auto-update with electron-updater.
- **B15. Agent extras.** Image results from `local_read` for vision models, waking the Bot when a background task finishes, attachments in the composer, background subagents for parallel research within one Bot.

## Phase 3: Computer control

Architecture M3 (managed browser, takeover, secret requests), M6 (desktop computer use with the signed Swift helper and control lease), and M8 (dictation, teach-a-task). These need packaging and signing from B8 for TCC attribution; start with spikes before specs: two Bots' browser windows not throttled in the background, and the disclaimed helper receiving Screen Recording and Accessibility grants.
