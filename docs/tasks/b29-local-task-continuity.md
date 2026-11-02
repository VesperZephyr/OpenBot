# B29: Local Task Continuity and a Responsive Core

Status: done
Branch: `task/b29-local-task-continuity`
Depends on: B13a, B12a, B14a–B14d, B15a, B27a–B27c, B28a; their required implementation must be present on the implementation base
Architecture: Sections 5.1–5.3, 5.7, 6.1, 6.5, 7.1–7.2 and 8
Design: [D11 reviewed decisions](d11-local-task-continuity.md)
Contract date: 2026-11-02

Claimed on 2026-11-02 for the owner-requested implementation. This branch includes the reviewed design from PR #82 and current main through `f45a707`; the owner retains merge authority.

## Goal

Start two independent research/report tasks using Core, keep ordinary Core chat available, stop only the selected task, and refine or continue it after confirmed settlement without losing accepted inputs or confusing its result with another conversation. All control, storage and execution remain in the existing application on one Mac; inference uses the configured endpoint.

## Scope

In: explicit owner-created Core tasks; isolated task conversations; bounded task cards/history and drafts; task-scoped Stop, follow-up and Continue; honest recovery; a reserved Core slot within the existing cap; authorized reads and task-local report outputs; durable acceptance and compatibility checks.

Out: new packages/processes/services, remote Targets, automatic task creation/routing/replacement, model task APIs, Specialist assignment, hidden groups, delegation trees, shell/background commands, connectors, edits to original/shared files, task dependencies, global task search/unread/native result notifications, a watchdog, provider changes and Pi synchronization. B15b, ordinary chat, groups and Routines retain their existing contracts. Broader capabilities require another spec. Generated activity phrasing is not enabled for task contexts, even if B28b lands first.

## Design

Use one stable task record and one Pi conversation per task, owned by Core. A Run remains a single execution attempt. A follow-up or Continue creates a new Run only after the previous execution settles. There is no new task execution state machine, pending correction queue or execution epoch; derive presentation from durable task intent, Run facts, approvals and receipts. [D11](d11-local-task-continuity.md) owns the trade-offs and reconsideration conditions.

## Contracts

### 1. Owner methods and errors

Add these Host methods to `protocol`, independently of Pi types. They are Desktop IPC only, excluded from model application catalogs and Code Mode. No caller supplies a Bot, channel, Pi conversation, output path, target or grants.

| Method | Input | Result / eligibility |
| --- | --- | --- |
| `tasks.create` | `requestId`, `text`, optional initial attachment IDs and exact skill refs | Accepted task ID, command revision and initial Run ID. Host resolves Core and local Target. |
| `tasks.submit` | `taskId`, `requestId`, `expectedRevision`, `expectedRunId`, and either `{ kind: "input", text }` or `{ kind: "continue" }`; optional `recoveryToken` | Creates one new queued Run in the same task. Prior execution must be quiescent and task unarchived. Input refines work; Continue is allowed only after stopped, failed or interrupted work. No steering or queued merge. |
| `tasks.stop` | `taskId`, `requestId`, `expectedRevision`, `expectedRunId` | Durable stop acknowledgement; does not wait for termination. May be repeated to recheck settlement. |
| `tasks.archive` | `taskId`, `requestId`, `expectedRevision`, `archived` | Visibility only, requires no queued/admitted/unsettled work. Unarchive is subject to the active-list bound and starts nothing. |
| `tasks.list` | `archived` (default false), optional cursor | At most 32 metadata cards, 64 KiB total, plus opaque next cursor. No transcripts or input bodies. |
| `tasks.get` | `taskId` | At most 64 KiB of selected-task control metadata: current Run/activity/approval references, input summary, result anchor and recovery evidence; no embedded transcript or full input brief. Page operation evidence through the selected history/detail surface when it exceeds the response bound. |

`expectedRunId` identifies the current attempt even when its state changes after the button rendered. `expectedRevision` protects against other owner commands; ordinary activity updates do not change it. All successful mutations return their operation's accepted IDs/revision plus a fresh control snapshot; the snapshot may be newer than the receipt. The UI orders snapshots through the existing observation flow and never overwrites new state with an old acceptance response.

Use existing `ProtocolError` codes: `not_found` for missing tasks; `request_conflict` for a reused ID with different arguments or stale revision/Run; `invalid_request` for busy, paused, archived, missing recovery acknowledgement or limit violations. Return a specific actionable message and refreshable current control state; preserve the draft on rejection. Unsupported tools continue to use existing authorization errors.

Every mutation uses a stable owner `requestId`. Store a canonical argument digest including method, destination, expected revision/Run, input/ref IDs, archive flag and recovery token. Look up the operation receipt **before** current revision, lifecycle, attachment availability or state validation. Identical replay returns the original accepted IDs and current state; different arguments fail. A replay never clears a later Stop, creates another Run or re-reads changed defaults. Retain receipts beyond Run pruning, including rejected-state retries being new requests rather than replacing an accepted receipt.

Generic `messages.submit`, `runs.cancel`, `runs.continue`, reset/new-topic and model APIs must not mutate task contexts or bypass these checks. Internal lifecycle shutdown can stop tasks through the same fence/settlement mechanism. Existing public direct/group methods keep their behavior.

### 2. Identity and durable data

Store task data in Host-owned Pi documents through `agent-runtime`; do not add another database or executor-owned task manifest. New document kinds use version 1. Implementation-local type/helper names may vary; these fields and semantics may not:

| Record | Required fields / ownership |
| --- | --- |
| Task registry | Ordered `{ taskId, createdAt, archived }` metadata; the sole visibility/creation-order owner. Maximum 32 unarchived tasks. Keyset order `(createdAt DESC, taskId ASC)`; cursors bind the archive filter. |
| Per-task record | `taskId`, Core `botId`, explicit local `target`, `channelId`, Pi conversation ID, title, fixed canonical `outputRoot`, `commandRevision`, `currentRunId`, ordered accepted inputs, frozen initial attachment/method references, optional `stopIntent`, optional `settlement: { runId, confirmedAt }`, optional last result `{ runId, canonicalAnchor }`. No final-answer copy. Settlement is the quiescence fact, independently of Run outcome. |
| Accepted input | Immutable request ID, ordinal, exact text and canonical display anchor. Keep initial resolved attachment references and skill snapshots, using existing B15a/B27b representations. |
| Stop intent | Target Run ID, accepted owner request/reason and requested time. A task retains the stopped fact until an explicit new Run is accepted. Lifecycle interruption facts may use existing Run interruption records but must produce the same admission fence. |
| Operation receipt | Request ID, digest, accepted task/revision/Run IDs and operation kind. Per-request document, not an ever-growing embedded transcript. Recovery acknowledgement, when required, binds the acknowledged Run and evidence digest here. |
| Run binding | Trusted `taskId`, task channel, Core Bot and existing local Target binding; `origin: "task"`. New Runs get fresh IDs, `messageMode: "messages-v1"` and frozen task inputs. `currentRunId` is the execution generation; no extra epoch. |

The title is the first nonempty input line truncated to 80 Unicode code points, with no inference. Create rejects empty text. Each input is at most 24 KiB UTF-8; at most 32 owner inputs and 128 KiB of their text per task. Keep at most four initial attachments and two composed exact skills under existing byte/type limits. Follow-ups are text only; initial attachments and methods remain visible and pinned. A different file/method set requires a new task in this increment. Limit errors do not silently omit context or erase drafts; Continue does not add another owner input.

Each fresh Run receives the ordered accepted owner-input brief, initial pinned files/methods and its own Pi history. The brief explicitly distinguishes earlier instructions from later refinements; newer refinements take precedence where they conflict. This bounded replay is intentional: an initial request stopped before Pi admission must remain available even if the next input only says “change the dates.” It is not automatic summarization. Canonical owner inputs appear once in the task timeline, keyed by accepted request ID; resupplying the brief is execution context, not another public user message. Continue appears as an execution boundary, not a forged user instruction. Reuse Pi's custom input entry/payload separation for this projection and retain B28a outcome identity.

Task context contains no automatic Core direct history, other task/group history or copied conversation search results. Read Core/shared memory under private-context rules, without memory writes. Use Core's configured model, thinking level and standing instructions with existing next-request configuration semantics. Compose/freeze initial methods at acceptance; defaults changing later do not replace them. If an unadmitted Run needs missing retained bytes or methods, fail visibly without partial/empty inference. Already admitted submissions reconcile by stable Pi request ID before reloading input material.

Atomically commit task identity, registry entry, typed channel and configured Pi conversation, accepted input anchor, queued Run and receipt before any inference. `ensureChannel` already creates/configures a conversation inside a Pi transaction; extract a transaction-aware helper instead of nesting independent commits. Follow-up/Continue atomically links one new Run, clears the old stop intent/settlement and writes its receipt; follow-up also appends its accepted input. Serialize active-count checks in that same transaction. Failure leaves no executable orphan and no accepted receipt without its task/Run. Scheduler notification happens after commit; recovery discovers an accepted queued Run if notification was lost.

### 3. Control transactions and stop ordering

A task is busy from queued acceptance through confirmed settlement, including approval waits. While busy, `tasks.submit` rejects without accepting new input. Desktop may keep an unsent local draft but the Host has no pending replacement. Stop-to-edit invokes Stop only; settlement never sends the draft. Two simultaneous submissions for an idle task cannot both succeed.

Stop orders as follows:

1. Under the existing short authority admission coordinator, revalidate request identity, expected revision/Run and task ownership. Commit the task stop intent and operation receipt; increment command revision if intent changes. The same coordinator orders executor dispatch admission against this commit. Persisted intent, not an in-memory cancelling set, is authoritative.
2. After commit, acknowledge promptly and invalidate the task view. Cancel task approvals and close task admission/publication. Start scoped Pi cancellation and executor revocation outside the coordinator and scheduler queues. Neither tool completion nor cancellation waits may hold those queues.
3. Enumerate this Run's durable invocation intents through existing policy operations. Dispatch admitted before the fence may finish; dispatch after it is denied. The list becomes closed once the fence commits. Use existing `execution.revoke` with the selected invocation IDs, never conversation-wide/global quiescence for an ordinary task Stop. Split requests within its existing 4,096-ID transport bound if necessary.
4. Settle only when Pi submissions/tasks and all accepted executor operations for that Run are confirmed quiescent. A completed known receipt is already effect evidence; a missing receipt or timed-out transport is not proof no invocation ran. Confirm scoped revocation even across a lost dispatch response. Retain unresolved intent and capacity until confirmation.
5. Commit settlement for the same Run and publish Stopped or Needs attention. Do not let a late completion clear the stop intent. A terminal Run outcome and a live stop intent may coexist until the latter settles; the task projection and occupancy respect the intent.

For a queued Run with no Pi/dispatch admission, commit cancellation and settlement with Stop; no executor/model call is necessary. A Stop of an already quiescent completed/failed/stopped Run is an acknowledged no-op, retaining any result; it never changes that outcome to success or cancellation. Rechecking an existing stop uses a new request ID, keeps the same intent/command revision, and schedules reconciliation. A request-ID replay may reattach to reconciliation but never grants execution.

Validate trusted task membership and `currentRunId`, no stop/interruption, current policy and lifecycle at model-request admission, tool preparation, after asynchronous policy/approval work, and inside final transport admission. Host `send_message` must check the same task record inside its publication transaction. No asynchronous read/check followed by an unprotected write is sufficient. A call or answer admitted before Stop can remain historical evidence; after Stop it cannot begin another effect or become the current task result.

In particular, `ExecutorConnection.invoke` awaits process startup and authority synchronization before sending. Its existing pre-wait authority check is not the final fence. Add a narrow Host admission callback after those waits: under the same authority coordinator, revalidate the bound task/Run and current authority, synchronously enqueue `tool.invoke`, then release before awaiting its result. Do not hold or recursively await the coordinator across executor startup/synchronization. A Stop committed while either wait is held prevents that send. Apply the equivalent last check at a task model's actual provider-request boundary after asynchronous preparation; an already issued provider request may still return after cancellation, but cannot publish or dispatch further work.

A task's Run ID, channel and task manifest must agree; absent/contradictory records fail closed. Task identity is never accepted from model arguments. The trusted `task` origin keeps task approvals unattended with the existing ten-minute expiry, independent of which view is open. Expired, denied or prior-Run approvals cannot be reused after Continue. Approval decisions, including persistence of an Always allow rule/grant, revalidate the task's current Run and stop/interruption fence inside the approval transaction: a stale button after Stop must not save new authority even if subsequent dispatch would be denied. Authority already committed before Stop is not rolled back.

### 4. Scheduling and Core responsiveness

Keep the configured cap `C` (default 3); do not add a hidden slot or auxiliary model loop. Ordinary direct/group/routine Runs retain their Bot exclusion key. Task Runs use their own task conversation key, so Core's direct lane and two task lanes can coexist. One task conversation has at most one admitted or settling Run, and tools remain sequential within each Run.

Define an occupied slot as an admitted Run not yet proven quiescent: running, approval-waiting, stopping or interrupted-but-unsettled. Count it once even if Pi already recorded a terminal outcome. For task Runs, release requires the per-task settlement record for that Run; write it after normal completion as well as cancellation, once outstanding operations are reconciled. A queued Run that never admitted Pi uses no slot but keeps its task busy. On restart restore occupancy before considering any new admission; owner acknowledgement cannot override uncertain liveness.

While any task is queued, admitted or settling, and `C >= 2`, reserve one slot for an eligible direct Core user Run. All other occupied Runs together may use at most `C - 1`. Do not lend the reserved slot while Core is idle. A stopped/failed/archived task with no outstanding execution does not retain the reservation.

| Situation | Admission rule |
| --- | --- |
| `C = 3` | Up to two general Runs plus one direct Core Run; two tasks do not block an otherwise eligible Core request. |
| `C = 2` | One general Run plus one direct Core Run. |
| `C = 1` | Serial execution; UI explains that task work and Core share one slot. Host reads/Stop remain available. |
| Existing ordinary work already fills the cap when a task is accepted | Drain without preemption; stop admitting general work until the reservation is established. Show Waiting for capacity. Never cancel unrelated work to make the promise retroactive. |
| Approval or stop remains pending | Keep its slot and lane occupied; another task cannot bypass the cap. |
| Core has its own ordinary direct/group/routine work | Preserve legacy Bot exclusion; the reserve does not preempt it. |
| Global gate closed | Accept new tasks/text follow-ups only when otherwise eligible, queue them, and admit nothing. Continue requires Resume work first. Stop/reads/settled archive remain available. |

Among eligible general-slot candidates preserve the existing direct priority and 30-second aging rule, using accepted timestamps. With a reservation, service an eligible direct Core request from that capacity first; no fairness claim allows borrowing it. Do not hold scheduler serialization while awaiting model completion, network/file work, cancellation or executor settlement. If Pi input submission needs I/O beyond its durable admission, separate the notification/wait from the short transition; a held provider/tool gate must not block a new Core acceptance or task Stop.

The promise is admission independence from these task workers, not LLM response time, provider quota isolation or preemption. Provider throttling, Core's own work, lifecycle pause and `C = 1` remain visible limits. Task usage is recorded once under Core using existing Run usage records, with a task reference for attribution; no second cost ledger.

### 5. Context and tool authority

Upgrade channel resolution to distinguish direct, group, routine and task. For task records persist `kind: "task"` and `taskId`; legacy rows migrate to explicit group/routine kinds without changing IDs. Unknown kinds, missing task records and mismatched Core/task/Run references fail closed. No fallback from an invalid task to direct or group authority.

Task tools are exactly `local_read`, `local_list`, `local_write`, `local_edit`, `artifact_publish`, `web_search`, `web_fetch`, `skill_load`, eligible `memory_search`/`memory_read`, and `send_message`. Enforce both runtime registration and Host admission. Skills and future tool registrations cannot widen this list. No shell, connector, background-command control, management, delegation, memory write, skill saving, routine proposal or Code Mode is enabled. Unsupported requests receive an honest capability explanation.

Host allocates and binds `<workspace>/tasks/<taskId>/` and each Run's `<taskRoot>/<runId>/` under the granted workspace. No shell creates these directories; existing authorized file calls create output files/parents as needed. Canonical roots must remain at the bound locations; traversal or symlink redirection to other task/Run roots fails. Every task Run writes and publishes only from **its own Run subdirectory**, intersected with current policy write authority. It can read prior outputs under ordinary read grants. Refinement produces a new result version rather than overwriting an earlier Run's work.

Apply the output boundary before approval, after any approval-expanded grants and again when building existing executor invocation grants. Other permitted paths remain read-only. `artifact_publish` must enforce the same source-root boundary. Require `expected_sha256` for task `local_edit`; `local_write` retains existing replacement semantics inside that Run directory. A task cannot overwrite original files or another task/Run's output, even with Allow once/Always allow. Revocation still wins. This needs no executor wire-format extension, new adapter or OS sandbox. The owner or other authorized application flows can still edit workspace files; no filesystem race isolation against those writers is promised.

Audit and update these existing branches explicitly; do not apply a repository-wide context framework refactor:

| Existing owner | Task-specific change required |
| --- | --- |
| `agent-runtime/src/index.ts`, `channels.ts` | Creation/reopen/profile configuration, memory projection/tool refresh, request/tool binding and scoped interruption must use the trusted kind. Do not install group/app/connector privileges in task contexts. |
| `agent-runtime/src/messages.ts`, `message-records.ts` | Task publication and outcomes bind current Run/stop intent; task messages do not require group delivery and never publish to direct Core. Preserve exact B28a answer identity. |
| `server-core/src/groups.ts`, `background.ts`, `routines.ts` | Skip task channels in group observers/admission and reject task-origin delegation/background/routine entry paths. No changes to ordinary delivery roots. |
| `server-core/src/runs.ts`, `authority.ts`, `index.ts` and `apps/local-server/src/tools.ts` | Task acceptance/lane/occupancy, unattended binding, short dispatch fence, last-stage grant narrowing and public IPC isolation. |
| History resolver/index and Desktop selectors | Task partition under Core; no direct-feed, public search, read/unread or group projection leakage. |

If an additional channel branch is discovered, extend its task-kind handling within these contracts. A required change to authority, public methods, persistence format or supported capabilities returns to design with a dated finding.

### 6. Lifecycle and recovery

Persisted Stop survives restart, view changes, late answers and Resume work. Global lifecycle gates remain authoritative. Window closure preserves menu-bar execution; lock retains existing supported non-interactive behavior. Sleep/Quit/pause/Host or executor loss use existing B14b interruption and reconciliation. Waking may reopen the global gate under existing rules; it must not create a replacement Run for an interrupted task. Only a previously queued, never interrupted Run can start through ordinary admission after the gate opens.

Distinguish these recovery states in both API and UI:

| Evidence | Behavior / exit |
| --- | --- |
| Old execution may still run, or scoped stop confirmation is missing | Needs attention: stop not confirmed. Keep the lane/occupied slot and reject follow-up/Continue/archive. **Check stop again** invokes idempotent reconciliation through `tasks.stop`; restored connection or existing lifecycle recovery can establish quiescence. No owner override. |
| Quiescence confirmed; some side-effect receipts remain unknown | Release capacity, retain unknown receipts and show affected operation/path evidence. Follow-up/Continue requires an explicit acknowledgement of the current evidence. It creates a fresh Run/output directory; it never replays the old invocation or marks its receipt succeeded. Archive is allowed with the uncertainty retained. |
| Quiescence and effects known | Follow-up, or Continue for stopped/failed/interrupted work, may start once lifecycle permits. Re-evaluate policy and approvals normally. |
| Accepted queued Run has no submission | Recover the same Run/input IDs; do not create another task. Respect a committed Stop and the global gate before Pi admission. |
| Pi accepted input but submission association was not stored | Resolve by its stable request ID and attach to the same submission before retrying materialization. This is logical input deduplication, not exactly-once provider inference. |
| Canonical answer committed before crash | Recover its exact B28a anchor and outcome. Do not generate another answer or completion notification/model call. A later Stop/new Run is not cleared by finding that answer. |
| Restore or missing workspace output | Restore stays paused. Published artifact bytes remain available under B14d; working folders are not backed up. Explain missing files; never pretend prior workspace state was restored. Fresh continuation writes only its new directory. |

The recovery acknowledgement is not a new policy approval system. `tasks.get` supplies an opaque token bound to task ID, current Run, command revision, confirmed quiescence and a digest of current unknown invocation evidence. Desktop shows those operations and the text **Continue with uncertain previous effects** before submitting that token with either input or Continue. The acceptance transaction revalidates the evidence/token and records the acknowledgement in the operation receipt. Changed evidence/revision rejects a stale token; never acknowledge an unconfirmed stop. Normal follow-ups with known effects need no extra confirmation.

An unknown file receipt cannot be inferred successful merely from today's file contents. Existing artifact receipt reconciliation may resolve what it can; otherwise preserve uncertainty. A fresh Run receives the uncertainty evidence and must inspect available prior outputs before deriving its new report. Do not retry old effect intents under new IDs. The fresh output directory provides an enforceable boundary for the allowed write tools; it is why broad shell/connector work is excluded.

Use existing scoped `execution.revoke`/`execution.quiesced` confirmation. Its conservative false/timeout is not success. If the first attempt cannot establish quiescence, retry reconciliation after connection/process recovery; `confirmStopped` can establish that old local file execution is gone while its effect remains unknown. Do not weaken general shell/process checks to make tasks continue. Ledger uncertainty and the Host's occupancy evidence remain separate facts.

### 7. Reading and Desktop interaction

Core details gains **Tasks**, an archived filter and **New task**. No new Bot row or top-level project manager. Selection uses `{ coreBotId, taskId }`; keep it across restart and fall back to the task list if stale. Create opens a destination-labelled draft; acceptance opens the task only if the owner has not navigated elsewhere. Initial input is sent directly to the Host, without a Core rewriting/model call.

Task cards show title, derived state and current result/action. Selected task uses the existing conversation shell with `Core / <title>` and **Back to Core**. Drafts and immutable send attempts are keyed separately for Core, each task and each new-task draft. Late acceptance clears only the exact submitted draft. A task ID accepted after a lost response remains discoverable via receipt replay/list. A Stop captured on A never follows selection to B.

| Task facts, in precedence order | Display / actions |
| --- | --- |
| Unconfirmed interruption/failed stop check | Needs attention; inspect, Check stop again |
| Stop requested and settlement pending | Stopping; preserve draft; do not send automatically |
| Current approval pending | Awaiting approval; existing Allow/Deny, Stop to edit |
| Queued and global gate closed | Paused; explain Resume work, Stop |
| Queued and gate open | Queued / Waiting for capacity; Stop to edit |
| Admitted | Working; Stop to edit, draft editable locally |
| Settled with unknown effects | Needs attention; explicit recovery acknowledgement for input/Continue, archive |
| Settled owner Stop / lifecycle interruption / failure | Stopped / Interrupted / Could not finish; input, eligible Continue, archive |
| Settled completed with committed answer | Result available; read/refine/archive |
| Settled completed without a deliberate answer | Finished without a result; follow-up/archive, no fabricated final answer |

The global paused banner remains visible even when a task's more specific state takes precedence. An older result remains readable but never overrides current uncertainty or execution. Result available is not owner acceptance or independent verification. No new acceptance/review status is introduced.

Extend existing `conversations.window`/detail selectors with `taskId`, mutually exclusive with `deliveryId`/`occurrenceId`, valid only under `bot:<coreId>`. Host resolves and verifies the task/Core/channel relationship for every read. Use B14c's internal `(conversationKey, selectorKind, selectorId)` partition and bind cursors/detail anchors to it. Reuse row/byte/window/cache bounds. No new public `task:` conversation key, task global-search corpus, read receipt, unread counter or model history access is added. Opening Core cannot mark task results read because this increment has no task read/unread state.

Reuse the existing pull-credit observation stream and `bots` invalidation bit for task metadata/control changes. Refresh bounded cards only when the task list is visible and the selected task's snapshot/window when selected; do not wait for the direct-only Core feed to expose channel events. Streaming/history changes must invalidate the selected partition. Reconnect/full refresh re-reads these surfaces under existing stale-response guards. No extra observation topic, polling loop or observer per archived conversation.

Task messages, approvals and final answers stay in that partition. Published files reuse Library/readers. Core gets no duplicate assistant result and completion triggers zero model requests. Existing Bot-level approval totals and power/work aggregation include task work exactly once, while Core's direct `lastRun`, previews and native result notices remain direct-only. Task result notifications and dock unread counts are out of scope. Use existing English/Chinese localization conventions and fixed activity labels.

Metadata registry/channel reads may grow with retained tasks, as current channel storage does; do not promise constant-time startup. Read no archived transcript/input/receipt history on ordinary startup/list refresh. Paginate archived cards and selected history. Rebuilding a lost derived history index may scan canonical metadata/evidence under B14c's existing rebuild contract; no new general-purpose task search/index subsystem is required.

### 8. Compatibility and retention

Upgrade `openbot.channels` from version 1 to 2. The migration preserves every Bot/channel/Pi conversation identity and classifies legacy `routine_` channels as routine, other existing channels as group. Direct conversations remain in the existing Bot mapping. A task row requires its task record and Core relationship; do not create tasks from old conversations. Persist the version-2 document in a real commit during runtime open **before any Pi resume/model dispatch**, not just a materialized migrated snapshot. Pi's existing newer-document rejection must make the baseline Host fail closed before inference or tool dispatch on that database. No vendor patch is authorized.

Keep backup manifest version 1 and existing managed roots/exclusions. Change `BACKUP_RUNTIME_VERSION` from `openbot-agent-runtime/1;pi-b45e0ebcc5ae2fc42a6f2f23104d10e656e6bedb` to `openbot-agent-runtime/2;pi-b45e0ebcc5ae2fc42a6f2f23104d10e656e6bedb`. New exports use only the latter. New restore validation accepts exactly these two known tokens, with the existing protocol/Mac checks; legacy payload migrates in the controlled restored store before resume. Unknown runtime generations or Pi revisions fail. The baseline's exact token comparison rejects new exports. Do not add capability negotiation or a manifest version solely for this feature. If the implementation base has deliberately updated Pi, the token/migration fixture must return to design rather than silently claiming this compatibility.

The Host database snapshot includes task manifests, accepted input references, operation receipts and canonical messages. Published bytes remain in existing artifact storage; workspace output directories and credentials remain excluded. Restore is paused; caches rebuild from canonical sources. Downgrade of a migrated live store is unsupported; rollback uses a verified pre-upgrade backup. Validate migration failure without admitting work or damaging that backup.

Archive hides settled work and frees an active slot; it neither deletes evidence nor restores grants. Keep task current/pinned inputs and operation receipts independent of Run pruning. Extend the existing 50-terminal-Run retention rule to each task channel; keep its current and any unsettled/reconciling Run even when terminal. Earlier canonical messages/outcomes remain readable after Run pruning. Do not retain every old Run in the scheduler at startup. Task registry and receipt storage have lifetime metadata growth; deletion/compaction beyond existing retention is deferred, not silently implemented as archive.

## Steps

1. Add protocol owner methods/selectors, typed task context and versioned durable acceptance/receipts. Verify atomic failure/replay, old-data migration and baseline refusal before wiring task inference. Keep transaction helpers in `agent-runtime` and application orchestration in `server-core`.
2. Implement task allowlist, scoped publication and output grants, scheduler lanes/reservation, durable Stop and reconciliation using existing ports. Prove race/occupancy behavior with deterministic gates before exposing creation in Desktop. `tool-router` depends only on protocol and application ports; it must not read Pi/task storage directly.
3. Add task cards/selection/drafts, private history partition and recovery controls. Reuse existing observation, readers, approval and attention infrastructure. Wire through existing composition roots; no business state in Desktop/main or new service.
4. Complete acceptance below, full checks/e2e and screenshots, then record evidence in this spec or one dated linked record. Keep status in review until the owner merges. Do not ship partially working creation without Stop/recovery and authority enforcement.

## Acceptance

This table preserves the implementation acceptance contract. The [dated acceptance record](../acceptance/2026-11-02-b29-local-task-continuity.md) maps it to executed task-specific and shared-path regression evidence; proposed test homes below are not a second test inventory. Use deterministic ScriptedModel/provider/tool gates, Host `h.api()`, `h.nextFrame()` and observed events rather than fixed delays. Every changed owner flow needs e2e coverage.

| ID | Required case and observable outcome | Test home / name |
| --- | --- | --- |
| T01 | Inject failure before/after acceptance commit and Pi submission; restart/lost IPC replay creates exactly one task, channel, Run and visible owner input. Different arguments conflict even after Run pruning; changed defaults/missing library do not invalidate an accepted replay. | New `agent-runtime/test/local-tasks.test.ts`: `atomic acceptance and durable replay` |
| T02 | Stop before initial Pi admission, then submit “change the dates”; all original input/pins and ordered refinements reach the new Run. Repeat Continue without duplicating public owner rows. Enforce byte/count bounds atomically. | Same: `retained brief survives pre-admission stop`; Host task tests |
| T03 | Hold two tasks on independent gates at `C = 3`; ordinary Core is admitted and answers before either is released. Different contexts never mix, no Bot/group is created. Hold one task in a tool while Core acceptance and task Stop acknowledge/render without releasing the tool gate. | New `e2e/local-tasks.e2e.ts`: `two tasks leave Core responsive` |
| T04 | Exercise `C = 1, 2, 3`, saturated legacy work, approval waits, terminal Pi with unconfirmed executor stop, restored occupancy, aging and reservation release when last task settles. Never exceed cap or overlap one task's Runs; no unrelated preemption. | Extend `server-core/test/runs.test.ts`: `task lanes reserve capacity and count settlement` |
| T05 | While A and B run, Stop-to-edit A preserves its draft, rejects active submit and starts no replacement on settlement/restart. Explicit later Send creates one Run; B/Core unaffected. Concurrent idle submits yield one accepted Run; stale Stop/Continue cannot hit it. | New `server-core/test/local-tasks.test.ts`: `explicit edits and stale controls`; task e2e `stop then send a correction` |
| T06 | Stop races before policy, across approval resolution, at durable dispatch intent/transport, during executor startup/authority-sync and model preparation, with queued admission and with final publication. After the committed fence no new model/tool/publication admission; earlier admitted effects may finish. No lock is held during those waits. | Extend `server-core/test/authority-coordinator.test.ts`, executor-connection and adapter message tests: `task stop linearizes with admission` |
| T07 | Lose revoke response or return unconfirmed; Stop acknowledges but retains occupancy and forbids Continue/archive. Recheck after recovery establishes quiescence. Unknown file effect remains unknown; only an exact current owner acknowledgement admits a fresh Run/output directory. Changed token fails; replay after later Stop never restarts. | Host task tests: `quiescence is separate from effect certainty`; task e2e `review uncertain effects` |
| T08 | Inject crashes around stop intent, settlement, fresh-Run commit and result commit; simulate sleep, Quit, pause, executor loss and restore. Resume never clears task Stop or auto-replaces interrupted work; queued never-interrupted work respects gates. Exact final result survives crash without extra inference. | Extend `server-core/test/lifecycle.test.ts`, adapter fault injection and `e2e/recovery.e2e.ts`: `task recovery boundaries` |
| T09 | Forge task tool/model application calls, origin/channel/Run references and skill instructions. Shell/connectors/management/delegation/memory writes/Code Mode fail; generic message/cancel/continue/reset cannot bypass task authority. Private memory reads work; group observers skip tasks. | Extend channel/router/Host tests: `task context fails closed` |
| T10 | Task A creates/edits/publishes its report; input path, another task, prior Run directory, traversal, redirected root, missing edit hash and approval-expanded escape fail at Host and narrowed executor grants. Reads retain current policy, revocation wins, unsupported requests explain limits. | Existing executor file tests plus task Host tests: `fresh Run output grants`; task e2e |
| T11 | New database/legacy store and backup preserve IDs and create no tasks. Persist migrated version; baseline `1b550b9` Host fails before any inference/dispatch; baseline backup reader rejects the new token. Unknown tokens fail, legacy restore migrates/pauses and migration failure is recoverable. | Adapter compatibility fixture and `server-core/test/backup.test.ts`: `task store upgrade and downgrade refusal`; backup e2e |
| T12 | Task approvals expire at the unattended deadline across reopen/view selection; old approvals cannot authorize new Run; ordinary direct attended approvals unchanged. Usage counted once, task generated activity never starts auxiliary inference. | Approval/usage tests: `task origin remains unattended`; task e2e |
| T13 | Rapidly switch Core/A/B/new-task drafts across lost/delayed acceptances; text/pins/destination survive. Capture Stop on A then select B; only A stops. Show recovery and capacity limitations in English/Chinese at supported window sizes. | Composer tests and task e2e `destination-safe task controls`; inspect screenshots |
| T14 | Exact B28a task messages/results appear once in the selected private partition, absent from Core direct feed/public search/unread and model context reads. Cursor from A rejected for B; reconnect/index rebuild/pruned Runs preserve anchors. Completion makes zero extra model calls. | Extend history/message/index tests and task e2e `isolated bounded task history` |
| T15 | Enforce 32 active tasks during simultaneous creates/unarchives; archive only settled work and start nothing. With 1,000 archived tasks and 10,000 rows in one task, list responses obey 32/64 KiB and history B14c bounds, no transcript observer per archive, no archived input/receipt scan on list refresh. | Adapter bounded fixture and task e2e `archive and bounded reads` |
| T16 | Task work/approval counts participate once in power/attention even with window closed, while direct lastRun/previews/native notices remain unchanged. All ordinary Core/Specialist/group/routine/B15b flows retain acceptance. | Desktop attention tests, existing regression suites and task e2e `task attention without duplicate completion` |

Required implementation verification: `pnpm run check`, full `pnpm run e2e`, inspect relevant screenshots (including English/Chinese controls and uncertainty), refresh shard timings after adding the suite with `node scripts/e2e-shard.ts --record e2e/.run/timings.json`. Use the isolated background app only. The baseline compatibility fixture must exercise old code in an isolated temporary checkout/store or equivalently pinned test harness, never owner data; inspecting a version number alone does not prove fail-closed startup.

Measure local acceptance/admission separately from provider response. The deterministic gates above prove independence without a fabricated latency SLA. A budgeted isolated real-model report trial may supplement usefulness evidence; it cannot replace deterministic ordering/authorization tests or native packaged lifecycle evidence.

## Risks

- Cancellation may settle slowly or remain unconfirmed. Keep the occupied slot and visible recovery action; never claim termination because a timeout elapsed. This can reduce capacity until executor/lifecycle recovery succeeds.
- Replayed bounded briefs add model input cost. Keep the explicit limits and existing usage attribution; do not add background summarization or another model loop to hide this cost.
- Shared filesystem and model endpoint resources remain shared. Per-Run output roots prevent task writes to earlier/other results, not arbitrary external writes or provider throttling.
- Live channel/backup compatibility is safety-critical: older code treats generic channels as groups. Test actual old-reader refusal before dispatch, and retain pre-upgrade rollback data.
- Native lock/sleep/power delivery still needs the separately tracked packaged Mac evidence. Background tests establish application logic, not OS delivery/signing guarantees.

## Open questions

None at ready publication. During implementation, record dated contract mismatches here and stop the affected slice; continue independent work. Do not broaden capability or persistence contracts to make a test pass.

## Evidence

Design review on 2026-11-02 used `1b550b9` and relevant later-main differences through `f45a707`; [D11](d11-local-task-continuity.md#review-evidence) preserves that review. Implementation, T01–T16 evidence mapping, regression results, inspected screenshots and unverified native boundaries are maintained in the [dated B29 acceptance record](../acceptance/2026-11-02-b29-local-task-continuity.md). The owner merged [PR #84](https://github.com/VesperZephyr/OpenBot/pull/84) at `a15bd9f` on 2026-11-02.
