# B28a message and fixed activity acceptance — October 31, 2026

Implementation candidate for [B28a](../tasks/b28a-messages-fixed-activity.md), [PR #73](https://github.com/VesperZephyr/OpenBot/pull/73). Owner review and merge are pending. B28b remains draft and is not implemented.

## Scope and integration base

The PR is stacked on `task/b28-message-status-design` at `24a006d`, keeping earlier documentation maintenance outside its implementation diff. That base must also be delivered before this work reaches `main`. It includes the existing B11e routine proposals and generated-file Library. Routine tools still omit `send_message`; ordinary Pi prose filtering preserves separately published routine reports. No vendor change, new package, executor protocol, remote Target, inference request or AI status generator is introduced.

Durable updates have atomic receipts and quotas. Canonical final answers remain Pi entries, with content-free visibility and outcome records committed alongside Run state. The shared projection drives history, search and lightweight message counts; fixed activity is process-local and derives from generation/dispatch observations. Recovery authority continues to come from current Runs, never historical display rows.

## Verification

- `pnpm run check`: package boundaries, both TypeScript projects, and 643 tests in 99 files passed.
- Full `pnpm run e2e`: 205 tests in 54 files passed in 347.46 seconds; hidden background windows only. Suite durations were refreshed from that full run with `node scripts/e2e-shard.ts --record e2e/.run/results.json`.
- B14c performance fixture passed: warm switch p95 70.8 ms, search p95 144.4 ms, live controls during rebuild p95 6.4 ms, cold launch/rebuild 9.13 s; maximum Pi batch 256 entries and worker batch 129 records / 61,155 bytes. Warm windows did not reread settled source history.
- Isolated agent-browser exploration used an additional hidden background fixture app: send an update, inspect command approval, approve once, observe “Waiting for result,” then Stop. The committed update remains and active loading disappears. The fixture was closed after exploration.
- Inspected screenshots: `e2e/.run/message-activity/01-update-approval-light.png`, `02-update-chinese-dark.png`, and `e2e/.run/b28a-explore/stopped.png`. English/light and Chinese/dark feedback, narrow layout, approval buttons and Stop remain readable. The scripted test also checks the status live region and reduced-motion CSS. Screenshots and execution logs are ignored local artifacts.

Earlier acceptance failures exposed a routine-report filtering error and two outdated test locators (Retry's new outcome row and the localized composer). These were corrected and the focused routine/message/background suites passed. New history test setup uses the existing 10-second readiness budget; no production history timeout was increased.

## Contract evidence

| Contract | Evidence |
| --- | --- |
| Bound publication, replay and quotas | [Host message tests](../../packages/server-core/test/messages.test.ts) reject wrong Target/Run/Bot/conversation, Code Mode children, extra fields, whitespace and oversized UTF-8 input; exercise replay/digest conflict, per-Run count quota and terminal rejection. [Persistence tests](../../packages/agent-runtime/test/message-persistence.test.ts) fill the byte quota, reopen, reject a new message and retain receipt lookup after Run pruning. Publication rechecks current group, background, lifecycle and authority state in its write path; existing Router/authority suites cover policy dispatch and revocation. |
| Canonical answers and crash recovery | Host tests resolve a Pi-settled/Host-not-recorded crash through existing recovery without another model request; shared-answer steers render once. Earlier successful answers remain when a later input fails. Restart/rebuild preserve original answer IDs and counts. Persistence tests retain legacy answers across cutover and represent an empty new-mode answer as an input outcome. |
| Durable errors and recovery | Host tests cover failure after an update, a later failed input, a later withdrawn steer, queued cancellation without Pi admission, repeated puts, pruning, interruption intent/settlement and successful resolution. The causal input supplies Retry; raw provider errors do not appear in public items. Existing Run/lifecycle/revocation/uncertain-action suites remain required regressions. Historical unavailable actions have fixed explanatory copy. |
| Group context and background destinations | [Model-boundary test](../../packages/agent-runtime/test/message-context.test.ts) inserts 16 group updates, verifies no new deliveries/automatic budget use, and checks the actual next request retains eligible user/final context while excluding those updates; dissolution fences publication. [Background desktop tests](../../e2e/background-completion.e2e.ts) send direct/group updates from continuations, keep the same root and one reserved automatic delivery, and retain suppression after stop/reset/dissolution. Existing collaboration suites cover child/result routing. |
| Activity identity and truthful labels | [Observation tests](../../packages/agent-runtime/test/execution-observations.test.ts) separate generation, phase, repeated polling calls, changed task and consumed-input identities; duplicate observations inside one call preserve identity and stale completion cannot overwrite a newer generation. [Message desktop tests](../../e2e/message-activity.e2e.ts) retain approval/Stop, use the conservative command waiting label, and count exactly the scripted main-model requests. Raw intermediate prose remains in the next model request while absent from chat. |
| History, reports and desktop behavior | The full run includes bounded-history scaling, search, unread/notifications, backup/restore, routine publication, artifacts, scrolling/drafts, lifecycle and Code Mode regressions. [Updated chat coverage](../../e2e/chat-streaming.e2e.ts) checks immediate fixed feedback, canonical Markdown after settlement, old reading anchors and group/Chinese/reduced-motion behavior. Successful message-tool receipts do not leave a duplicate tool bubble. |

## Limits

This is deterministic local acceptance on macOS, using isolated fixture databases, workspace and Keychain service. No owner data or real provider was used. Real-model update quality, VoiceOver interaction, signed/packaged installation, native lifecycle behavior on a sleeping/locked Mac, and release/rollback compatibility are not established by these tests. Browser/computer control and B28b AI phrasing remain separate tasks.
