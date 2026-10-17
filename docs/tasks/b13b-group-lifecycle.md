# B13b: Group Lifecycle

Status: draft
Branch: task/b13b-group-lifecycle
Depends on: B13a, B18
Architecture: Sections 5.7, 6.5, 8.3

## Goal
Let the user/Core create and manage groups of existing, user-created Bots.

## Contracts and steps
Persist group ID, objective, member IDs, lead, membership revision, active/dissolved state and write-only transcript. Two to six Bots; Core membership is optional. Host validates user/Core authority. Specialists can participate but cannot rename, change membership or dissolve groups. Explicit mentions/replies choose recipients; otherwise use the lead. Store origin and recipient IDs; model text cannot redirect a reply. Removal cancels pending work; dissolution stops delivery and retains read-only history. Deleting a lead pauses routing until reassigned.

Add sidebar/group detail and management cards, then routed Core tools; do not expose tools before handlers exist. All state/logs stay local, with no conversation payloads in diagnostics.

## Acceptance
Unit tests cover stale membership, protected authority, delete/dissolve cancellation and recovery. Background e2e covers create/edit/member removal/lead routing/dissolution, preserving unrelated Bots and tasks. Check passes.

## Risks
Cancellation may have uncertain external effects; retain receipt outcomes.

## Open questions
Finalize group schema, confirmation and transcript retention before ready.
