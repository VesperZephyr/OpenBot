# B13c: Core Entry and Bounded Bot Collaboration

Status: done (product foundation merged through B26; see task index)
Branch: task/b13c-collaboration
Depends on: B13b
Architecture: Sections 5.7, 7.2, 8.2

## Goal
Give the user one default coordinator, Core, with explicit recipient selection and visible, bounded collaboration. Persist work locally, preserve management authority, and stop complete task trees without affecting unrelated work.

## Research and product decisions
Reviewed 2026-10-17: [Grok collaboration](https://docs.x.ai/grok-bot/chat-and-collaboration), [Bot roles](https://docs.x.ai/grok-bot/bots), and [launch description](https://x.ai/news/introducing-grok-bot).

Grok documents natural group routing, explicit mentions, asynchronous messages and visible ownership changes. It recommends a small roster with an end-to-end coordinator and specialists. Its public documentation does not specify a mandatory protected Core, internal delivery receipts, loop detection or numeric wake budgets. OpenBot adopts the collaboration interaction while making the owner's stricter Core-first requirement a Host-enforced product rule. The limits below are OpenBot decisions, not claims about Grok internals.

The implementation separates three responsibilities: the user chooses intent and explicit recipients; Core chooses an execution plan; Host decides which deliveries are legal. Model text never becomes authority. A lead profile is useful for domain responsibility but must not silently override the user's Core-first routing choice.

| Concern | Source evidence and OpenBot decision |
| --- | --- |
| Default entry | Grok permits natural participant routing. OpenBot uses Core for every unaddressed group message; private chats remain direct. |
| Explicit targeting | Grok supports selected mentions. OpenBot records recipient IDs from the picker, including keyboard-entered @ search, and leaves arbitrary mention text inert. |
| Ownership | Grok recommends one owner per stage. OpenBot distinguishes a subtask with a return path from a transfer that revokes the sender's further execution authority. |
| Context | Grok describes shared threads and files. OpenBot sends bounded group/task context and each Bot's own profile and memory; no automatic private transcript copying. Shared Mac access remains shared. |
| Visible collaboration | Grok describes asynchronous handoffs. OpenBot records sender, recipient, task, expected result, execution status and returned synthesis in local state and the group timeline. |
| Approvals | Grok documents intervention through conversations. OpenBot retains its existing executing-Run approval cards in the group, with a separate stop for the whole task tree. |
| Termination | Public Grok materials do not expose an implementation contract. OpenBot explicitly limits depth and total automatic deliveries, prohibits ancestor cycles and never wakes peers for a normal post. |

Example: the user asks for a report; Core delegates research to Analyst; Analyst transfers its stage to Reviewer; Reviewer completes; Host sends one result continuation to Core; Core synthesizes. Analyst does not wake just to acknowledge Reviewer. If the user explicitly @ selects Reviewer, Reviewer owns that root and may finish without involving Core.

## Scope
- Ordinary group messages route to the persisted Core, including groups whose configured lead is a Specialist. Core is an implicit coordinator and need not occupy a selected member slot. Lead remains role metadata.
- Bot private chats retain their existing direct routing. This increment implements collaboration in groups only; Core private chat keeps existing management tools.
- Group members can delegate subtasks or transfer their task within their assigned group. They cannot create Bots, change memberships, dissolve groups, or dispatch outside that group.
- English and Chinese interface, default English. Existing Pi execution, model configuration and memory remain in use.
- No implicit Bot/group creation, cross-group peer dispatch, notifications, routines, new executors or cloud persistence.

## Contracts
The local group store also stores collaboration roots and receipts, with optional fields for backward-compatible existing deliveries. A root records its stable ID, source channel, original user post, initial recipients, allowed Bot IDs, automatic delivery count, state (`running`, `completed`, `paused`, `cancelled`) and reason. Each delivery records root ID, parent, trusted origin (`user`, `peer`, `result`), depth, ancestry, expected result, immutable input, channel, stable Run request ID, optional transfer/continuation, and closure. Public posts identify task roots and handoff kinds.

- `bot_delegate({botId, task, expectedResult})`: request a bounded subtask, retaining ownership. The caller ends its current turn; once all children settle, the Host enqueues one continuation containing their results. A delivery receipt is not a successful result.
- `bot_handoff({botId, task, expectedResult})`: transfer ownership; the sender may not dispatch more work for that delivery. The recipient's result closes that stage, without waking the sender merely to acknowledge it.
- Tool actor, active Run and channel are captured by the runtime adapter and memoized across replay. They are never tool arguments. Host checks the persisted Run and conversation before dispatch; the transaction revalidates delivery ownership, membership, root state and stable invocation fingerprint. Management authority is never inherited.
- Root scope includes Core and the group's current members, intersected with the roster captured at acceptance. Removed/deleted members cannot be revived by re-addition for an already invalidated delivery.
- Maximum two forward hops and twelve automatic deliveries (including continuations) per root. Self/ancestor dispatch is rejected. Reaching a limit pauses the root visibly, invalidates outstanding deliveries and cancels their Runs. A new user message starts a new budget; no automatic resume/reset.
- Normal replies, tool receipts, acknowledgements and text containing @ never enqueue work. Only an explicit collaboration tool creates a child. Structured UI recipients are authoritative; names in generated text are not.
- Child dispatch waits until the sending Run settles, preventing simultaneous ownership and continuation races. The outbox, public handoff and invocation receipt commit atomically before admission. Stable `delivery:<id>` request IDs and atomic answer publication recover the crash windows before/after Run admission and publication.
- A continuation runs in the same task channel with peer origin and no management tools. It includes bounded task results and status, excludes private histories, and can request further work only within the original budget.
- Every routed tool carries a memoized Host Run ID. Executor background commands retain that ID while running. Tree cancellation stops commands for all Runs in that root, including already settled Runs; it does not use conversation-wide command cancellation. Group dissolution and Bot deletion still stop their whole conversation scope. Executor restart already terminates orphan processes through its existing ledger.
- `collaboration.stop({rootId})` durably cancels the selected tree before stopping its Runs; unrelated roots and direct work continue. Group dissolution cancels its trees; member removal invalidates affected work. Approvals remain tied to executing Runs and visible in the task panel.
- Group snapshots include roots, public task posts and scoped execution status. Durable diagnostics include origin, owner, recipient, depth, counters, result state and stop reason, without credentials or new telemetry.
- Legacy B13b deliveries retain their accepted recipient and input; newly accepted ordinary messages use Core.

## Steps
1. Finalize routing and collaboration contract and source analysis in this spec.
2. Extend protocol, runtime durable store and trusted invocation binding; test atomic receipts, limits, transfer and recovery.
3. Integrate Host admission, callbacks, result continuation and scoped cancellation through Tool Router.
4. Add group Core-default/explicit @ composition and bilingual visible task trees and stop controls.
5. Extend scripted background e2e; run check and complete e2e, inspect screenshots, explore an isolated desktop, and spot-check real model delegation/transfer/result without touching owner data.
6. Update architecture, plan and backlog; commit and open one B13c PR.

## Acceptance
1. Host tests and e2e: no-recipient group message goes to persisted Core even when another member is lead; explicit selection only wakes selected Bots.
2. Desktop e2e: explicit @ selection works in groups; private Bot chats retain direct routing.
3. Store/Host tests: delegation produces one bounded result continuation; handoff changes ownership and suppresses sender continuation; ordinary replies never fan out.
4. Store/Host tests: self/ancestor targeting, stale membership, wrong actor/channel/Run and management escalation fail; hop/delivery exhaustion pauses durably.
5. Recovery tests: outbox replay, admission crash and answer publication each preserve one logical delivery/result; cancelled/paused roots never restart work.
6. Host/e2e: tree stop, member removal and dissolution stop affected tasks and approvals while unrelated work survives.
7. English/Chinese screenshots and background e2e cover handoff, returned results, limits and stop. Full check and e2e pass. Isolated real-model spot check records actual observed outcomes separately from scripted evidence.

## Risks
Model inference can fail or disregard instructions; Host limits remain authoritative. Shared local filesystem access is not Bot isolation. Stop cannot undo completed side effects. Historical journal and prior provider requests are not erased by stopping. A bounded continuation can fail, leaving visible results for the user rather than silently claiming completion.

## Open questions
None. Numeric budgets are conservative initial defaults; changing them requires explicit product review.

## Verification record

- `pnpm run check`: 223 tests across 36 files; protocol types and package boundaries pass.
- `pnpm run e2e`: 49 tests across 17 suites in background mode. Collaboration coverage includes Core-default routing, explicit @, transfer execution revocation, result synthesis, restart, Chinese pause reasons and scoped stop with approval recovery and independent background commands in the same Bot/group conversation. Existing group lifecycle and private-chat regression coverage passes.
- Store and Host tests cover stable dispatch receipts, changed replay rejection, admission/publication recovery, scope/provenance rejection, ancestor/hop/delivery limits (including return continuations), removal and cancellation.
- Isolated real-model desktop: Core delegated an arithmetic task to Analyst, Analyst transferred to Reviewer, Reviewer calculated and checked 17 × 23 = 391, and Core summarized in Chinese. Four Runs, three automatic deliveries. Restart retained the exact seven public records without another task. Explicit @Reviewer then answered 19 + 22 = 41 in English with no automatic deliveries. After the final Run-scoped cancellation change, Core delegated 6 × 7 to Reviewer and summarized 42 in English, with two automatic deliveries.
- English and Chinese screenshots inspected; agent-browser explored the actual background desktop. Synthetic state and private model configuration stayed outside tracked files. No owner conversations or workspace data were used. The isolated desktop was closed and its private model configuration copy removed. This is a model spot check, not a guarantee of arbitrary provider behavior; no packaged signing or OS permission claims are made.
