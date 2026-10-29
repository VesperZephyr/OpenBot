# B11e: Bot routines and generated-file Library

Status: implemented; verification tracked in PR #69; owner merge pending
Branch: task/b11e-bot-routines-library
Depends on: B11a–d, B15a, D9/D10, B14c
Architecture: Sections 4.2, 5.2, 5.8, 6.1

## Goal

Expose scheduled AI work and generated files from each Bot's details. The Bot page emphasizes viewing, opening and switching routines; creation begins with an AI proposal in chat. A direct chat can prepare a routine for explicit review; saving uses the existing scheduler and authority contracts.

## Scope

In: Bot-scoped routines entry, create/edit/history navigation, confirmed pause/resume, generated-file Library with search and existing preview/export/removal; conversational creation proposals; integrated-test stabilization and CI parallelization.
Out: Computer, browser control, cloud scheduling, new schedule kinds, conversational editing, automatic filesystem discovery and new grants.

## Design and contracts

- Keep the existing profile and memory tabs, adding Routines and Library in the same details surface. Reuse the complete routine editor for configuration review, confirmation and history with the current Bot selected. Hide manual creation in the Bot-scoped view; preserve the existing global Settings workflow. Show timezone, state and next run in the Bot list.
- `routine_propose` is a Host tool with capability `routines`. It accepts existing RoutineFields, excluding group destinations and report inputs. Bind the Bot and target to the active direct user Run. Bound serialized proposal fields to 24 KiB and show arguments only once in the history projection so the interactive card stays within the 32 KiB row limit. Validate fields and pinned skills before returning a structured `RoutineProposal { requestId, botId, fields }` in the ToolOutcome and transcript. It never changes scheduler state. Unattended and group work cannot propose routines.
- Derive the proposal request ID from the trusted conversation/call identity. Preserve the structured proposal in Pi tool-result details; never parse assistant prose into an executable proposal. Review opens the existing routine editor. Confirmation uses the proposal request ID with `routines.change`; repeated confirmation reuses its receipt. Editing proposal fields creates a fresh reviewed request identity. The model must say confirmation is pending, never claim a schedule exists before confirmation.
- Add optional trusted `botId` provenance to result ArtifactRef metadata at executor publication. Existing refs without provenance remain valid and available in Shared files; do not guess their author. Imports do not get result provenance. Publication retries retain the original receipt.
- Extend `artifacts.list` and its private operation with optional source and botId filters, applied before the existing bounded pagination. The Library requests source=result and its Bot ID, never rescans transcripts or filesystem paths. Filtering is organization, not isolation. Existing file reader and immutable-copy behavior stay authoritative.
- Do not change Pi vendor code or package boundaries. Keep English source copy and Chinese locale entries.
- Timeline restoration uses virtualizer scroll commands so its end target survives asynchronous row measurements and window replacement. User scrolling cancels an in-flight restoration. Preserve bounded history windows and older reading anchors.

## Steps

1. Extend artifact provenance/filter contracts and executor tests.
2. Add validated, routed proposal handling and structured transcript projection, with direct-user authority tests.
3. Add Bot details tabs, scoped routine navigation, proposal review and Library using existing UI components.
4. Extend scripted hidden desktop acceptance, run full check/e2e, inspect screenshots and explore an isolated app with agent-browser. The shared ScriptedModel HTTP reader must decode UTF-8 across network chunks so multilingual acceptance observes the actual provider input.
5. Update plan/backlog with implementation and verification; open one PR linked to this spec. Mark done only after merge.
6. Resolve the history-rebuild latest-message timeout blocking integrated acceptance. Preserve bounded indexing, reading anchors and live controls; add a deterministic regression for the identified race rather than increasing timeouts. Rerun full check/e2e and update this PR without merging.
7. Optimize integrated CI while retaining full coverage: run check independently alongside three desktop shards on separate macOS runners, retain the existing aggregate required-check name, upload each shard's evidence and report slow suites. Advance the template lost-response recovery test with a controlled renderer clock while asserting all ten status queries; retain real Host persistence/restart and all recovery assertions.

## Acceptance

1. Executor tests prove Bot/source filtering before pagination, legacy compatibility and provenance persistence/replay.
2. Host tests reject invalid schedules, wrong targets and non-direct/non-user origins; proposals do not create schedules.
3. Hidden desktop: chat proposal creates no routine until review/confirmation, repeated review does not duplicate; saved routine survives restart, is scoped to its Bot, and pause/resume/history work.
4. Hidden desktop: published direct and routine files appear in the owning Bot Library; another Bot and input attachments are excluded; search, preview/export/removal and restart use immutable copies. Empty states and Chinese minimum-size layout are checked.
5. Full `pnpm run check` and `pnpm run e2e` pass; screenshots and isolated agent-browser exploration are recorded. Native release gates remain separate.

## Risks

Legacy files have no author metadata and remain in Shared files. Stale async reads must not replace a different Bot/search page. Proposal identity must survive replay and repeated confirmation without silent duplicate schedules.

## Verification — October 29, 2026

- `pnpm run check`: 92 files / 619 tests passed locally and on [macOS CI](https://github.com/VesperZephyr/OpenBot/actions/runs/40871946049).
- New hidden desktop acceptance: all three Bot resource scenarios passed locally and on CI. The focused resources and web suite passed all nine cases. The proposal includes a 16,300-character workflow to exercise bounded history projection.
- The initial full local and CI desktop runs each passed 200 of 201 cases, timing out on the latest message after index rebuild. A search-jump/resize regression reproduced the same stale scroll position after the Host returned the latest response. Direct `scrollTop` writes competed with virtualizer measurement/anchor corrections. Restoration now uses virtualizer scroll commands and cancels them on user navigation. The regression failed before the fix and passed afterward. All four history scenarios also passed on macOS CI at `3e77d72`; final full-suite evidence is tracked in [PR #69](https://github.com/VesperZephyr/OpenBot/pull/69).
- Inspected proposal, scoped routines, Library and Chinese 900 × 640 screenshots in `e2e/.run/bot-resources/`. Exercised Library and Preview using agent-browser against an isolated background test app. Screenshot inspection found a missing empty-state translation; it is now translated and asserted in desktop acceptance.
- All desktop checks use isolated state and ScriptedModel. No real-model spot check, packaged native release validation, merge or installed-app update is claimed.

### CI optimization

The [pre-optimization run](https://github.com/VesperZephyr/OpenBot/actions/runs/40877356384) took 13 minutes 8 seconds from job setup through completion: desktop testing/build took 10 minutes 25 seconds, check took 1 minute 44 seconds, and installation/Pi build took less than one minute. The history fix passed all four scenarios on this runner. Template recovery failed because ten status reads with nine real one-second delays raced a ten-second locator timeout; its remaining failures were caused by the still-open dialog.

CI now runs check and three disjoint desktop shards concurrently, with two Electron workers per macOS runner. The final `Check and e2e (macOS)` gate requires check and every shard to succeed. Failure does not cancel other shards, and each uploads a separate report/screenshots plus slow-suite timings. Local `pnpm run e2e` still runs the complete suite. Inspection through Vitest's sequencer verifies all 53 files occur exactly once across shards of 18, 18 and 17 files. The controlled-clock template suite passes seven cases locally; its recovery case takes approximately 2.4 seconds instead of 11–13 seconds, with all ten recovery reads asserted. Final full local and optimized CI results and measured wall time are tracked in [PR #69](https://github.com/VesperZephyr/OpenBot/pull/69).

## Open questions

None.
