# B17: Permanent Default Core Bot

Status: ready
Branch: task/b17-core-bot
Depends on: B16
Architecture: Sections 5.1, 5.7, 6.5, 8.3

## Goal
Every local installation has exactly one permanent Core Bot, available before model configuration. No specialist templates or additional Bots are seeded; users create additional Bots deliberately.

## Scope
In: durable Core identity, migration, lifecycle invariants, default selection, onboarding without preset roles, local operation diagnostics, tests.
Out: model-facing management tools (B18), group operations (B13b), avatar infrastructure, memory revision history (B19).

## Design
Store coreBotId in a versioned session document owned by the Host runtime adapter. Bootstrap before observing Bots or admitting Runs. Allocate the Core ID in that document first, then create its conversation/profile idempotently. On restart reconcile the recorded ID. Existing Bots keep their IDs, instructions, memories, and history. Do not promote one or infer identity from its name. A crash may leave an unindexed Pi conversation (existing runtime gap); it must never create a second indexed Core.

Project a required kind:core|specialist in BotProfile; legacy records default to specialist. Internal creation marks only the recorded Core ID as core. Public create/update schemas accept no kind/core flag. The runtime rejects deleting, hiding, or unpinning the Core; the Host checks before cancellation so a rejected deletion cannot stop its work. Duplicate creates a Specialist with no Core memory. Other duplication behavior changes in B19.

The Core is named OpenBot, role Personal assistant, pinned and active. It has a general-purpose Prompt without claiming management tools that are not implemented yet. It opens by default. Existing users retain their selected conversation during Host reconnect. Fresh users can configure a model or skip setup and still inspect/edit the Core. Remove preset Research/Coding/Writing cards entirely. New only creates a Specialist on explicit user submission.

## Contracts
- New Core identity session document: {coreBotId?:string}; written before profile creation, never changed by ordinary UI/model APIs.
- BotProfile.kind: core|specialist; storage permits absent kind for legacy records, projection supplies specialist.
- BotRuntime.ensureCoreBot(now): Promise<BotProfile>, serialized/idempotent; fresh ID is persisted first, repeated calls return the same protected profile.
- updateBot rejects status!=active or pinned=false for Core. Core deletion is rejected before cancelling work. createBot never overwrites an existing ID.
- No public operation can create/demote a Core. Prompt, name, role, model, and memory edits never change kind.
- Core initialization diagnostics contain outcome/time/generated operation ID only; no personal contents. Runs, approvals and execution receipts retain their existing local stores.

## Steps
1. Update architecture and protocol projection; implement durable Core bootstrap and runtime protection.
2. Bootstrap Host before observers; reject destructive Core requests before side effects; make duplicates Specialists.
3. Update sidebar, menus, default navigation and onboarding; remove role presets.
4. Test fresh/no-model/restart/legacy/concurrent bootstrap/forged requests and Core duplication.
5. Run check and background e2e, inspect screenshots and an isolated background app.

## Acceptance
1. Runtime tests: repeated/concurrent bootstrap and reopen produce one Core; legacy profiles/history/memory survive.
2. Host tests: delete/hide/unpin are rejected; rejected delete does not stop work; editable fields remain editable.
3. Protocol tests: clients cannot provide Core identity or kind through create/update.
4. Background e2e: first launch has exactly one Core, no seeded Specialists; skip setup opens it without network requests; menu has no Hide/Delete/Unpin.
5. Background e2e: model setup opens Core directly, user creates a Specialist, Core duplication has no memory, restart preserves identity and order.
6. Existing background behavior remains covered by background.e2e.ts; pnpm run check and pnpm run e2e pass.

## Risks
Existing bootstrap can leave an orphan Pi conversation if interrupted between separate commits; preserve the recorded Core ID and never overwrite existing user content. Product authority is not OS sandboxing. Management capabilities arrive in B18, not merely by labeling a Bot Core.

## Open questions
None. Migration creates a new Core and preserves all existing Bots unchanged.
