# B11a: Local Scheduled Routines

Status: implemented; awaiting review
Branch: task/b11a-local-routines; PR target: main
Depends on: merged main `4267def` (I2), B10, B12a, B14a/b, B15a/b
Architecture: Sections 5.8, 7.1–7.2 and 8

## Goal

Create, review, test and schedule a repeatable local workflow. Each occurrence uses a fresh Bot context, the existing Run queue and current permissions, then delivers one labeled report to the Bot's private conversation.

## Scope

In: a bilingual Routines panel; confirmed creation/editing, pause/resume/delete, immediate test runs, pinned skills, interval/daily/weekly schedules with IANA time zones, bounded catch-up, absence protection, retained history and exact report publication. Host-owned scheduling and runtime-owned durable documents reuse existing execution contracts.

Out: model-driven routine proposals (a separate follow-up), event triggers, new connector capabilities, automatic permissions, cloud scheduling and computer control. B9c OAuth and B12b model review are excluded from the active plan by owner direction; Phase 3 is deferred.

## Contracts

- A routine binds an immutable Bot and local target, a revision, name (80 characters), workflow (16 KiB), up to two exact skill references, schedule, catch-up window (0–72 hours), enabled/deleted state and next scheduled UTC instant. User confirmation shows the complete configuration; Test run explicitly warns that it performs real work. Creation/update never runs immediately.
- Intervals use a fixed UTC anchor and 5–10,080 minute spacing. Daily/weekly schedules use an explicit IANA zone and HH:mm; weekly days use ISO 1–7. A nonexistent DST wall time is skipped, and a repeated wall time runs only at its first instant. Changing timezone/schedule computes a new next instant strictly after confirmation. Existing routine IDs are never reused.
- At most 50 active routines per Bot, 500 globally, 1,024 total identities including deletion tombstones and 4,096 mutation/test request receipts. Capacity fails closed. Mutations require expected revision and a stable request ID; conflicting reuse fails, exact replay returns the recorded result. Resume never replays times while explicitly paused.
- Store the scheduling cursor and immutable occurrence input before queue admission. Scheduled request IDs are `routine:<routineId>:<scheduledAt>`; manual tests use `routine-test:<routineId>:<requestId>`. A hashed occurrence channel has exactly one ownerless Pi conversation, created atomically with its channel mapping. Routine channels expose ordinary file/research/connector tools, without Core management, Code Mode or collaboration extensions. The persisted Run origin is `routine`; the model cannot forge it.
- One pending/running occurrence per routine. A due occurrence during overlap is recorded as skipped; it does not build an unbounded queue. After absence, admit at most the latest due occurrence within the catch-up window, recording the older range as skipped. Zero catch-up permits only a one-minute on-time grace. No recurring in-memory timer is authoritative: durable nextAt is the source of truth.
- Default absence threshold is seven days, configurable from one to thirty days. Real desktop interaction and explicit user mutations record activity; background polling does not. Expiry persistently pauses scheduled work and requires explicit resume. Test runs require a present user and an unblocked lifecycle. Routine pause/delete invalidates pending execution before cancellation and never claims rollback; lifecycle interruptions remain attention states and are never automatically retried.
- Pin exact skill revisions on configuration. Resolve them before occurrence admission and store immutable Run input snapshots through the existing queue. Missing or unavailable skills fail that occurrence visibly; never silently upgrade or omit them. Instructions name input sources and expected output; missing source data must be reported, not invented.
- All tools use current target, policy and executor authorization. Routine Runs are unattended, including test runs, and pending write approvals expire under B12a. Routine pause, deletion and Bot deletion are checked at queue admission and every fresh dispatch. Routine Runs cannot create background completion chains, manage Bots/groups or save skills. Already dispatched effects remain recorded.
- The Host reconciles an admission response lost after persistence against the same Run request ID before any retry. Terminal outcome and bounded report text (16 KiB) are frozen before publication. Publish one non-model `openbot.routine-report` entry to the direct conversation with a stable request ID, then record delivery. Restart after publication-before-recording deduplicates the entry. Preserve confirmed result artifact references and actual failed/cancelled/needs-attention outcomes. Report entries participate in search/unread projection without submitting new model work or steering the private conversation.
- History returns the latest 20 terminal records plus the current occurrence. Scheduling high-water marks and mutation receipts survive pruning, so old events cannot execute again. Underlying Pi conversation history is retained; this is not a data-erasure feature. Routine channels are excluded from group observers and direct management. The panel shows current approvals, Stop and transcript details for the selected occurrence.
- Reuse the existing observation invalidation mechanism; background scheduling is bounded, single-flight and stops cleanly with Host shutdown. Logs retain metadata only. All new product copy has English and Chinese versions. Tests use isolated background apps with no native attention side effects.

## Steps

1. Record the revised delivery scope and merged B9b/I2 state. Save this spec before product changes.
2. Add protocol/schema contracts, pure timezone scheduling helpers and runtime storage. Test DST, revision/request identity, limits, retention and context isolation.
3. Add Host routine reconciliation, queue admission, dispatch guards, cancellation, absence and report publication. Test fake-clock catch-up, overlap, lost admission/publication responses, restart, missing skills and unattended authority.
4. Add the Routines panel, confirmation, history, approvals and labeled private reports. Extend scripted desktop coverage for English/Chinese creation, test-run side effects, denial, pause/resume/delete, restart, history and search/unread behavior.
5. Run full check/e2e, inspect screenshots and explore the isolated app with agent-browser. Verify bundled startup and a bounded real-model local report if a provider is available. Update evidence and open one PR targeting main; follow CI.

## Acceptance

1. Confirmed settings survive restart; stale revisions and changed request replay fail before side effects. DST transitions, interval anchors, catch-up/skip ranges, overlap and absence are deterministic under an injected clock.
2. Each occurrence gets an isolated context with ordinary unattended authority; the per-Bot/global scheduler caps and lifecycle gates apply. Denied/expired approval cannot write; pause/delete blocks new dispatch and stops eligible work.
3. Lost admission and publication responses across reopen produce one logical Run and one report. A model failure or uncertain tool result remains visible, and no effect is automatically retried as a new occurrence.
4. Exact skill revisions and artifact references survive queue/restart; missing sources/skills are visible failures. Twenty-record history pruning cannot reset schedule high-water marks or erase active recovery identities.
5. Scripted hidden desktop flows cover creation/edit review, real-work test confirmation, approvals, report/history, restart, pause/resume/delete and English/Chinese layout. Full check/e2e passes; screenshots are inspected. Real-model observations and native release limitations are recorded separately.

## Open questions

None for this increment. Add a contract gap before changing this design.

## Verification — 2026-10-20

| Acceptance | Evidence |
| --- | --- |
| 1. Confirmed configuration and deterministic scheduling | `server-core/test/routine-schedule.test.ts` and `routines.test.ts`: UTC anchors, daily/weekly DST gaps and folds (including half-hour offsets), exact mutation/test replay, stale revisions, coalesced catch-up, overlap, persistent absence and per-Bot capacity. Desktop create/edit review is checked before persistence. |
| 2. Isolated unattended authority and stopping | Runtime tests exclude private input and Core/collaboration/application tools, including after reopen. Host guards bind active Run, Bot, channel, target, routine revision and stop state. Desktop tests deny commands, pause and stop pending writes, and verify absent output files. The ten-minute unattended deadline survives a Host crash; the shared B12a clock tests exercise actual expiry. |
| 3. Recovery and exact reports | Lost admission and publication responses reopen the actual Pi store and produce one logical Run/report. Non-model reports make no inference request and do not enter later private prompts. Desktop checks report search/unread, model failure and complete relaunch. |
| 4. Pinned skills, partial artifacts and retention | Scripted desktop inference receives the exact selected skill snapshot. Host tests surface a missing revision, retain confirmed artifacts after a later failure, bound UTF-8 report bytes, keep 20 outcomes/Run projections and preserve replay receipts/cursors after pruning. |
| 5. Complete application verification | `pnpm run check`: 477 tests passed. `pnpm run e2e`: 127 hidden desktop tests passed. The five routine scenarios also passed a final focused rerun, including automatic real-clock scheduling and a missing source. English results/approvals and Chinese minimum-size editor/history screenshots were inspected under `e2e/.run/routines/`. |

`node apps/desktop/scripts/stage-runtime.mjs` verified startup of the bundled Host and executor with isolated state.

A separate hidden real-model spot check used the configured `mafia/gpt-6.1-sol` provider, synthetic `sales.csv` (350 and 480), and only ordinary local tools. It created and published `morning-sales.md`; total 830 and regional shares 42.17% / 57.83% were checked against the source. One report and one artifact survived full application relaunch. agent-browser inspected the result, history and file preview. Local evidence is under `e2e/.run/routines-real/`; no credentials, runtime logs or test state are committed.

Transaction results are detached before returning across IPC; pausing no longer leaks Pi draft proxies. Terminal Run projections are pruned with old occurrence history, while the durable schedule cursor and replay receipts remain. Confirmed files survive partial failure; cancellation does not claim rollback.

Developer ID signing, notarization, clean-install acceptance and physical lock/sleep tests remain the separate native release gates recorded in I2. This increment verifies simulated recovery and a running local clock, and does not establish those release claims.
