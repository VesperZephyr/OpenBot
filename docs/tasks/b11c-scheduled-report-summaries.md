# B11c: Scheduled summaries of routine reports

Status: done (integrated through I6 / PR #57); original verification retained below
Branch: task/b11c-scheduled-report-summaries
Depends on: B11b (merged into main in PR #53). I6 carries this implementation into main.

## Goal and product boundary

The owner requests a daily main-assistant summary of two researcher reports without a daily user message. Read-only Grok Bot inspection on 2026-10-23 showed the main Bot's named daily routine at 07:47 and a later group summary acknowledgement. This is interaction evidence, not a backend specification. Do not copy private transcripts or seed those personal roles into the application.

Bots are configurable identities with instructions, memory and models. The existing protected Core is the user's main assistant; Domestic Hunter and International Hunter are user-created Specialists. The application provides generic schedules, confirmed report inputs, bounded waiting, durable snapshots and report delivery. Names, product lists, comparison criteria and schedules belong to user configuration. No radar-specific tool, hardcoded Bot, implicit peer trigger or additional coordinator Bot is introduced.

## Contract

- A routine may select `reportInputs: { sources: { routineId, revision }[], windowHours, waitMinutes }`. One to six distinct non-summary routines must publish to the same confirmed group and group revision as this routine. The owner confirms their identities and revisions. All owning Bots, including Core, must be active members of that group. Select 1–72 lookback hours and 0–60 grace minutes. Omission preserves B11a/B11b behavior.
- Only one level of report composition is supported. A summary cannot select itself, another summary, a private routine, a deleted/paused/blocked source, or a source in another group. Source edits/pause/delete invalidate dependent authority and pause summaries atomically; explicit edit/reconfirmation is required. Group changes keep B11b's atomic destination revocation.
- Each occurrence freezes this configuration and its reporting interval `(scheduledAt - windowHours, scheduledAt]`. Choose the latest occurrence matching the confirmed source revision by its scheduled time, not publication time. Production excludes test reports. A summary test may include source tests and labels them explicitly. No older fallback is substituted when the latest occurrence failed or is still pending.
- Before admission, the Host atomically captures bounded report text and provenance from the confirmed group's published posts, plus missing/pending/failed/skipped statuses from retained occurrence metadata. Include source Bot/routine/occurrence/post identities, original scheduled time, test/state flags, capture time and truncation. At most 8 KiB per source, six sources; no arbitrary private/group conversation history, attachment bytes or extra read capabilities.
- While a selected input is missing or pending, wait without model requests or a Run slot until `max(scheduledAt, createdAt) + waitMinutes`. This allows bounded catch-up after waking. If all inputs are terminal, proceed immediately; at the deadline proceed once with explicit partial/missing statuses. Zero grace proceeds immediately. The fixed snapshot is persisted before Run admission and reused after restart or lost admission responses. Later reports do not cause a second summary or mutate an admitted input.
- Input report text is untrusted data. The Host prompt identifies source status, time window and truncation, forbids treating missing/failed inputs as no update, and asks the selected Bot to apply the user's workflow while preserving primary citations. It grants no tools or dispatch authority. Existing execution policy, lifecycle, cancellation and output bounds still apply.
- B11b publication remains atomic and attributed to the selected summary Bot. Source invalidation blocks pending or settled-unpublished summaries. Completed summaries remain readable. History shows the exact frozen source text/status and links to available source group posts; snapshots survive source history pruning while the summary occurrence is retained.
- The bilingual routine editor offers optional report inputs when a group destination is chosen, source selection, lookback/grace controls and explicit review. Detail/history shows waiting, partial inputs, provenance and blocked-source recovery. Group details continues to expose all configured schedules. No daily user message is required after one-time configuration.

## Steps and acceptance

1. Extend protocol/schema and runtime persistence; test exact source authority, cycles/private/cross-group rejection, atomic revocation and immutable bounded snapshots.
2. Gate existing scheduled admission on source readiness/deadline. Test missing/late/failed inputs, scheduled-time windows, exclusion of test data, catch-up, no older fallback, restart and publication deduplication.
3. Extend the current routine editor/detail and translations. Script UI creation/review, two reports followed by Core's scheduled summary without a user message, waiting/partial inputs, source navigation and restart.
4. Update architecture, plan/backlog, bilingual README and the competitor workflow, keeping configured Bots distinct from application capability. Run `pnpm run check`, `pnpm run e2e`, inspect screenshots and explore an isolated background app with agent-browser. Keep any real-model spot check bounded and separately labelled.

## Implementation and verification

The protocol and runtime store optional source references and captured inputs. `routine-inputs.ts` selects published report text and retained occurrence status; `routines.ts` captures before Host admission and atomically invalidates dependents when sources change. Desktop exposes optional inputs, review, waiting/partial status, captured text and source-post navigation. Newly published source posts carry their routine revision, so selection remains valid after occurrence pruning. Legacy posts without a revision are eligible only while their retained occurrence proves the confirmed revision.

- `pnpm run check`: **519 tests in 77 files passed**, including seven new report-composition scenarios. These cover source authority, unavailable inputs, latest-failure selection, test exclusion, scheduled windows, catch-up grace, atomic unpublished-output revocation, UTF-8 bounds, pruning and restart deduplication.
- Focused `e2e/routine-summaries.e2e.ts`: **4 scenarios passed**. An actual calendar trigger produces two researcher reports and Core's summary without a message or test action, including a delayed input. Additional checks cover exact source navigation, Chinese coverage, partial inputs, waiting across restart and source invalidation. `pnpm run e2e` passed **161 tests in 45 files** in 548.92 seconds. The six generated summary screenshots were inspected, including English review/wait/captured inputs, Chinese group coverage, partial input and blocked-source recovery.
- Isolated real-provider spot check: `group-radar.mts --summary`, `claude-sonnet-5-5`, **five inference requests** (two per researcher, one summary), within a 12-request/4,096-output-token cap. WorkBuddy and Claude Code official sources were fetched; Core preserved both primary URLs and distinguished test inputs, undated releases and interpretation. Three attributed posts survived restart without duplication. This uses explicit test runs; it does not claim a live 07:47 production trigger or validate the entire source catalogue.
- Isolated agent-browser exploration opened Core's result, inspected both captured inputs and followed the exact source-post action. Screenshots and transient evidence remain ignored under `e2e/.run/`; the temporary model configuration is removed after teardown. Owner data and installed Grok Bot configuration were not changed.
- One-time workflow setup is documented in [Competitor radar](../workflows/competitor-radar.md), with two created Specialists, the existing Core, suggested 07:10/07:15 research and 07:47 summary times, 24-hour inputs and a 20-minute grace. Model quality remains provider-dependent. OpenBot and the Mac must be available; existing lifecycle and inactivity gates still apply. Packaged native release gates are unchanged.

## Open questions

None. Automatic re-summaries after a late report, arbitrary dependency graphs, conversational routine proposals and additional publication destinations remain separate work.
