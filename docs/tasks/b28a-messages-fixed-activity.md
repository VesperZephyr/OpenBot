# B28a: Deliberate Bot Messages and Fixed Activity Status

Status: in review
Branch: `task/b28a-messages-fixed-activity`
PR: [#73](https://github.com/VesperZephyr/OpenBot/pull/73), based on `task/b28-message-status-design`; owner merge pending
Depends on: B13c, B14a–B14d, B15b, B22–B23, D8; reconcile with B11e before implementation
Architecture: Sections 5.1–5.3, 5.7, 6.1, 7.1–7.3, 8.1–8.3

## Goal

Show deliberate updates, final answers and actionable errors in chat while keeping routine execution feedback in a compact, truthful activity row. Preserve Pi's canonical answers and the existing Run lifecycle. This batch makes no additional model requests. Optional AI phrasing is a separate dependent task, [B28b](b28b-generated-activity.md).

## Scope

In: a routed `send_message` Host tool; public presentation for new direct/group Runs and their background continuations; explicit error/recovery presentation; history/search/unread consistency; fixed activity derived from actual execution identity; compatibility and automated acceptance.

Out: AI status generation, usage-accounting changes, a new service/package, a second final-answer store, external/cross-conversation messaging, structured question tools, task agents, remote Targets, browser/computer control and routine publication changes. Routine execution details retain their existing transcript behavior; they may reuse fixed activity labels. Routines and scheduled group reports do not gain intermediate messages.

## Design

There are three independent surfaces:

- **Messages:** explicit `send_message` updates and the exact settled Pi answer. These are searchable, durable conversation content.
- **Execution outcomes:** errors, interruptions, approvals and recovery controls. These survive even when ordinary assistant prose is hidden.
- **Activity:** a localized fixed label from current Host facts. It is ephemeral, never a message or evidence that an action succeeded.

Keep the native final-answer path because Pi supplies the answer identity already used by group delivery, routines and usage links. Do not copy final answer text into a second public-message store or require a final message tool. New visibility metadata must be committed with existing outcome persistence, not managed by a second publication queue.

### Ownership

| Module | Responsibility |
| --- | --- |
| `protocol` | Message tool schema, update provenance, outcome/activity projections; no Pi types |
| `server-core` | Message authorization, group-context selection policy, Run/control-state priority and fixed activity reducer |
| `agent-runtime` | Stable invocation/input/answer mapping, atomic writes, common public-history selection and Pi observation adapter |
| `tool-router` | Existing target/policy/lifecycle checks and dispatch observations through ports |
| `apps/local-server` | Wire ports; no application policy in composition |
| Desktop | Render committed messages, outcomes and fixed labels; existing observation cursors order snapshots |

Executor authority and receipt storage remain unchanged. Model/connector endpoints can work remotely; absence of local process or file activity never establishes their progress.

## Contracts

### 1. Deliberate update tool

Register non-deferred Host tool `send_message`, capability `conversation.message`, strict arguments `{ text: string }`. Require non-whitespace text of at most 16 KiB UTF-8; reject extra fields and oversize input rather than truncate it. Render existing sanitized Markdown. The model cannot choose a recipient, Bot, conversation, Run, Target, artifact path or completion state.

The adapter binds originating Run, Bot, conversation, stable call ID and local Target. Host validates the binding and destination immediately before the atomic write. All normal policy and lifecycle gates apply; the capability default is allow for an eligible Run. Code Mode children cannot invoke it. Replay of an already committed invocation may return its receipt without creating another effect; a new effect requires a currently eligible Run.

| Context | Destination / availability |
| --- | --- |
| Direct user Run | That Bot's direct conversation |
| Group user/peer/result delivery | Its assigned group, attributed to the Bot and linked to the existing post/root/delivery |
| Background continuation | Only its existing B15b destination, with existing suppression/eligibility checks |
| Routine or scheduled report/summary | Tool absent; forged invocation rejected |
| Missing, queued, terminal or mismatched Run | New publication rejected |

Updates do not settle a Run, wake peers, create deliveries, change ownership or consume automatic-delivery slots. Cancellation does not retract committed updates. Membership/dissolution and publication have a serialized outcome: the message committed while authorized or no message was created.

Use the existing `${conversationId}:${callId}` invocation identity and an argument digest. Atomically persist the message and its durable receipt. Same identity/digest returns `{ messageId, publishedAt }`; another digest fails. Direct updates append a versioned `openbot.bot-message` entry with text, time and trusted provenance. Group updates append to the existing canonical group posts with `kind: "update"` and equivalent provenance. They do not become synthetic user input; the original tool call already supplies the model context.

Bound updates to 16 messages / 128 KiB per Run, including steers. Commit counters with the message; replay consumes no additional quota. Exceeding the quota returns a fixed tool error and leaves the final-answer path available. Message/receipt identity remains valid after Run pruning. Keep receipt lookup indexed by invocation; do not load an ever-growing receipt map or scan conversation history per send. Backup includes these Host records.

### 2. Final-answer visibility without a second answer store

Pi submission settlement is the authority. The exact `submission.answer` entry supplies the final text and existing public message ID. Multiple inputs sharing that entry produce one visible answer; distinct answers retain their original entry ordering and IDs. A `send_message` receipt never identifies a final answer.

Add a versioned, content-free `openbot.input-outcome` entry when recording a new input outcome in the existing Run-store transaction. It references Run, input request/submission, canonical user-input entry when present, outcome category, and canonical answer entry ID when answered. It does not duplicate input/answer bodies, tool output or provider error strings. Write it once per input outcome transition, atomically with that transition; repeated Run puts/recovery do not append duplicates. This is visibility metadata, not a new delivery state machine. Final Run settlement and existing group/routine reconciliation retain their ordering and authority.

For answered inputs, the adapter reads the committed Pi settlement and records only its actual answer reference. Host-withdrawn inputs retain a distinct withdrawn category from the existing scheduler; they are not model failures and need not already be settled in Pi when the Host records withdrawal. Reopen observes unresolved accepted inputs using existing Run recovery; a crash between Pi settlement and Host outcome persistence is resolved by the same observation. Cancellation/withdrawal follows existing scheduler precedence and cannot relabel an unanswered input as answered. Do not regenerate a response to repair its projection. Run-level interruption is recorded separately as specified below; it does not depend on a Pi input outcome transition.

An outcome-entry commit invalidates both bounded history and lightweight conversation activity. Resolve answer/input references with bounded identity lookups. An answer may have been scanned before its outcome marker; the marker must upsert that earlier answer's derived row at its original position. Deduplicate by canonical answer ID in derived storage/counting. On rebuild, process markers incrementally with bounded reads; never require a retained Run record or rescan the full transcript on each update. Preserve usage result links to the canonical answer ID.

Group finals keep `reply:<deliveryId>` and the existing atomic delivery completion; routine reports keep occurrence/report publication. Neither is replaced by update concatenation or the direct-chat visibility record. Private group execution detail may resolve its own canonical final answer, while the public group history continues to use group posts.

For a successful empty direct answer, show attached valid result artifacts if present; otherwise show a localized system note, “No final text was returned for this input.” This does not announce completion of other inputs in the Run. Preserve artifact attribution to the exact input interval. A child delivery ending without text does not mean the collaboration root is complete: retain its recorded state in task details and let existing root reconciliation determine the group outcome. Do not invent a group-wide completion message or promote an earlier update to a final answer.

### 3. Errors and recovery survive hidden prose

For new-mode inputs, derive an input outcome row from `openbot.input-outcome`, using stable identity `outcome:<submissionId>` (or the existing failed-admission identity if no submission exists). Categories include failed, cancelled, withdrawn and answered-without-content. Render fixed localized error categories; reuse existing sanitized diagnostics where supported, never the failed assistant's partial prose or raw provider response. Keep tool failures/approvals available independently of these rows.

Also append versioned, content-free `openbot.run-outcome` metadata in the **same existing Run-store transaction** whenever interruption intent, interruption settlement, or an abnormal terminal state is first recorded or materially changes. Cover `interruptAll`, `interruptSelected`, queued cancellation and eligibility-recovery cancellation even when `inputs` is empty or no input has an outcome. Record trusted Run/Bot/channel identity, origin, input request/submission references where available, state, fixed reason category, and requested/settled/end timestamps. Never copy prompts, fabricate Pi settlements or change scheduling to create this metadata. Compare with the prior stored Run so identical puts/recovery do not append again. A later completed state after recorded interruption intent appends a resolution; that old intent must not remain displayed as an active interruption.

All entries for a Run reduce to one stable row, `run-outcome:<runId>`, at the first relevant outcome entry's timeline position; later metadata updates that row by canonical entry order. Interruption intent displays “Stopping work” with no Continue action. Settled `needs_attention` displays the recorded interruption/unknown explanation and the existing Run-specific recovery action when authorized. Queued cancellation displays “Cancelled before starting”; it does not invent a failed model input or offer Retry/Continue. A resolved interruption that ended successfully ceases to show a warning; its final answer remains the canonical answer. Do not attach an “interrupted” category to every input merely because its Run was interrupted.

Coalesce system outcomes by trusted Run identity: the Run row owns interruption/cancellation; suppress matching input cancellation/withdrawal notices and the duplicate stopped note. For ordinary model failure, retain the causal input error and its input-specific Retry; suppress a redundant generic Run-failed row. A Host-withdrawn pending steer may be listed as “Not processed” in that outcome's details, but is never the failed input selected for Retry. Distinct earlier answers and tool evidence remain visible. If no causal input error exists, retain the Run-level failure explanation. Public outcome metadata renders even if a queued Run was cancelled before the conversation's prose cutover marker; the marker governs legacy assistant prose, not explicit system records.

Run-outcome commits invalidate history and lightweight attention projection just as input-outcome commits do. History rebuild resolves the latest Run row from its durable metadata without consulting retained Runs; pruning Run details cannot remove the explanation. Live recovery authority still comes from current Run/root state, never the historical row. Append metadata before pruning in the same transaction. The row may remain readable with its action unavailable after pruning, deletion or a later task. Do not reconstruct missing historical outcomes from only the latest-Run banner.

Expose Retry for the latest eligible model-failed direct **user** input while idle, using its exact original text, attachments and pinned skills through canonical input references and the existing retry API. Retrying creates a new user request as today; it is not an automatic replay of tools. A later actually failed steer targets that steer, not the first message of the Run or a later Host-withdrawn steer. Earlier successful answers remain visible. Background/routine synthetic input has no ordinary Retry button. For interrupted/unknown Runs, suppress ordinary Retry and offer the existing Run-specific Continue/review flow only after interruption settlement and only where that API authorizes it; group/routine tasks do not acquire private-task Continue. Stale/pruned action authority disables the action with an explanation; it does not prevent reading the historical outcome.

Retry/Continue must be attached to outcome identity, not “the last assistant bubble,” the currently loaded history window or presence of `assistant.error`. Cover failure before any update, after an update, after a successful earlier input, restart and index rebuild. Failed input hydration before Pi admission retains the existing user-input error representation without producing a second error row.

Outcome rows do not become Bot messages or unread-message increments. Attention and completion/failure notifications remain derived from authoritative Run/root state. Their existence must not mask approvals or hide Stop during ongoing work.

### 4. Public projection and upgrade boundary

Before the first new-mode input in each direct/group channel, append one versioned `messages-v1` cutover marker while no legacy Run is active. Existing active Runs finish with legacy presentation and tools; queued work admitted afterward uses the new mode. The durable conversation boundary, rather than prunable Run history, determines historical presentation. Routine channels keep their existing mode.

Before the marker, preserve existing IDs and visibility. After it, ordinary assistant prose/reasoning and `live.partial` are execution context. Public chat shows explicit updates, canonical settled answers, user/system/outcome rows, approvals, artifacts and expandable tool evidence. Represent successful `send_message` once as its message, not a second tool bubble; rejected/pending-approval calls retain actionable controls. Raw Pi context and compaction behavior remain unchanged.

Use one public-selection contract across snapshots, history pages/details, search, app conversation reads, previews and unread counts. Hidden prose and activity labels never become search hits. Updates are normal incoming messages and affect recency, but never fire task-completion notifications. Outcome rows have the separate attention semantics above. Preserve scrolling, drafts, artifact navigation and existing bounded-history guarantees.

Bump the disposable history projection version; rebuild from canonical entries, cutover/outcome metadata and group posts. New metadata and receipts are covered by Host SQLite backup; fixed activity is not persisted. Old-store reopen, Run pruning, compaction/new topic, rebuild and backup/restore must preserve IDs, counts and outcome navigation. Do not silently downgrade stores by deleting metadata; rollback to an older binary requires the existing supported backup/restore procedure and does not promise newer messages render there. No new protocol version is required while all consumers ship together under the current policy.

### 5. Group context selection

User-visible history/search retains all committed updates. Automatic group prompt assembly excludes posts with `kind: "update"` **before** selecting the last 12 eligible public posts. Legacy untagged posts retain current eligibility; never guess provenance from wording. Keep current truncation bounds and separately supplied current assignment/root identity. This preserves the existing eligible context budget for user posts, final results, reports and coordination notices without increasing it.

Apply this rule at every automatic group-context assembly path. Delegation result synthesis continues to use exact `reply:<deliveryId>` results, never progress updates. Explicit authorized history reads may retrieve updates when requested. The sender's own Pi tool-call history remains intact; do not promise that updates consume zero model context. Test the actual next main-model request after more than 12 updates and after several child Runs, including a final result and a user request.

### 6. Fixed activity and execution identity

The Host keeps a bounded process-local observation for each active Run. The adapter maps Pi identities to opaque product identities; Router/Host callbacks distinguish authorization/dispatch from a Pi tool slot that is merely running. No Pi types cross the adapter boundary. The internal observation carries:

- Run and conversation identity; an opaque execution key unique to the current generation attempt or routed invocation, including Code Mode child identity where applicable.
- Phase: preparing/generating, dispatching, waiting for a result, or settled; a finite built-in tool family; background task identity if applicable.
- Latest **consumed** input identity for that generation, when known. Accepted-but-queued/steering inputs remain pending. Unknown identity stays unknown rather than using the newest user message.

The execution key changes for a new generation attempt, a different routed invocation of the same tool family, a phase transition, or a newly consumed input. Only repeated progress/output events or duplicate observations **within that same invocation and phase** leave it unchanged. Two separate `task_output` calls have different keys even if they inspect the same background task; an intervening model request has its own key. A changed task ID also invalidates the observation. Identical fixed label text may remain visually unchanged, but invocation/authorization identity is never reused for display coalescing. There is no cross-call polling-deduplication fingerprint in this batch or B28b. Observe Pi preparation/request boundaries and placed-input ownership through the adapter; no filesystem/process polling and no full-history read for each event. Do not add model-binding or AI-specific metadata in this batch; B28b adds it at its actual request boundary.

Fixed labels are selected from a finite enum: preparing response, generating response, reading files, writing files, running command, searching web, reading web, using connector, working with application, sending update and waiting for result. Tool-family labels mean the operation has been authorized and dispatched, not that it succeeded. Before dispatch use preparing/waiting; before available executor acceptance evidence do not claim an OS process started. A command without an existing acceptance signal uses waiting for result; do not extend the executor wire protocol merely to obtain a more specific loading label. Unknown families and delayed remote services use waiting for result. Reuse existing approval/queued/retry/pause/cancellation labels.

Priority is terminal/interruption outcome → cancellation → pending approval/user wait → lifecycle pause → queue → main-provider retry → ordinary activity. Terminal settlement removes active loading immediately; a group root may still show another owner's ongoing work. Fixed status cannot grant permission, change Run state, trigger a notification or alter Stop. Submission and first-token waiting always have immediate feedback.

Expose only `{ runId, labelKey }` as the optional public activity field on live snapshots, including group tasks and existing routine execution views. Use existing observation stream IDs/sequences and resnapshot handling; no second public epoch/revision protocol. Internal execution keys support correct reduction and later B28b stale-response checks. Reconnect rebuilds facts, disconnect displays connection state, and terminal/deleted Runs release observations. No timer rotates text, no fabricated ETA and no new inference requests.

### 7. Main-model guidance

Replace “Reply first” / “Work out loud” for new-mode contexts. Preserve evidence, permission, unknown-outcome and artifact guidance. When `send_message` is available, include:

> The user sees deliberate send_message updates and your final answer. Ordinary intermediate text is not a chat update. Send an update when a finding, decision, meaningful checkpoint or blocker helps the user; avoid empty acknowledgements and tool-by-tool narration. The app shows activity automatically. An update does not finish the task. Continue until complete or blocked, then give a self-contained final answer with results and limits. Use existing approval controls for permission. Do not repeat an update verbatim unless necessary to answer the request.

Keep legacy instructions for active legacy Runs. Routine contexts keep their report guidance and do not advertise the tool. Do not advertise nonexistent structured question capabilities.

## Steps

1. Reconcile B11e and the implementation base; claim a separate branch only after design readiness and implementation authorization.
2. Add message schemas, target/origin authorization and atomic update receipts. Add cutover, input-outcome and Run-outcome metadata inside existing persistence; preserve canonical final answer IDs and scheduler settlement precedence.
3. Unify public projection and explicit outcomes across live/history/search/unread/usage references. Verify crash/rebuild behavior before enabling hidden prose.
4. Tag group updates and apply context selection independently of display/search. Preserve routine and background publication rules.
5. Add internal execution observations and fixed labels, prompt changes and shared bilingual Desktop rendering.
6. Automate acceptance, inspect screenshots and explore the new flow in an isolated background app. Update architecture only when the implementation changes its contracts; link evidence here.

## Acceptance

This is the implementation acceptance checklist. Dated results and verification limits are linked under Evidence.

1. Router/Host tests: forged destination/Target/Run, routine and Code Mode calls fail; policy and lifecycle/membership races preserve authorization. Replay after commit returns one receipt, another digest fails, and quota survives restart without double-counting.
2. Runtime tests: canonical final IDs/text remain unchanged; shared-answer steers display once; distinct answers stay ordered; Pi-settled/Host-not-recorded crash recovers through existing outcome persistence. Repeated puts, Run pruning and compaction do not erase visibility.
3. History/index tests: outcome-marker commits update previously scanned answer rows and lightweight counts; rebuild and backup/restore agree with live projection. No full-history scan per event. Run existing B14c bounded-history performance acceptance.
4. Error tests and desktop scenarios: errors before/after updates and failed later steers retain the right Retry input/attachments/skills; Host-withdrawn later inputs never replace the causal failure. Cover interruption before Pi admission, during a tool, permission revocation, crash after intent/before settlement, and queued cancellation with no inputs. Metadata and Run writes are atomic; repeated puts coalesce; Continue appears only with current settled authority. Verify interruption resolving successfully, no duplicate stopped/error row, no new group/routine Continue, and history after Run pruning/rebuild/backup restore. Synthetic inputs never get ordinary Retry; partial failed prose stays hidden.
5. Group model-boundary tests: more than 12 updates do not displace eligible recent user/final posts; several child Runs do not wake peers or inflate delivery counts; membership/dissolution fences hold. Root/child completion remains distinct.
6. Routine/background regressions: reports remain atomic; routine detail behavior stays intact; completion suppression and destination checks remain effective.
7. Activity tests with deterministic events: approval before dispatch, same-family invocations, Code Mode children, delayed connector, long background task, accepted/consumed steer, retry, cancellation and reconnect select truthful fixed labels. Two actual `task_output` calls separated by a model round have distinct keys, even for the same task ID; repeated progress inside one call preserves its key. Changed task IDs and consumed steers invalidate prior observations. B28a makes zero extra model requests.
8. Scripted desktop `message-activity.e2e.ts`: update appears during work, ordinary partial prose stays hidden, canonical final answer appears once, tool/approval evidence opens, search/unread/notifications and scroll/drafts remain correct. Adapt D8 streaming coverage for legacy versus new mode.
9. Inspect English/Chinese, light/dark, narrow layout, reduced motion and keyboard/screen-reader behavior. Keep approvals and Stop reachable. Run `pnpm run check`, full background `pnpm run e2e`, and refresh shard timings. Use `h.api()`, `h.nextFrame()` and observed signals.

## Risks

The visibility change intentionally replaces streaming prose for new-mode Runs. Immediate fixed feedback and durable explicit errors are required before enabling it. Updates can be verbose or wrong; receipts prove delivery, not truth. Message quotas bound storage per Run, while group prompt filtering protects future context. Projection failures must leave execution controls and error recovery usable. No real-model wording quality, native permissions, signing or remote-executor support is established by scripted acceptance.

## Open questions

None unresolved in the revised design. Contracts 2–3 cover input and Run outcomes separately; Contract 6 fixes exact polling identity. Implementation was authorized on 2026-10-31; B28b remains draft and excluded. If integration exposes a conflict with existing scheduler or Pi contracts, record the dated finding here and stop the affected step rather than changing settlement semantics implicitly.

## Evidence

Implementation acceptance, 2026-10-31: [message, outcome and fixed activity evidence](../acceptance/message-activity-2026-10-31.md). The implementation remains in review; B28b is still draft and excluded.

Design self-review on 2026-10-31 checked [Run lifecycle transitions](../../packages/server-core/src/runs.ts) and [Run-store transactions/pruning](../../packages/agent-runtime/src/runs.ts). Run-level interruption and queued cancellation now have metadata independent of Pi input outcomes, explicit intent/settlement/action rules and pruning/rebuild acceptance. Withdrawn steers cannot displace the causal Retry target. Empty-answer wording no longer claims completion of the whole Run. Separate polling invocations retain separate keys in both B28a and B28b; only duplicate progress inside a call preserves identity. No additional design blocker was found in this source/spec review. These are resolved design contracts, not verified runtime behavior; no code, vendor files or product tests changed.

Design-only source review, 2026-10-30, base `884892e`: [Run persistence](../../packages/agent-runtime/src/runs.ts), [Run settlement](../../packages/server-core/src/runs.ts), [answer lookup/live projection](../../packages/agent-runtime/src/index.ts), [transcript projection](../../packages/agent-runtime/src/transcript.ts), [bounded history](../../packages/agent-runtime/src/history-projection.ts), [lightweight activity](../../packages/agent-runtime/src/conversation-activity.ts), [group context/publication](../../packages/agent-runtime/src/groups.ts), [Desktop error rendering](../../apps/desktop/src/renderer/src/App.tsx), and [observation ordering](../../packages/server-core/src/observation.ts).

Pi's [transaction API](../../third_party/pi/packages/durable/src/types.ts) exposes `submissionByRequest` and `appendEntry`; [generation hooks](../../third_party/pi/packages/durable/src/harness/types.ts) expose request boundaries. These establish relevant seams, not completed integration or acceptance. No product code or vendor files changed for this design.
