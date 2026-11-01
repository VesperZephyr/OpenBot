# B28a message and fixed activity acceptance — October 31, 2026

Original implementation evidence for [B28a](../tasks/b28a-messages-fixed-activity.md), delivered through [PR #73](https://github.com/VesperZephyr/OpenBot/pull/73) and [PR #74](https://github.com/VesperZephyr/OpenBot/pull/74). The November 1 review corrections are tracked in [PR #75](https://github.com/VesperZephyr/OpenBot/pull/75), with owner review and merge pending. B28b remains draft and is not implemented.

## Scope and integration base

The original PR was stacked on `task/b28-message-status-design` at `24a006d`, keeping earlier documentation maintenance outside its implementation diff. That base was delivered to `main` through #74 (`d6bab2c`). The review-correction branch starts there; its tree matches the original implementation candidate before these fixes. It includes the existing B11e routine proposals and generated-file Library. Routine tools still omit `send_message`; ordinary Pi prose filtering preserves separately published routine reports. No vendor change, new package, executor protocol, remote Target, inference request or AI status generator is introduced.

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

## Review corrections — November 1, 2026

The follow-up review identified three implementation gaps: unavailable history hid Continue, artifact-only canonical answers were omitted from incoming/search projections, and a committed update could retain a cancelled tool bubble when cancellation preceded Pi's result commit. These boundaries supersede the original acceptance claims above.

- Recovery controls use current Host authority and stable outcome identity even when a history window is unavailable, building or missing that outcome. The fallback is removed when the corresponding row is present. The follow-up self-review also found and closed the equivalent missing Retry fallback; it uses the Host-provided causal input without inventing a Run identity or another recovery authority.
- Artifact-only assistant answers use result filenames for indexing while retaining the canonical answer ID and empty answer body. Existing messages with text retain their preview behavior. The disposable history source version advances to rebuild earlier projections; no canonical format changes.
- Message projection checks the existing durable invocation receipt and removes an already-indexed tool row at publication. Cancellation does not retract the update or show a second failed delivery; unpublished failures retain tool evidence.

[Pi-to-Router integration coverage](../../apps/local-server/test/execution-identity.test.ts) drives the real Pi runtime, Host service and Router with scripted model and executor ports. It checks two separate polls of the same task with the same consumed input, intervening model requests, repeated progress within one call, accepted versus consumed steers, changed task IDs, sequential Code Mode children and cancellation cleanup. It also holds message publication before and after commit, then cancels before Pi's result commit and verifies live projection, incremental history, rebuild and reopen. The main-model request count remains exactly the scripted count.

[History control scenarios](../../e2e/history-controls.e2e.ts) exercise both Continue and input-specific Retry while history is unavailable/building, deduplicate the recovered action, and verify the action actually resumes/retries work. [Message scenarios](../../e2e/message-activity.e2e.ts) verify artifact-only unread/preview/search identity through rebuild and restart, and retain one update plus the stopped outcome.

Final verification after the runtime/UI changes:

- The initial `pnpm run check --maxWorkers=4` passed all 647 tests, but did not resolve the default-concurrency history timeout. The investigation below supersedes that workaround. New multi-stage integration tests use 15-second case budgets and the existing 10-second history readiness budget.
- Full `pnpm run e2e`: all 211 tests in 54 files passed in 313.97 seconds, using background isolated apps. Shard durations were refreshed from this full run. The new desktop regressions also passed focused runs; an ambiguous test sidebar locator was corrected to select the exact Bot name.
- B14c gates passed: switch p95 70.7 ms, search p95 148.8 ms, live controls p95 6.1 ms and cold rebuild/launch 8.81 s. Maximum Pi/worker batches remained 256 entries and 129 records / 61,155 bytes.
- Inspected the current artifact-only answer, retained update after Stop, Chinese/dark narrow activity, unavailable/building recovery controls and recovered single-action screenshots under `e2e/.run/message-activity/` and `e2e/.run/history-controls/`. `git diff --check` and documentation relative-path checks passed.

Final spec/code self-review found no further blocking omission, excessive abstraction or module-boundary conflict in these corrections. Recovery still uses current Host authority; filenames do not replace canonical answer content; receipt reads remain indexed; unpublished failures remain visible. No scheduler settlement semantics, canonical persistence format, Pi vendor code, executor protocol or B28b inference work changed. The corrections remain unmerged for owner review in #75.

## Default-concurrency readiness investigation — November 1, 2026

The failures are cold-start synchronization failures in functional tests, not evidence of a sustained projection slowdown. Source-worker startup does have real overhead. These tests started a fresh TypeScript worker per runtime and allowed only Vitest's default one-second `expect.poll` budget; `submitAndWait` settles Pi input, not the independently scheduled disposable index. Host tests also began polling before message admission. The bundled desktop worker follows a materially cheaper startup path.

Measured on the same Apple M3 Pro / 36 GiB Mac, Node 22.22.2, under ordinary interactive background load. Vitest 4.1.11 resolves the unmodified run configuration to ten workers from eleven available CPUs. No worker limit, artificial CPU load, concurrent e2e run or production setting was used for the full-suite reproduction. One uninstrumented run passed; four temporarily instrumented full runs produced two passes and two runs with Host readiness failures. Instrumentation recorded only times, test identities and entry counts, and was removed before final validation.

In the failing run, the original assertion was retained. A diagnostic-only second wait observed recovery, then rethrew the original timeout. All three failures occurred before the worker had completed module loading:

| Functional case | Worker construction → ready | Worker online → modules loaded | First selected partition projection | Poll start → answer observed |
| --- | ---: | ---: | ---: | ---: |
| Eligible search/unread | 1,130 ms | 964 ms | 9 ms | 1,215 ms |
| Subscribed Bot updates | 1,026 ms | 969 ms | 26 ms | 1,269 ms |
| Profile duplication | 1,090 ms | 981 ms | 47 ms | 1,228 ms |

Each direct input had only five source entries. The earlier routine failure did not recur in these traced runs, but the same cold-start boundary reached 956 ms against its one-second budget: 885 ms worker startup, including 841 ms module loading, versus 15 ms across projection passes for three entries. Running just the two originally affected cases observed readiness in 362–364 ms. No worker restart or index unavailability occurred; source pages in these cases contained zero to five entries.

A separate fresh-database startup probe compared the existing source worker with the desktop build's `history-worker.mjs`. Single-worker startup was 272 ms versus 27 ms; ten simultaneous workers took 425–427 ms versus 42–54 ms. These small diagnostic samples explain the source-test overhead; they are not product latency percentiles or a replacement for the B14c fixture. No import/package split or worker optimization is justified by this failure alone. Revisit that decision if the bundled path or fixed performance fixture regresses.

Corrections are limited to tests:

- Await the actual ready window containing the answer after message admission, and assert against that same returned window instead of issuing a second independent read.
- Give only the affected functional waits the existing ten-second readiness budget and their containing cases fifteen seconds. Keep default test concurrency and all B14c performance thresholds unchanged.
- Add a promise-gated worker-start integration case: real Pi model work must settle while history reports `building`; releasing the worker must index exactly one user input and answer. It uses no wall-clock sleep and prevents coupling Run completion to index startup as a workaround.

Final validation after removing all instrumentation and correcting the new test's runtime type:

- Unmodified `pnpm run check` concurrency: one complete pass (648 tests / 100 files, 46.17 s). Two further complete attempts kept every history-readiness case green but failed outside these edits: the first hit the artifact-pagination case, output-file cleanup hook and aged-Run case (76.15 s); the latest hit only artifact pagination's existing five-second case limit (64.60 s). The three affected files separately passed all 36 tests. Their assertions, budgets and implementations were not changed. The latest full check is therefore **not green**; whole-suite load sensitivity remains unresolved outside this correction.
- `pnpm exec vitest run --config e2e/vitest.config.ts e2e/history-scaling.e2e.ts`: all four cases passed in 29.85 s against the existing desktop build; runtime sources are unchanged from the earlier full 211-case acceptance. B14c results: window switch p95 87.1 ms, search p95 152.8 ms, controls p95 1.6 ms, cold launch/rebuild 9.71 s; Pi/worker bounds remained 256 entries and 129 records / 61,155 bytes. Inspected `03-rebuilt-latest.png`. The earlier full e2e evidence above still applies; this follow-up did not rerun the entire desktop suite or replace shard timings with partial results.
- `git diff --check` and the changed documents' relative links passed.

Self-review: the change preserves all content, authorization and unread assertions, removes the second-read race and leaves finite waits. The gated regression protects independent model/index progress without sleeping or delaying production startup. No runtime code, public contract, canonical storage, worker pool setting or performance threshold changed. There is no new architecture conflict or proposed performance framework. The source-startup optimization decision remains contingent on measured bundled-path or B14c regression. #75 stays in review, with the wider-suite timeout limitation explicit; B28b remains draft.

## Limits

This is deterministic local acceptance on macOS, using isolated fixture databases, workspace and Keychain service. No owner data or real provider was used. Real-model update quality, VoiceOver interaction, signed/packaged installation, native lifecycle behavior on a sleeping/locked Mac, and release/rollback compatibility are not established by these tests. Browser/computer control and B28b AI phrasing remain separate tasks.
