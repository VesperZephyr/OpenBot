# B15b: Durable Background Command Completion

Status: implemented; in review in [PR #36](https://github.com/VesperZephyr/OpenBot/pull/36)
Branch: task/b15b-background-completion; PR target: main
Depends on: verified B10 candidate `e30cf9eeaba057fea709e8e06af6b034d47068c4` (#35), including I1 #34 and B14b/B12a
Architecture: Sections 5.1–5.3, 6.2 and 7.2

## Goal

When an authorized command outlives its model turn, deliver its final result once in the originating conversation without asking the user or model to poll. Reuse Pi Durable submissions, the Host Run queue and the executor receipt ledger.

## Scope

Local command completion subscriptions, bounded final-output receipts, restart-safe unattended continuation, group result delivery, stop/deletion/lifecycle suppression and bilingual inline status. No parallel model subagents, cross-chat dispatch, routines, connectors, new model configuration or native notifications.

## Contracts

### Provenance and registration

- Tool Router exposes a narrow application port for command tracking. Before a fresh authorized `local_exec` dispatch, reserve capacity for the stable invocation identity. After its result, bind a returned taskId before returning the result to Pi. Exact executor receipt replay passes the same completion-registration path. Foreground results release their provisional reservation and create no wake.
- Host captures the actual source Run, Bot, conversation, optional group and target from trusted call identity. A model cannot choose the recipient or forge a subscription. The source must be a live user/peer Run and its context must still be valid. Background-origin Runs cannot create further automatic subscriptions or delegate/handoff; their command results clearly say that automatic continuation is unavailable.
- Durable records bind invocationId, argument digest, targetId, sourceRunId, botId, conversationId, optional group/delivery/root IDs and taskId. Conflicting replay fails. Maximum 64 pending reservations/subscriptions overall, 8 per source Run and 4,096 retained background identities; no automatic identity eviction. Capacity is checked before a new eligible command starts; existing receipts remain reconcilable. Foreground-only provisional records do not consume retained-background capacity after settlement.
- Host owns these records through agent-runtime's Pi document adapter. Executor owns command/output/process facts in its separate ledger. No new service or socket; no Pi vendor change.

### Completion receipt and transport

- Extend executor task records with trusted Run/Bot provenance, bounded terminal output, truncation and completion time. The command's terminal status and final output commit together before they are exposed to the Host. Keep at most 16 KiB UTF-8 of final output per receipt; preserve existing larger spill files and existing task_output behavior. Never relabel missing/unknown output as a successful empty result. A terminal task_output read records that the result was already consumed; the source turn can report it directly without an extra automatic response.
- Host polls only its pending task identities over a private, target-bound request. One in-flight request, batches of at most 16, at most once per second, a ten-second transport timeout. No model request is made by polling. The executor validates identities and returns only those records. No polling when there is no pending work or during shutdown.
- Host copies a terminal receipt into its durable record before acknowledgement. Acknowledge only after permanent suppression or continuation admission; while waiting for the source Run to finish, recheck whether its terminal output was already consumed. The executor retains unacknowledged completion rows; acknowledgement permits existing seven-day cleanup. Legacy tasks are not automatically subscribed. Executor restart still stops orphan process groups and reports unknown; it does not restart commands. Uncertain tasks require attention and never automatically repeat an effect.
- Metadata-only diagnostics record task/subscription/Run IDs, state, duration and suppression reason. Command bodies, output, user content and credentials stay out of operational logs.

### Admission and cancellation

- A successful or failed command whose terminal output was not already consumed may cause exactly one separate background-origin Run after the source Run has completed successfully. It waits in the existing queue, never steers unrelated active work, and uses a stable request ID derived from the subscription. Preserve the source Run while a subscription depends on it so ordinary terminal retention cannot erase provenance.
- Persist the copied receipt, then admit with the stable request ID, then record the admitted Run. Restart between any pair reconciles the same logical continuation. The accepted completion input is immutable. Mark it as command output rather than a new user instruction; ask the Bot to summarize the outcome and inspect uncertain effects instead of repeating the command.
- Background origin is unattended for approvals and has no private Core management authority or skill-save authority. Current target, policy, grants, lifecycle and context are checked again by the existing scheduler and Tool Router. No earlier command approval authorizes subsequent work.
- Stop persists a suppression tombstone before cancelling the supervised process and queued/active continuation. Source cancellation/failure/interruption, Bot deletion, conversation reset, group invalidation or task cancellation suppress delivery. Unknown command outcomes remain visible for attention without model continuation. A late exit or duplicate receipt cannot clear a tombstone.
- Pausing/locking/sleeping/quitting follows existing lifecycle quiescence. A completed receipt waiting for admission can wait through pause; unfinished commands interrupted by shutdown do not resume themselves. No active control or notification is introduced.

### Group context

- Registering an actual background task atomically reserves a pending background delivery under the source group's existing collaboration root, before the source tool result is returned to Pi. It consumes one of the existing twelve automatic-delivery slots and keeps the root from closing while the command runs. It is not a delegation child and cannot generate an additional result-acknowledgement continuation.
- The reserved delivery remains unready until the Host has durably copied the terminal receipt and the source delivery completed. Its input is then fixed. Existing group admission, publication and reply identity deliver the final answer once to the same post and group. It cannot become a private message.
- Membership removal, dissolution, root stop/pause or handoff invalidates the pending completion. Recheck before admission and new tool dispatch. Background deliveries cannot create more background wakes or collaboration branches. Source failure cancels the reserved delivery; it does not keep the root open forever.

### UI and storage compatibility

- An inline background-task status appears with its originating command: running, waiting to deliver, delivering, delivered, stopped, or needs attention. Show bounded terminal output when available and a Stop action while pending/active. Synthetic completion input is visibly labeled and never styled as a human-authored request. Reuse existing conversation observation; do not add an unbounded event feed or mark a conversation read during polling.
- English is default. All new application-owned labels/errors have Chinese equivalents. Preserve drafts and input focus through status updates. No native notifications, focus changes or visible verification windows.
- New document fields and SQLite columns have additive migrations. Existing receipts, Runs and group deliveries preserve behavior and do not retroactively wake Bots. Retention never deletes pending receipts or deduplication identities silently.

## Implementation sequence

1. Save this spec. Add protocol records and bounded private requests, executor ledger migration/final receipt capture and replay tests.
2. Add agent-runtime storage and Host tracking service, Tool Router registration ports, queue admission and unattended origin. Cover cancellation, identity collisions, quotas, recovery and no recursive wake.
3. Add group reservation/readiness and existing-publication integration. Cover membership/dissolution/root stop and budget preservation.
4. Add bilingual inline status and labeled completion input; scripted hidden desktop flows for private/group completion, another chat, restart, stop and denied unattended operations.
5. Run full check/e2e, inspect screenshots and bundled startup. Run one isolated real-model long-command workflow, verifying actual output and exactly one continuation without task_output polling. Delete temporary model configuration.
6. Update backlog, technical plan and roadmap; push one PR targeting main. Do not merge or release.

## Acceptance

- A command finishes after the initial response; the owning Bot delivers one final result without user/model polling while another conversation responds normally.
- Duplicate terminal receipt, lost acknowledgement and restart after receipt-before-admission produce one logical continuation and one visible result. Exact output/status and provenance survive restart.
- Stop before exit and after receipt-before-admission, source failure/interruption, deleted/reset Bot context and dissolved/invalid group cannot resurrect work. Existing orphan cleanup remains effective.
- Subsequent tools use current unattended policy, approval expiry and target binding. Completion content cannot acquire Core management or skill-write authority. A completion-triggered command cannot recursively wake the Bot.
- Group completion stays in its originating root/post, consumes the bounded budget and never creates a cross-chat/private result. Cancellation releases the pending delivery consistently.
- Quotas, output bounds, private transport bounds, legacy migrations and metadata-only logs are covered. Full automated evidence, bilingual screenshot inspection, bundled startup and real-model verification are recorded separately from native release gates.

## Open questions

None for this increment. Record a contract gap here before changing the design.


## Verification evidence

The implementation passed `pnpm run check` (390 tests / 60 files), the full hidden `pnpm run e2e` (108 tests / 30 files), and final completion regressions (five hidden desktop flows). A separate 16-test completion/collaboration/lifecycle rerun also passed. The final snapshot-retention regression keeps old pending tasks visible when newer completed history fills the bounded view. Bundled Host/executor startup passed with isolated state.

Coverage includes one automatic result while another conversation responds, lost admission response/restart deduplication, terminal-source retention and old receipt replay, Stop before admission/late exit, reset/deletion/dissolution, consumed/unknown/mismatched receipts, single-flight polling, exact target, unattended approvals, denied Core management, approved follow-up commands without recursive wake, group reservation/replay/budget, UTF-8 output bounds, legacy SQLite migration, acknowledgement retention and content-free diagnostics. English/Chinese command cards and the real-model Chinese completion screenshot were inspected. Synthetic completion inputs are labeled and excluded from human-message search/preview projection.

The isolated real model executed one synthetic background command and returned profit 13 automatically after its first turn. Evidence: source Run `run_9d3788e3-3e7c-4688-bc65-21a02814f95d`, continuation `run_fb2dc57e-524f-46ea-97e6-22fbaaa67cd0`, exactly one command and one completion input, no task_output calls, exact stored final output, 17,364 recorded tokens, stable result after restart, hidden/inactive windows and metadata-only operational logs. Final reopen rechecked durable evidence without repeating inference/effects. Temporary model configuration was removed; raw output, screenshots and local provider details remain outside Git.

Earlier validation corrected two test text locators. The real file-count spill fixture hit its five-second deadline under full-suite disk contention; its allowance is now fifteen seconds with all assertions unchanged. Final checks passed. No product timeout was relaxed.

PR #36 targets main and depends on B10 #35; it also incorporates main's D4 merge. No merge to main or release was performed. Native signing/TCC, live connector credential identity and physical power events remain separate release gates. B9a supervised stdio connectors is next.
