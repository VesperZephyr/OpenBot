# B14a: Reliable, Bounded Desktop Observation

Status: ready
Branch: task/b14a-reliable-observation; pull request target: main
Depends on: G0, merged B22–B26
Architecture: Sections 6.1, 7.1 and 8.2

## Goal

Reconnect to current application state without losing pending approvals, results or unread changes, without older snapshot requests overwriting newer ones, and without unbounded event delivery to a suspended renderer.

## Scope

In: bounded observation credit, stream identity/sequence recovery, single-flight snapshot refresh, direct/group/search integration and silent tests. Out: execution semantics, read-cursor changes, persistent search indexing, transcript virtualization, lifecycle controls and Pi changes.

## Design

Use pull-based invalidation credit over the existing private RPC channel. The renderer requests one observation at a time, then refreshes current state before requesting another. An acknowledged cursor is the credit for the next response. Host retains only one stream ID and revision, never a queue of transcript snapshots. A sequence gap means coalesced state and is recovered with current snapshots; notifications are not an authoritative event journal. Approvals, Runs, messages, group publications and Code Mode receipts remain durable in their existing stores.

Main has an independent single-flight observer for native attention while the renderer is absent. Stop sending application event payloads over the Host/main/renderer push channels. Host lifecycle state and window-activity channels remain separate and low-volume. The service's internal event callbacks remain available to existing fixtures; production composition does not forward them.

Snapshot reads are serialized/coalesced by logical resource. A refresh requested while a read is in flight invalidates that read and schedules exactly one newer read. A Host change/disconnect or renderer unsubscribe invalidates every outstanding read. Changing the selected Bot/group invalidates its prior read and subscription. Snapshot refresh never marks a conversation read, changes a search target or clears a draft.

## Contracts

`observation.wait({ cursor?: { streamId: string, seq: number }, waitMs?: number })` returns `{ streamId, seq }`. The Host owns a random stream ID and monotonically increasing safe-integer revision. Any internal state event or successful configuration mutation increments the revision. A missing, different-stream or ahead-of-Host cursor returns immediately and requires fresh snapshots. An equal cursor waits until a change or deadline. Default/max wait is 5,000 ms; zero performs a nonblocking check. IDs are bounded to 128 characters and sequence values are nonnegative safe integers.

There are at most four pending Host observation waits. Excess requests fail with `invalid_request`, never an unbounded waiter list. Each response contains only a bounded UUID and number (under 128 UTF-8 bytes with generated IDs); shutdown resolves outstanding waits and clears timers. Each production consumer has at most one pending request and a minimum 100 ms refresh cadence. A paused renderer can therefore retain at most one observation response plus its explicitly requested snapshot responses; full-history snapshot size remains existing behavior, assigned to B14c.

The observation API is desktop-only, with ordinary frame/parameter validation. It is not exposed as a model tool or through Code Mode. It carries no grants and changes no task authority. Existing protocol version 1 remains per the unreleased compatibility policy; main/preload/renderer/Host ship together.

## Steps

1. Add the typed/schema-checked observation method and a bounded Host revision/wait service; stop production event pushes.
2. Add a reusable single-flight refresh guard, renderer observation loop, Host-generation invalidation and selection-safe direct/group snapshots.
3. Preserve search/unread/draft behavior and independent native attention with bounded main polling.
4. Add fault tests for coalescing, old streams, obsolete reads, shutdown and waiter limits; background e2e reloads/reconnects while approval/result/group state changes.
5. Run check, background e2e, inspect screenshots and run an isolated real-model read/reply/reconnect spot check. Record evidence and remaining limits.

## Acceptance

1. Host tests: 10,000 invalidations use constant retained state; four waits are allowed, the fifth denied; duplicate/old/ahead cursors and timeout/shutdown recover without leaked timers.
2. Refresh tests: a late snapshot cannot overwrite a newer refresh; repeated invalidations coalesce; reset/unsubscribe rejects stale-generation results and leaves no new polling loop.
3. Background e2e: renderer reload/Host reconnect preserves pending exact approval, completed Code Mode object, group answer, unread/search state and bilingual drafts without duplicated effects or automatic read acknowledgement.
4. Existing B22–B26 tests remain green, including real-model-compatible configuration and hidden non-focusable test behavior.
5. Real-model spot check verifies an actual persisted reply after reconnect; no production app or native permission dialog is opened.

## G0 evidence

Baseline `54c2a1c` is merged through B26. Its full background e2e passed 73 tests across 22 files before this implementation. Prior B26 bundled Host/executor smoke and real-model receipts remain recorded in that spec. Native signed clean-install, Keychain identity, notification and power-event acceptance remain separate release evidence, not a prerequisite to this isolated implementation.

## Open questions

None. Pull credit deliberately replaces buffered push snapshots; it satisfies acknowledged backpressure without adding an event-log replay store or claiming an atomic snapshot across all application documents. Current-state reads converge, while durable domain stores remain authoritative.
