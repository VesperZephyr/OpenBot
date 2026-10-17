# B13a: Conversation Contexts per Channel

Status: implemented, in review
Branch: task/b13a-channel-contexts
Depends on: B19 (merged in PR #12)
Architecture: Sections 5.1, 5.7, 7.2

## Goal
Keep a Bot's direct and group task contexts separate while sharing its identity, Prompt, model settings and memory. This prerequisite adds no group UI; B13b supplies the authorized group lifecycle and routing.

## Contracts
- `direct` is the default channel. Existing Bot records remain the authoritative direct conversation mapping, so existing IDs and histories never move. An additive session document maps `(botId, channelId)` to additional Pi conversations. Only the Host can create mappings; reads and submissions never implicitly create them.
- Additional conversations inherit profile instructions/model/thinking and the standard routed tool extension. Core management tools are available only in the Core's direct conversation. Prompt lookup and tool actor identity resolve the actual conversation owner. The same Bot shares memory between its channels, but messages stay in their originating channel.
- Runtime submission, wait/withdraw, snapshot/watch, reset and abort accept a channel. Snapshots carry the actual conversation ID and optional non-direct channel ID. Profile/default-model updates configure all existing channels atomically with profile changes where applicable.
- Runs persist an optional channel ID; absent means direct for old records. One running Run per Bot and the global cap remain. Only same-channel user messages may steer/join. Host callers can require a separate Run for each delivered task. Request-ID reuse across channels or origins conflicts.
- Direct queued work has priority; a queued non-direct Run aged 30 seconds enters the same oldest-first tier to prevent starvation. Running work is never preempted. Recovery resolves the recorded channel and preserves submission identity.
- Cancellation, stopped markers, background-command cleanup and execution receipt acknowledgement use the actual channel/conversation. Queued tasks can be cancelled before admission. A Host admission predicate can reject work whose group membership is no longer valid (implemented by B13b).
- Direct IPC methods remain direct-only. B13b owns group endpoints, observation and approval routing; it cannot turn arbitrary channel IDs into public access. Approval filtering/settlement accepts the actual conversation ID. The existing direct subscription feed must not publish channel traffic.

## Implementation order
1. Durable runtime channel mapping, owner lookup and channel-aware conversation operations.
2. Run channel routing, fair queueing, recovery and cancellation seams.
3. Scope direct approval views and executor lifecycle callbacks; extend invariants and run regression checks.

## Acceptance
- Unit/Host: repeated channel creation/reopen preserves direct IDs; distinct Bot sentinels prove correct Prompt/memory injection; profile changes reach all channels; channel reset leaves direct history intact.
- Scheduler: no cross-channel steering, per-Bot cap, direct priority with aging, stable recovery mapping, scoped cancellation and request conflict checks.
- `pnpm run check` and background `pnpm run e2e` pass; existing screenshots remain correct. B13b supplies real-model group verification.

## Risks
Bot channels are context boundaries, not file or OS security boundaries. Background command cancellation requests cannot prove that earlier external effects were undone.

## Open questions
None for this batch. Group membership and transcript publication belong to B13b; peer handoffs belong to B13c.

## Verification
`pnpm run check`: 204 tests across 32 files. `channels.test.ts` and scheduler tests cover ownership, context separation, shared Prompt/memory, direct identity preservation, aged queue priority, scoped cancellation and recovery of an unadmitted channel Run. `pnpm run e2e`: 40 tests across 15 suites, all background; retained desktop screenshots inspected. B13b adds the public group UI and real-model acceptance.
