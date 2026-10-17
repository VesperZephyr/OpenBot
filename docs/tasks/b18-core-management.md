# B18: Core Bot Management Tools

Status: draft
Branch: task/b18-core-management
Depends on: B17
Architecture: Sections 5.2, 5.7, 8.3

## Goal
Let the Core carry out the user's explicit requests to create, inspect, edit and delete Specialists. Never create a roster proactively or ship seeded Specialists.

## Scope
Bot management only; group tools arrive in B13b. User remains able to manage through UI.

## Design and contracts
Host-derived actor identity, user-origin request provenance and target bind every routed management call. Specialists receive no management tools and are rejected by dispatch even if a call is forged. Core creation requires a user request; peer messages cannot grant authority. Shared UI/Host methods enforce lifecycle invariants. Persist operation intent, expected revision, stable invocation ID and result, so retry cannot duplicate creation. Deletion previews affected work and uses the existing confirmation policy; no raw SQL or shell bypass.

Record actor ID, target ID, operation, revision, timestamp, origin and outcome in the local authoritative store. Diagnostics contain only allowlisted metadata; never copy Prompt, memory, messages, keys or endpoint credentials into logs. Management cannot change grants or approve itself.

## Steps
1. Specify authority/mandate schema and revisioned mutation receipts.
2. Add routed Host tools and Core-only exposure.
3. Add management cards and local audit view.
4. Exercise creation, change, denial, cancellation and recovery with ScriptedModel.

## Acceptance
Automated tests prove user-requested creation, Specialist/peer escalation denial, Core protection, stale revision rejection, restart deduplication and secret-free diagnostics. Background e2e verifies visible results; check must pass.

## Risks
Natural-language intent is not authentication; enforce trusted provenance before dispatch.

## Open questions
Fix the exact bounded user-mandate schema and deletion-confirmation protocol before ready.
