# B14b: Lifecycle Gates and Explicit Continuation

Status: implemented, in review
Branch: task/b14b-lifecycle-gates; pull request target: main
Depends on: G0, merged B1–B8/B13/B25/B26 contracts
Architecture: Sections 5.1–5.3 and 8.1–8.2

## Goal

Pause all work from Desktop and prevent lock, sleep, or quit transitions from starting a new model/tool action. Preserve queued messages, mark interrupted active work honestly, and require explicit continuation. Closing a window still leaves the application running.

## Scope

In: persistent global pause/recovery state, Desktop native lifecycle forwarding, scheduler and Tool Router gates, cancellation of supervised foreground/background work, interrupted Run presentation, explicit Resume and per-Run continuation, English/Chinese UI, isolated recovery verification. Out: per-Bot pause, routine catch-up, new policy rules, browser/desktop leases, forceful OS session changes, keeping the Mac awake, signed/native release acceptance, and new Pi scheduling primitives.

This batch branches from merged `main` independently of B14a PR #29 and B15a PR #30. Their features remain separate PRs. Preserve B14a observation guards and B15a immutable input references when integrating conflicts. No vendor update is required.

## State and authority

`LifecycleState` exposes targetId, revision, blocked, transitioning, userPaused, needsResume, nativeReady, locked, suspended, quitting and lastReason. Durable `LifecycleDoc` stores userPaused, needsResume, lastReason and revision. Native flags are current-session observations, not renderer claims. No credentials or task content enter lifecycle diagnostics.

Methods:
- `lifecycle.get({})`: read the current state.
- `lifecycle.pause({})`: explicit user pause, idempotent, synchronously closes admission/dispatch before awaiting storage.
- `lifecycle.resume({})`: explicit user action; rejects while locked, sleeping, quitting, awaiting native state, or still stopping. Clears a persisted pause only after prior quiescence and a fresh native-state check.
- `lifecycle.native({sourceId,seq,locked,suspended,quitting})`: main-only full snapshot with a monotonic sequence for the Desktop process. Strict bounded schema, absent from renderer and model methods. Duplicate/stale snapshots cannot reopen a gate.
- `runs.continue({runId,requestId})`: user-only explicit follow-up for an interrupted private Run. Uses committed history and a new stable message identity with a clear instruction to inspect uncertain effects before repeating anything; never revives the interrupted invocation or automatically reuses an approval. Duplicate continuation requests deduplicate normally. Group interruptions require a new user group message, preserving collaboration budgets and avoiding automatic peer wakeups.

The Host owns this state in `server-core`; Pi document access stays inside `agent-runtime`. Desktop provides observations and controls. `tool-router` receives a small execution-gate port, checks before policy, after approval, after grants, and immediately before dispatch. The orchestration parent uses the same gate; nested leaves cannot bypass it. The Pi adapter also wraps generation/compaction model dispatch with a gate check after credential resolution and a lifecycle AbortSignal. Closing the latch aborts that signal synchronously; Resume installs a fresh signal. Model cancellation and read-only catalog/settings access remain available, and no Pi vendor patch is needed. The executor rechecks target and existing grants as before and handles invocation cancellation through its existing invoke/cancel/receipt envelope. A target-bound private `execution.quiesce({messageId,targetId})` / `execution.quiesced({messageId,confirmed})` exchange waits for all foreground/background termination; unknown termination does not confirm quiescence. There is at most one outstanding quiescence exchange; loss/timeout leaves the Host gate closed.

Desktop-launched Hosts start closed until main sends its first current native snapshot. Read-only snapshots, settings and history remain available while closed. Standalone Host composition, which has no native event source, explicitly uses its local lifecycle mode; this is not evidence of macOS native monitoring. Main resends its latest snapshot after every Host restart, drops replies/events from superseded children, and forwards events in order. A renderer reload cannot fabricate native readiness or clear a user pause.

## Transition table

| Event | Admission and tools | Active Runs and commands | Queued Runs, approvals and groups |
| --- | --- | --- | --- |
| Window closes | Unchanged | Continue | Unchanged |
| Pause all | Gate immediately; persist userPaused and needsResume | Persist interruption intent, abort Pi and stop supervised background commands; reconcile before claiming settled | Queued messages retained. Interrupted approval waits withdraw; decisions cannot dispatch behind the gate. Group roots stop their existing chain |
| Lock or suspend | Gate immediately; persist needsResume | Same interruption path; abrupt sleep may prevent immediate receipt reconciliation | Queued messages retained; no collaboration child/result continuation admitted while gated |
| Unlock or wake | Refresh native flags; keep needsResume | Remain interrupted; no automatic replay | Remain queued until explicit Resume |
| Resume | Only after native readiness and quiescence | Does not resurrect interrupted Runs; user can Continue a private task or send a new group message | Admit preserved queued messages through normal capacity and authority checks |
| Quit | Close gate and persist recovery intent before process shutdown; an idle quit with no queued/active Run or prior pause does not add a Resume prompt | Attempt the same supervised stop; shutdown retains uncertain receipts and pending interruption intents | Preserve queued messages; no new work during flush |
| Restart after interruption | Native handshake and executor recovery precede scheduling | Complete persisted interruption handling; never infer successful side effects from process absence | Preserve explicit user pause; require Resume when needsResume is set |
| Unexpected Host crash without a lifecycle transition | Temporary startup gate | Existing stable Pi/executor replay contracts reconcile committed results and unknown outcomes | Main handshake restores current native flags; a previous explicit pause remains authoritative |
| Stop one Run | Existing scoped stop | Stops that Run; does not clear global pause | Unrelated Runs are unchanged |

## Run interruption and recovery

Add terminal `needs_attention` to the Run state union, with a bounded interruption reason and persisted interruption intent. A Run interrupted by lifecycle control is not reported as completed or silently turned into an ordinary user cancellation. Cancellation requests do not prove rollback. An answer committed before the interruption keeps its completed state.

Scheduler persistence records the interruption before invoking cancellation. Queued Runs retain their original messages and IDs. New messages while globally paused may join the queued work but never steer an interrupted active Run. On recovery, process interruption intents before any `submit`, `wait`, or Pi `resume` call that could enable scheduling. Pi `Conversation.abort()` enables scheduling even with its background option. Global interruption therefore first uses the public read-only inspection, `abortSubmission` and `abortTask` APIs to withdraw queued Pi inputs and mark every live task, then enables scheduling only to drain cancellation. This stays inside `agent-runtime`; ordinary submit/wait/resume remains gated.

Pi's abort can settle inputs asynchronously. Keep stopping observable until settlement; do not free capacity, enable Resume or claim all processes ended merely because an AbortSignal fired. A persistence failure still attempts supervised termination without claiming a durable interruption record. A failure to establish quiescence keeps the gate closed and reports attention needed; normal application shutdown retains the intent and existing forced-process timeout. Executor process loss produces unknown receipts, never success.

`needs_attention` is terminal for delivery/replay identity and retention. Group delivery maps it to failed without publishing a success post; its root is paused/stopped so the interrupted chain does not automatically assign or synthesize more work. A user can start a fresh group request. Per-Run Continue preserves the original accepted text in a user-visible follow-up, includes the reconciliation instruction, and is restricted to a live Bot's interrupted private Run after Resume. The original record remains immutable and its tool IDs are never reused for a new effect. The internal continuation request identity includes the source Run identity; the visible message uses ordinary task language and a bounded original-request excerpt.

## User experience

The sidebar exposes Pause all / Resume work. A persistent in-app status shows Paused, Locked, Sleeping, Recovering or Stopping work, with an explanation that queued messages are retained. During native blocking, Resume is disabled. Interrupted private conversations display a distinct attention note and Continue task action; group conversations explain that the chain stopped and a new message is needed. Text is English by default with Simplified Chinese translations. Model prose is unchanged.

No new notifications, native dialogs, focus requests, tray behavior or power assertions are introduced. Background e2e uses existing hidden mode. Native events are injected into Electron's event emitter inside the isolated test app; the owner's real session is never locked or suspended.

## Implementation steps

1. Add protocol/schema, lifecycle document/store and a tested server-core controller with immediate latch, serialized persistence and stale-event rejection.
2. Gate scheduler start/admission/steering, persist interruption intents, reconcile active work, and add explicit private continuation. Gate group sweeps and stop interrupted roots.
3. Add Tool Router checks around every asynchronous authority boundary; wire the composition and existing executor cancellation path. Ensure model-selected tools cannot invoke lifecycle or continuation methods.
4. Forward main-only native snapshots before scheduling, on events and after Host restart; close the gate before quit. Add bilingual controls and attention state.
5. Exercise invariant and UI tests, inspect screenshots, run check/full background e2e, and perform a bounded isolated real-model pause/queue/resume/continuation check. Record native packaged evidence separately.

## Acceptance

1. Controller tests cover persisted user pause, native readiness, stale/duplicate sequences, pause during resume, multiple blockers, failures during persistence/quiescence, restart, idempotence and no auto-resume on unlock.
2. Router tests pause before dispatch, during approval and while grants resolve; no leaf or Code Mode parent passes the gate. Existing hard authorization and exact approvals remain effective.
3. Scheduler/Host tests prove queue retention, interruption intent recovery, confirmed/uncertain stop distinction, no active-capacity leak, no duplicate continuation, unrelated scoped Stop behavior and no automatic group wake after interruption.
4. Background e2e injects lock/unlock and suspend/wake, pauses across Host/app restart, queues and resumes messages, stops active command work without duplicated effects, checks withdrawn approvals, English/Chinese attention UI and hidden inactive windows. Closing a window differs from quitting.
5. `pnpm run check` and full background `pnpm run e2e` pass; screenshots inspected. Real-model synthetic task confirms queued work stays silent until Resume and committed files are not duplicated by restart. Actual packaged OS event/signing/permission acceptance remains unverified here.

## Open questions

None. Explicit global Resume restarts preserved queues; interrupted active work requires a separate user continuation. Native release evidence is outside this hidden verification run.

## Acceptance evidence

Implementation revision: `5a441b2` (2026-10-18). Pi source and package dependencies are unchanged.

| Acceptance | Evidence |
| --- | --- |
| Lifecycle authority | `server-core/test/lifecycle.test.ts` and `desktop/test/lifecycle.test.ts`: native startup gate, full observation ordering, durable pause, multiple blockers, immediate model abort, repeated safe observations, persistence/stop/resume failure, idle quit and accepted group work |
| Model/tool dispatch | `agent-runtime/test/model-gate.test.ts` covers generation/compaction gating after asynchronous request preparation and preserves admitted provider behavior. Router tests block direct tools, Code Mode parents, late approvals and delayed grants. Executor transport checks the latch after startup; background command tests wait for all supervised groups to exit |
| Durable Runs | Scheduler tests cover preserved queues, fresh deduplicated continuation, unconfirmed stop, crash recovery before native readiness, committed-answer preservation and existing scoped Stop/capacity behavior. Group e2e proves a stopped chain does not wake peers after Resume |
| Desktop | Seven `e2e/lifecycle.e2e.ts` scenarios: pause/reopen/queue/resume, simulated lock and command interruption, simulated suspend with approval withdrawal, Chinese controls, idle restart, hidden native authority, group stop, Code Mode cancellation and window-close continuity. Existing approval-recovery suites explicitly distinguish a Host crash from intentional application quit |
| Automated checks | `pnpm run check`: 301 tests / 48 files. Full background `pnpm run e2e`: 80 tests / 23 files. Final persistence-failure and queued-group quit refinements passed focused unit checks and seven background lifecycle scenarios. `git diff --check` passed |
| Bundled runtime | `node apps/desktop/scripts/stage-runtime.mjs` built the Host, executor and Code Mode assets and started bundled Node/Host/executor in an unrelated isolated directory without a UI or provider request |
| Visual inspection | English interruption and Chinese paused/queued screenshots in `e2e/.run/lifecycle/` inspected; real-model Chinese completion/pause view inspected. Hidden windows remained inactive. Native lock/sleep events were simulated, never performed on the owner's session |
| Real model | Isolated hidden Electron with the existing `mafia / gpt-6.1-sol` configuration. A queued synthetic request remained unsubmitted across restart. Resume led to one approved append followed by a sleeping command. Pause produced a settled interrupted Run and cancelled command receipt. Explicit Continue used `local_read`, returned English/Chinese confirmation, and left exactly one file line. Pause and the single effect survived another complete restart. Final spot check included the model lifecycle gate |
| Privacy and release limits | Temporary copied model configuration removed; fixtures, screenshots and raw logs remain outside Git. Audit records excluded the marker and command text. Actual packaged lock/sleep delivery, signing/TCC, notifications and native power behavior remain release evidence gaps; no production app or native dialog was opened |
