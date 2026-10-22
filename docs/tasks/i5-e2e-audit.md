# Desktop regression coverage audit

Baseline: D7 commit `49ac0ff`, 43 files / 153 cases. CI job [119865277209](https://github.com/VesperZephyr/OpenBot/actions/runs/39790591958/job/119865277209) passed in 675.54 seconds of Vitest execution; its e2e build is additional. The same revision passed locally in 510.14 seconds. Screenshot upload took about four seconds and is not the bottleneck.

## Removed duplication

Remove four cases and the separate Electron launch in `app.e2e.ts`. Preserve the checks in existing flows:

| Removed case | Retained coverage |
| --- | --- |
| Chooses a configured model and creates a Bot | `createBot` is exercised throughout the suite; `core-bot` explicitly verifies user creation and Core ordering; `model-sources` verifies model selection. |
| Writes a workspace file and renders Markdown | `desktop-mvp` already runs two writes and a read without approval. It now also checks exact file bytes, bold Markdown and absence of approval. |
| Runs a command only after Allow once | `mvp-acceptance` checks no side effect before approval and verifies calculated outputs afterward. Exact approval arguments and Needs attention assertions are carried over. |
| Denies a command and tells the model | `mvp-acceptance` already denies a real write and verifies no file after restart. It now also checks failed-tool rendering and the denial result sent to the model. |

These are duplicated scenarios, not evidence that the corresponding product behaviors are unimportant. Remaining count: 42 files / 149 cases.

## Retained coverage inventory

All remaining suites stay in the default regression. Similar-looking cases protect different boundaries:

| Suites | Unique purpose retained |
| --- | --- |
| desktop-mvp, core-bot, model-sources, locale | Onboarding, renderer schema boundary, duplicate/delete UX, Core protection, provider configuration, localization persistence |
| personal-design, themes, chat-interaction | Profile/avatar normalization and conflicts, approved composition screenshots, rendered theme contrast, appearance persistence, composer and explicit continuation UX |
| conversation-experience, conversation-list, conversation-search | IME/mentions/drafts/scrolling, read cursors and badge limits, historical pagination and stale-result races |
| bot-quality, memory-controls, memory-provenance, role-skills | New-topic prompt boundaries and Retry, editable memory versions/conflicts, shared-memory provenance, pinned method revisions |
| runs, recovery, lifecycle, product-foundation, observation | Slot admission/steering, process crashes, OS lifecycle/global pause, continuation with attachments/usage, renderer reconnect and retained search context |
| always-allow, deterministic-policy | Persisted rule UI, precedence and scoped revocation of foreground/background commands, unattended expiry |
| bot-management, groups, collaboration | Approved management effects, group routing/membership, nested task ownership/cycles and scoped cancellation |
| app-capabilities, code-management | Read-tool visibility, responsive sandbox execution, nested approvals and durable management receipts |
| artifacts, coding-tools, background-completion | Native selection and immutable exports, foreground-to-background yielding, automatic completion routing and suppression |
| connectors, https-connectors, credentials, web | Stdio and HTTPS transports, session/unknown-effect behavior, native key storage/migration/denial, configured web search |
| background, login-path | Silent test windows and native side effects, Finder-style environment resolution and redaction |
| usage | Pricing estimates, interrupted and Code Mode accounting, group attribution |
| routines | Reviewed scheduling UI, unattended approvals, one scheduled report from a due persisted occurrence |
| mvp-acceptance, workflow-acceptance, prompt-reliability, role-memory-workflow | Cross-feature acceptance: real calculations/export; connector/skill/routine recovery; untrusted-source correction; memory/method isolation across roles |

The 100-reply unread test and 34-result search test remain: they cross real badge and pagination boundaries. The short read-acknowledgement waits remain because they assert that a delayed side effect does **not** occur. Crash/relaunch cases remain where persistence or process-boundary behavior is the point of the test.

## Execution changes

- The scheduled-routine case used to wait 30–90 seconds for the next wall-clock minute. It now seeds a due interval occurrence through the runtime store with the Host closed, then launches the real scheduler, model and executor. It still asserts `test: false`, exact `scheduledAt`, one published occurrence, and the missing-source result. Calendar/DST math remains in `routine-schedule.test.ts`; cursor/overlap/catch-up invariants remain in `routines.test.ts`. A timer-driven unit case advances the interval clock and observes admission without calling `sweep`, retaining periodic-wakeup coverage without a real-minute wait.
- Two files may run concurrently in background mode. Each uses a unique suite directory, model/connector ports and Keychain service. Stateful cases within a file remain sequential. Headed mode stays serial. The single clipboard test has no concurrent suite writing the clipboard; process-kill cases target their own Host/executor or workspace.
- JSON results include file and case timing and are uploaded with the existing screenshots. No timeout reduction, automatic retries, exclusions or skipped suites are used to manufacture a passing result.

## Measurements

Two full local runs passed all 149 cases in 232.30s and 230.38s, versus the 510.14s baseline (54.5–54.8% shorter). The scheduled case took 3.97s / 3.94s. Verification details are recorded in [I5](i5-e2e-efficiency.md). CI speed remains unverified until the new branch runs on its macOS runner; local improvements must not be presented as a measured CI result.
