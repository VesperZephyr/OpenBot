# B18: Core Bot Management Tools

Status: in review
Branch: task/b18-core-management
Depends on: B17, B20
Architecture: Sections 5.2, 5.7, 8.3

## Goal
Let the Core carry out the user's explicit requests to inspect, create, edit and delete Specialists through chat. Never create a roster proactively or ship seeded Specialists.

## Scope
Bot management only. Keep Pi's agent loop, prompts and per-Bot memory. Group tools are out of scope. The user can still manage Bots through the existing UI. Product management authorization is not an OS sandbox: Bots share the Mac and granted shell access.

## Contracts
- `bot_inspect` lists live profile summaries and revisions without instructions, or reads one selected profile. `bot_create`, `bot_update` and `bot_delete` each propose one concrete operation. Optional nullable profile fields mean unchanged on update and defaults on create; `useDefaultModel: true` explicitly removes an override. Writable fields are name, role, instructions, model and thinking level. Memory, grants, Core identity, ownership, hidden state and approval decisions are not writable through these tools.
- Only the persisted Core conversation selects the management extension. Dispatch independently verifies the actor and conversation. Renaming a Specialist or changing its prompt never changes authority.
- A management call carries a Host-derived user Run ID, memoized by Pi for that invocation. Only Runs admitted through `messages.submit` have `origin: user`; missing or peer provenance is denied. The model cannot supply this envelope. A pending call cannot borrow a later Run's authority.
- Every mutation requires **Allow once** on the exact proposal, even when file/command policies allow automatically. No Always allow. The proposal shows action, target identity, expected revision and changed fields. Deletion warns that active work and background commands will stop and that local history is retained. Reading needs no confirmation.
- The confirmed proposal is the bounded mandate: actor, conversation, Run, local target, stable invocation ID, operation, arguments and expected revision. Natural-language text is guidance, never authentication. Record it before asking; check identity, arguments, revision, Run and cancellation again before effects.
- Updates and deletions require an inspected `expectedRevision`. Any UI or tool profile change increments the revision. Stale proposals fail rather than overwriting later changes. Core is not a valid mutation target; creation always creates a Specialist with empty memory.
- Runtime commits profile, Pi agent configuration and successful receipt atomically. Creation allocates its conversation in that same transaction. The same invocation returns its stored result; reuse with different arguments is rejected. Pending approval survives restart; denied/cancelled calls have no profile effects. Host serializes UI mutations, message admission and management execution; confirmed deletion stops current work before the atomic soft delete. Recovery repeats an interrupted stop safely, never repeats a committed mutation.
- Authoritative proposals and receipts remain in the local Pi store. Settings exposes a bounded recent activity view with actor/target IDs, local target, action, expected/result revision, time, user origin and outcome. Diagnostics and activity contain no prompts, memories, messages, keys or raw arguments. There is no telemetry or remote audit service.

## Steps
1. Add revisioned atomic lifecycle transactions, durable proposals/receipts and immutable user-Run provenance.
2. Add Core-only routed tools, hard dispatch checks and per-proposal confirmation.
3. Add English/Chinese management cards and local activity view.
4. Exercise creation, update, deletion, denial, cancellation, escalation, stale revisions and recovery with ScriptedModel and invariant tests.
5. Run check and background e2e, inspect screenshots, then use an isolated desktop and configured real model for synthetic lifecycle requests.

## Acceptance
- Core creates only after approval; fresh Specialist has independent prompt and empty memory.
- Core inspects and edits a Specialist; stale revisions cannot overwrite UI changes.
- Delete stops work, hides the Specialist and retains local history; Core protection precedes effects.
- Specialists have no tools and forged calls, peer/missing provenance, argument substitutions and target substitutions are denied.
- Denial and cancellation leave profiles unchanged; restart preserves pending approval and committed invocation deduplication.
- Local activity is useful and content-free; all new UI supports English and Chinese.
- `pnpm run check` and background `pnpm run e2e` pass. Record real-model spot checks separately.

## Open questions
None. Per-proposal approval supplies the bounded user mandate; no language classifier grants authority.

## Implementation and validation

- Uses Pi extensions, invocation memoization and transactions without vendor changes. Existing profiles default to revision 1. UI lifecycle mutations and model proposals share the transactional runtime methods.
- `pnpm run check`: 194 tests across 30 files, with package boundaries and TypeScript checks.
- `pnpm run e2e`: 36 tests across 14 suites, in background mode. Management coverage includes restart during approval, strict-provider nullable fields, command-policy reevaluation, stale UI edits, denial, Stop, forged Specialist calls, Core protection, active Run cancellation, termination of a real background process, retained history and English/Chinese cards/activity at normal and minimum window sizes.
- Inspected `e2e/.run/bot-management/` screenshots. Isolated agent-browser desktop exploration used a hidden, non-focusable test app.
- Real-model spot check through the user's configured endpoint: create exactly one Specialist with an independent prompt and empty memory; inspect and update its name/role/prompt; verify its next response uses the updated prompt; delete it; restart and verify one Core, no live Specialists, retained local transcript and three successful management receipts. Synthetic test data only; credentials and test artifacts remain outside Git. The temporary model configuration copy was removed after verification.
- Native signing and packaged OS permission behavior were not revalidated by this batch. Group management and cross-Bot memory editing remain out of scope.
