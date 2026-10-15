# OpenBot Backlog

Work after the tools demo, cut into batches that can each be finished and verified on their own. Each batch lists its tasks, the acceptance that closes it, and the references worth reading first. Order matters only where a batch says **after**.

The [architecture](architecture.md) defines the contracts; the [technical plan](technical-plan.md) records current state and milestone scope. When a batch lands, move its items into the plan's current-state table and delete them here.

References used below:

- **MCode**: `~/minimax-ai/minimax-code` (MiniMax Code). Study, do not copy; its known gaps are noted where they matter.
- **Grok Bot**: [docs.x.ai/grok-bot](https://docs.x.ai/grok-bot/overview) and the leaked prompt at `~/github/system_prompts_leaks/xAI/grok-bot.md`.
- **Pi**: `~/github/pi/packages/coding-agent` for the reference coding-agent tools and `models.json`.

## Demo baseline (done)

A Bot chats through any configured model and uses `local_read`, `local_list`, `local_write`, `local_edit`, `local_exec`, and `web_fetch`. File tools run without asking inside the shared workspace (`~/OpenBot`, or `OPENBOT_WORKSPACE`); outside it they ask, and an approval grants that one path for that one call. Every command asks. Calls go Pi tool → `ToolInvoker` → Tool Router (policy, approval) → executor process (grant re-check, process groups, scrubbed environment) or a Host handler. The transcript shows Markdown, one row per tool call, and an inline **Allow once / Deny** card; the sidebar shows **Needs attention** while an approval waits.

Known demo shortcuts, each owned by a batch below: approvals and executor receipts live in memory (B1); `local_exec` has no background mode (B3); there is no `web_search` (B4); Stop cancels the whole Run only (B2).

## B1. Durable approvals and receipts (M1 completion)

Make the safety story hold across restarts. Architecture Sections 5.1, 6.2, 8.2. **Spec: [tasks/b1-durable-approvals.md](tasks/b1-durable-approvals.md) (ready).**

- Persist pending approvals as an OpenBot document before the call waits; on restart, a rerun of the same Pi tool task finds its approval by `approvalId` and waits on it instead of asking again.
- Executor receipt ledger: `node:sqlite` file under `<data>/executor/`, acceptance recorded before the side effect, terminal receipt after, kept until the Host acknowledges (`result.ack`).
- Recovery gate: on Host start, reconcile accepted-but-unfinished invocations with `tool.status` before `runtime.resume()`. Accepted without a receipt becomes `unknown` and the Bot shows **Needs attention**.
- Executor crash mid-command: the Host resolves the call as `unknown` (already done in memory); persist that outcome and surface it.
- Parent-death guard for commands so a killed executor does not leave orphaned process groups. Reference: MCode `pi-mono/.../utils/shell.ts` `armParentDeathGuard`.
- Acceptance (architecture Section 10, M1): kill the Host while an approval is pending, restart, approve, and the command runs exactly once; kill the executor during `sleep 30` and the call ends `unknown`, not retried.

## B2. Runs, cancellation, and steering (M1 completion)

Architecture Section 7.2. **Spec: [tasks/b2-runs.md](tasks/b2-runs.md) (ready).**

- OpenBot Run records: `runId` from `messages.submit`, states from Section 7.2, global active-Run cap (default 3) with a per-conversation queue.
- `runs.cancel` by `runId`; cancelling a tool cancels its executor invocation and reports confirmed termination or `unknown`.
- Sending while a Bot works redirects the current turn (`whenBusy: "steer"`), as Grok Bot does; a plain queue remains the default for routines later.
- Composer: Stop while a Run is active (exists), a short "queued" state, and a denied-approval note in the transcript.
- Acceptance: two Bots run in parallel up to the cap; cancelling one leaves the other running; a steer message changes the current turn's direction.

## B3. Coding-agent quality tools (after B1)

Bring the tool set up to what users expect from a coding agent. Reference: MCode `agent-tools/src/desktop/builtin-defs.ts`, `output-limit.ts`, `shared/read-guards.ts`; Pi `coding-agent/src/core/tools/`.

- `local_grep` (ripgrep, sensitive-file exclusions) and `local_glob`; keep them inside grants.
- Structured truncation with a continuation hint in tool details (`next_offset`), spill large command output to an artifact file and return its path.
- `local_edit`: optional `expected_sha256` check (architecture requires an expected-content check); fuzzy-match fallback with a disproportion guard; uniqueness error lists line numbers.
- `local_exec`: background mode (`run_in_background`, `task_output`, `task_stop`), soft yield to background after 60 s, managed timeouts. Throttled progress is already streamed.
- Device and binary guards before open (done for regular files; add device path blocklist).
- Images: `local_read` returns images for vision models; transcript renders image results.
- Acceptance: a real-model task finds a function across a repository, edits it with a hash check, runs tests in the background, and reports the result.

## B4. Web research (M3, part)

- `web_search` Host tool with a configurable provider in `~/.openbot/settings.json` (or `models.json` sibling) and a Keychain key; start with one provider.
- `web_fetch`: `retrieval_outcome` labels (`usable_content`, `not_found`, `access_challenge`, `auth_required`, `dynamic_page`) borrowed from MCode `local-webfetch.ts`; keep the private-address block (MCode allows localhost; OpenBot must not).
- Prompt guidance: search misses do not prove absence; cite opened pages, not snippets.
- Acceptance: a Bot researches a topic, cites the pages it opened, and saves a report in the workspace.

## B5. Policy rules and Always allow (M5, part)

Architecture Section 5.3. Reference: MCode `agent-modules/permission/src/tools/bash-rule-match.ts`, `CandidateScope`, `tui/.../permission-picker.ts`; Grok Bot **Auto-review** settings.

- Persisted Ask first / Allow automatically rules: tool, target, optional Bot, argument predicate (command argv prefix, path glob, URL origin).
- Argv-prefix rules match only single plain commands; compound commands are split and every part must be allowed; Ask first wins.
- **Always allow** on the card offers narrow-first scopes and shows the exact rule before saving.
- Settings → Auto-review page listing and deleting rules; **Execution on Local Computer**: Ask every time / Always allow / Never.
- Read-only command allowlist (`ls`, `cat`, `rg`, `git status|diff|log`) as an opt-in default.
- Acceptance: Ask first overrides Allow automatically; Always allow creates exactly the confirmed rule; a compound command with one unapproved part still asks.

## B6. Desktop polish (M2)

- Per-method schema validation in main and the Host (decide TypeBox vs zod; TypeBox is already a dependency).
- Conversation subscriptions with `seq`, gap detection, and token-delta coalescing; stop broadcasting full snapshots.
- `app://` protocol, fuses, notifications for approvals and finished Runs (Grok: suppressed while focused), menu-bar count, `powerSaveBlocker` while Runs are active.
- Transcript: virtualization, code-block copy button, collapse consecutive successful tool rows into "Ran 4 steps", thinking blocks.
- Onboarding: first launch explains the workspace, asks for a model (BYOK or key), offers a first Bot and a first task (Grok Bot "Meet a future teammate").
- Per-Bot thinking level and Bot notifications toggle; Duplicate and Delete in the Bot menu.
- Acceptance: architecture Section 10, M2.

## B7. Bot memory, groups, and handoff (M4)

Architecture Section 5.7. Grok Bot keeps memory as files in the Bot's computer; OpenBot keeps a memory document per Bot.

- Memory document, `memory_update` Host tool, memory panel.
- Group chats, `bot_message`, `bot_handoff` with request ID `handoff:<invocationId>`.
- Acceptance: architecture Section 10, M4.

## B8. Skills and routines (M5, rest)

- Skill library at `<data>/skills/<name>/SKILL.md`, `/` attachment, `skill_save` with confirmation.
- Routine scheduler with idempotent occurrence IDs, test run, coalesced catch-up; Grok Bot limits (50 per Bot, 5-minute spacing, 20 runs of history).
- Unattended approvals expire after 10 minutes.

## Later milestones

M3 managed browser, M6 desktop computer use, M7 MCP connectors, M8 voice and teach-a-task, and M9 packaging follow the plan in [technical-plan.md](technical-plan.md) Section 3. Start a signed-packaging spike early (TCC attribution and Keychain placement cannot be verified unsigned).
