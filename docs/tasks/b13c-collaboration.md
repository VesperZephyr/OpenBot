# B13c: Bounded Bot Collaboration

Status: draft
Branch: task/b13c-collaboration
Depends on: B13b
Architecture: Sections 5.7, 7.2, 8.2

## Goal
Support explicit visible task handoffs without unsolicited Bot creation or endless reply loops.

## Contracts and steps
Messages contain root task ID, trusted origin, sender, recipient, reply channel, expected result, budget and stable delivery key. Default group posts do not wake peers. Start with two hops and twelve automatic deliveries per root task; pause visibly on exhaustion. Specialist work is bounded to its assigned group/task; out-of-group delegation requires user/Core assignment. Ownership transfer ends the sender's responsibility for that same task. Persist outbox and receipt before/after dispatch and use stable handoff request IDs across restarts. Approvals stay with executing Runs and link from groups. Stop only cancels the selected collaboration tree.

## Acceptance
Scripted tests prove exact-once admission/publication across restart, no self-sustaining acknowledgement loops, budget exhaustion, ownership transfer, authority preservation and scoped cancellation. Background e2e verifies visible handoffs and intervention links; check passes.

## Risks
Do not equate message delivery with successful work; track both states.

## Open questions
Validate budget defaults and exact receipt/queue schema before ready. Templates and usage are separate B13 follow-ups.
