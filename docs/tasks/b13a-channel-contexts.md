# B13a: Conversation Contexts per Channel

Status: draft
Branch: task/b13a-channel-contexts
Depends on: B19
Architecture: Sections 5.1, 5.7, 7.2

## Goal
Keep each Bot's direct and group conversations separate while sharing its identity, instructions and memory.

## Contracts and steps
Introduce channelId and durable (botId,channelId) conversation mapping behind agent-runtime. Preserve all existing direct conversation IDs during migration. One active Run per Bot initially; global cap remains. Queue direct human messages with priority, steer only in the same channel. Update prompt lookup, subscriptions, approvals, reset, cancellation and recovery before adding groups. No user-visible group feature in this batch.

## Acceptance
Unit/Host tests prove idempotent migration, per-channel prompt injection, origin-bound replies and no cross-channel steering; existing background e2e and check pass.

## Risks
Changing identity lookup can accidentally inject the wrong memory; test with distinct sentinels.

## Open questions
Finalize protocol schemas, direct-message priority fairness and recovery mapping before ready.
