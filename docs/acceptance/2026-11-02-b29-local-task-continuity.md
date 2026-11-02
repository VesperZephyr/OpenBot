# B29 Local Task Continuity Acceptance — November 2, 2026

Contract: [B29](../tasks/b29-local-task-continuity.md). Review: [draft PR #84](https://github.com/VesperZephyr/OpenBot/pull/84), branch `task/b29-local-task-continuity`, based on the reviewed D11 design and main through `4b98a42` (the update after `f45a707` adds only D12/D12a design documents and task-index links). The owner retains merge authority.

## Verification environment

All application checks use the existing isolated, hidden Electron harness with suite-local state and Keychain identity. No owner-data development app, real model endpoint, new service, remote Target or Pi synchronization was used. Provider and tool gates establish admission ordering independently of provider latency. The compatibility probes execute actual predecessor code from `1b550b934c0adfd267bc7559d0ff80d91263b396` against temporary stores; the check job fetches repository history so the probe also works in CI.

Final command results are recorded below after the last relevant edit. Screenshots and execution logs remain local or in CI artifacts, outside tracked product data.

## Acceptance evidence

The table maps the contract to new task-specific tests and existing shared-path regressions. A shared-path regression is not described as a separate physical crash or native OS event test.

| Contract | Executed evidence and observable boundary |
| --- | --- |
| T01 | `packages/agent-runtime/test/local-tasks.test.ts` rejects an invalid binding before commit with no task/channel/Run/receipt, closes and reopens after acceptance, and replays the receipt without reloading material. Conflicting reuse still fails after Run pruning. Existing Run recovery tests cover stable Pi submission-ID reconciliation; task e2e reopens accepted work and canonical results without duplicate inference. |
| T02 | Host `retained brief` case and queued-stop e2e preserve initial instructions through a pre-admission Stop, append a later refinement once and explicitly send after restart. Adapter tests reject oversized UTF-8 input atomically, enforce the 32-input / 128 KiB brief bounds without changing the last accepted revision, and retain accepted inputs beyond terminal-Run pruning. Existing attachment/skill regressions cover frozen material and missing-byte failure. |
| T03 | Host tests hold two independent tool gates; task e2e holds two provider requests. Core answers while both remain held, and selected Stop acknowledges independently. Contexts/results remain separate and the Bot roster does not grow. |
| T04 | Host cases exercise caps 1/2/3, legacy saturation without preemption, direct Core reservation, aged task priority, reservation release, and terminal Pi with unconfirmed executor liveness across reopen. Existing scheduler tests retain direct/group aging and one-Bot exclusion. |
| T05 | Busy input rejects; Stop preserves an unsent draft and starts no replacement. Explicit Send creates a fresh Run. Competing submissions have one winner, stale controls cannot hit the replacement, and receipt replay returns original acceptance with fresh state. Composer tests freeze destination/revision across delayed responses. |
| T06 | Provider-gate tests hold asynchronous preparation for generation/compaction, reject after Stop, reject an old request after a new Run, and keep direct Core independent. Real child IPC gates hold executor startup and authority synchronization and prove no `tool.invoke` is sent after the fence. Adapter tests reject stale Always allow and publication, including a pruned old Run. Existing authority-coordinator and router tests cover policy/approval/revocation ordering. |
| T07 | Lost revoke confirmation retains busy state/capacity and rejects Continue/archive. Recheck can establish quiescence without inventing a successful effect. A stale evidence token rejects; exact acknowledgement creates a new Run/output directory and preserves old operation evidence. English/Chinese e2e requires the explicit checkbox. |
| T08 | Task intent, receipts, settlement/occupancy and final anchors survive reopen. Host task tests inject pause, suspend and quit; Resume never restarts interrupted work. Queued-stop and result e2e relaunch the app without extra inference. Existing crash/backup/lifecycle suites cover process loss, restoration, paused restore and unknown receipt handling. These are application event/recovery checks, not physical OS-delivery claims. |
| T09 | Task Host tests reject forbidden tools and forged Run/channel references. Typed task startup validation and the task-only runtime allowlist fail closed; the model app/Code Mode gate rejects task origins. Full memory, group, management and app-capability regressions retain their ordinary-context contracts. |
| T10 | Host tests reject original/shared paths, earlier Run directories, traversal, missing edit hashes, redirected Run roots and preexisting redirected task roots. The real Electron/Host/executor test writes a report, edits using its SHA-256, reads exact disk bytes and verifies the published immutable artifact hash. Existing file/executor/policy suites cover grant rechecks, symlinks, revocation and publication receipts. |
| T11 | Actual baseline Host creates legacy group/routine channels. Upgrade preserves IDs and creates no tasks; reopening with the baseline refuses the persisted version before inference. Actual baseline backup reader rejects token 2; the new reader accepts the known predecessor and rejects unknown runtime/Pi identities. Full backup e2e validates paused restore and corrupted/interrupted replacement recovery. |
| T12 | Task e2e observes unattended origin and the ten-minute deadline while the task is selected, rejects a stale approval after Stop, and keeps direct `lastRun` unchanged. Shared approval deadline/reopen tests and deterministic-policy e2e cover expiry without extension. Full usage/activity regressions preserve one ledger and fixed task activity; gated task completion adds no auxiliary model request. |
| T13 | Composer tests and e2e preserve separate Core/task/new-task drafts across navigation and reopen. Controls capture task identity and the accepted attempt's revision. Inspected English/Chinese result, recovery, paused draft and approval screenshots, including the supported 900 × 720 window. |
| T14 | Task e2e checks private history selection, cross-task cursor rejection, no direct Core result copy and stable exact result anchors after relaunch with unchanged provider request count. The 10,000-row fixture has no task read cursor and obeys history bounds. Full message/history/index suites retain canonical answer, artifact-only answer, rebuild and retention behavior. |
| T15 | Adapter tests enforce 32 active tasks and serialize competing unarchives for the final slot. A 1,000-archive / 10,000-row fixture deliberately omits archived brief documents: startup and bounded card/history reads still succeed without inference. Archive/unarchive e2e changes visibility without starting work. A separate 40-operation fixture bounds selected recovery references to 32 without embedding operation bodies. Responses stay within 32 cards / 64 KiB and existing history bounds. |
| T16 | Task e2e counts one pending approval and working activity without changing Core direct `lastRun`. Desktop attention tests preserve work/power aggregation and suppress duplicate completion notices. Full ordinary Core/Specialist/group/routine/background and lifecycle suites remain regression requirements. |

## Findings corrected during acceptance

- Stop now fences the final provider/transport admission after asynchronous preparation. Provider request bindings retain the old Run's aborted signal even when its stable session has advanced to a new Run. A Stop-induced provider failure is recorded as cancellation rather than a misleading failed-input outcome.
- Late input preparation merges into current Run state and admits Pi input under the short authority coordinator; it cannot overwrite Stop/interruption or hold the scheduler while loading material.
- Unknown execution liveness retains capacity across reopen. Approval persistence revalidates the task before saving Always allow, including when an old Run has been pruned.
- Archived control reads use task metadata independently of retained input briefs. Selected task reads suppress direct read cursors, bound recovery references and response bytes, and do not put full uncertain operation arguments into the replay brief.
- Task output allocation rejects an already redirected tasks directory. Host checks and narrowed executor grants retain the fresh Run directory boundary.
- New-task drafts survive navigation; stopped drafts survive restart and remain explicit sends. Header sizing and Chinese Archive copy were corrected after screenshot inspection.
- An initial e2e fixture passed an unsupported `description` argument to `local_write` and asserted only the subsequent text answer. It was corrected to assert real write/edit bytes and the published artifact hash. The final suite no longer treats “Report saved” as file evidence.

## Full regression

- `pnpm run check`: 745 tests across 108 files passed, including lint, package boundaries and both TypeScript projects. Repeated after the final timing refresh: 43.41 seconds of Vitest execution; PR checks retain remote results.
- `pnpm run e2e`: all 217 cases across 55 suites passed with no skips after the cancellation-outcome fix; Vitest reported 319.59 seconds. The task suite contributes five real Electron/Host/executor flows.
- `node scripts/e2e-shard.ts --record e2e/.run/timings.json`: refreshed the tracked suite weights from that successful full run, including the new task suite.
- `git diff --check` and referenced local documentation paths checked.
- Inspected `e2e/.run/local-tasks/01-stopped-draft.png` through `07-task-approval.png`: stopped draft, exact task result, Chinese minimum-size result, English/Chinese uncertain-effects review, paused stopped draft and unattended approval. The final result screenshot shows the prior cancelled attempt followed by the explicit corrected result.

Implementation/test commit: `0b8b077`; merge `13ac92c` only incorporates the newer main task-index/design documents. Current remote CI is tracked on [PR #84](https://github.com/VesperZephyr/OpenBot/pull/84), rather than copying changing run state into this dated record.

Earlier exploratory checks encountered the missing local Oxlint installation and timeout failures in existing login-path/shard tooling tests during a machine stall. Frozen dependency installation and isolated reruns resolved those checks; no timeout or assertion was weakened. The earlier full e2e pass (217 cases) preceded the final cancellation-outcome correction and is not substituted for the final run.

## Limits

No real-provider usefulness/latency trial or packaged native signing, notification, power assertion, physical lock/sleep delivery or helper identity claim is made. Those existing release gates remain open independently. Unknown side effects remain unknown after owner acknowledgement; the new Run must inspect them. The feature stays within one user's Mac and the existing application processes, with the configured inference endpoint and the B29 tool/output limits.
